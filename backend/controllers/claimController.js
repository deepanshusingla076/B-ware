const crypto = require("crypto");
const db = require("../config/db");
const redis = require("../config/redis");
const nlp = require("../services/nlpService");

async function ensureUserExists(user) {
  if (!user?.uid) return;
  try {
    await db.query(
      `INSERT INTO users (firebase_uid, email, name, role, created_at)
       VALUES (?, ?, ?, 'user', NOW())
       ON DUPLICATE KEY UPDATE last_seen_at = NOW()`,
      [user.uid, user.email || null, user.name || null],
    );
  } catch (e) {
    console.warn("[ensureUserExists]", e.message);
  }
}

function hashText(text) {
  return crypto
    .createHash("sha256")
    .update(text.trim().toLowerCase())
    .digest("hex");
}

function isNlpUnavailable(err) {
  const msg = String(err?.message || "");
  return (
    !err?.status ||
    /timeout|ECONNREFUSED|ECONNRESET|socket hang up|Network Error/i.test(msg)
  );
}

async function runVerify(req, res, endpoint) {
  const text = req.body.text?.trim();

  if (!text || text.length < 5) {
    return res.status(400).json({ error: "Claim text too short (min 5 chars)" });
  }
  if (text.length > 2000) {
    return res.status(400).json({ error: "Claim text too long (max 2000 chars)" });
  }

  const userId = req.user?.uid || null;
  const hash = hashText(text);

  try {
    const cached = await redis.get(`claim_result:${hash}`);
    if (cached) {
      return res.json({ ...JSON.parse(cached), from_cache: true });
    }
  } catch {
    // redis down — continue without cache
  }

  let claimId;

  try {
    await ensureUserExists(req.user);

    const [ins] = await db.query(
      "INSERT INTO claims (user_id, original_text, claim_hash, status) VALUES (?, ?, ?, ?)",
      [userId, text, hash, "pending"],
    );
    claimId = ins.insertId;

    const { data: r } = await nlp.post(endpoint, { text });

    const verdict = r.verdict;
    const confidence = r.confidence ?? null;
    const tierUsed = r.tier_used ?? "tier1";
    const explanation = r.explanation ?? null;
    const officialVal =
      r.official_value ?? r.numeric_check?.official_value ?? null;
    const claimedVal =
      r.extracted_value ?? r.claimed_value ?? r.numeric_check?.claimed_value ?? null;
    const pctError =
      r.percentage_error ?? r.numeric_check?.percentage_error ?? null;
    const metric = r.extracted_metric ?? r.extraction?.metric ?? null;
    const year = r.extracted_year ?? r.extraction?.year ?? null;
    const difference =
      officialVal != null && claimedVal != null
        ? Math.abs(officialVal - claimedVal)
        : null;
    const evidenceJson = JSON.stringify(r.evidence ?? []);

    await db.query(
      `INSERT INTO verification_log
       (claim_id, official_value, claimed_value, difference, percentage_error,
        verdict, tier_used, tiers_run, confidence, explanation, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        claimId,
        officialVal,
        claimedVal,
        difference,
        pctError,
        verdict,
        tierUsed,
        JSON.stringify(r.tiers_run ?? [tierUsed]),
        confidence,
        explanation,
        evidenceJson,
      ],
    );

    await db.query(
      `UPDATE claims SET
        extracted_metric = ?, extracted_value = ?, extracted_year = ?,
        credibility_score = ?, verdict = ?, confidence = ?, status = 'verified'
       WHERE id = ?`,
      [
        metric,
        claimedVal,
        year,
        confidence != null ? confidence * 100 : null,
        verdict,
        confidence,
        claimId,
      ],
    );

    const response = {
      claim_id: claimId,
      original_text: text,
      verdict,
      confidence,
      tier_used: tierUsed,
      explanation,
      official_value: officialVal,
      claimed_value: claimedVal,
      percentage_error: pctError,
      extracted_metric: metric,
      extracted_year: year,
      evidence: r.evidence ?? [],
      tiers_run: r.tiers_run ?? [tierUsed],
      source_url: r.source_url ?? r.numeric_check?.source_url ?? null,
    };

    try {
      await redis.set(
        `claim_result:${hash}`,
        JSON.stringify(response),
        "EX",
        86400,
      );
    } catch {
      // ignore
    }

    return res.json(response);
  } catch (err) {
    console.error("verify failed:", err.message || err);

    if (claimId) {
      try {
        await db.query("UPDATE claims SET status = 'failed' WHERE id = ?", [
          claimId,
        ]);
      } catch (dbErr) {
        console.error("could not mark claim failed:", dbErr.message);
      }
    }

    if (err.status === 422) {
      return res
        .status(422)
        .json({ error: err.nlpDetail || "Invalid claim text" });
    }
    if (err.status === 429) {
      return res.status(429).json({ error: "NLP rate limit hit, retry later" });
    }
    if (isNlpUnavailable(err)) {
      return res.status(503).json({
        error:
          "NLP service unavailable. Make sure it is running on port 5001 (start.bat).",
      });
    }

    return res
      .status(500)
      .json({ error: "Verification failed, please try again" });
  }
}

exports.submitClaim = (req, res) => runVerify(req, res, "/verify");
exports.submitQuick = (req, res) => runVerify(req, res, "/verify/quick");
exports.submitDeep = (req, res) => runVerify(req, res, "/verify/deep");

// batch verification endpoint - processes multiple claims at once
exports.submitBatch = async (req, res) => {
  const claims = req.body.claims || [];
  const userId = req.user.uid;

  if (!Array.isArray(claims) || claims.length === 0) {
    return res.status(400).json({ error: "claims must be non-empty array" });
  }

  if (claims.length > 50) {
    return res.status(400).json({ error: "Maximum 50 claims per batch" });
  }

  // sanitize claims
  const sanitized = claims
    .map((c) => (typeof c === "string" ? c.trim() : ""))
    .filter((c) => c.length >= 5 && c.length <= 2000);

  if (sanitized.length === 0) {
    return res
      .status(400)
      .json({ error: "No valid claims (each must be 5-2000 characters)" });
  }

  const results = [];

  try {
    // Ensure the Firebase user exists in MySQL before inserting any claims
    await ensureUserExists(req.user);

    // process each claim
    for (const text of sanitized) {
      const hash = hashText(text);

      // check redis cache first
      let cached = null;
      try {
        cached = await redis.get(`claim_result:${hash}`);
      } catch {
        /* Redis unavailable */
      }

      if (cached) {
        try {
          results.push({
            ...JSON.parse(cached),
            from_cache: true,
          });
          continue;
        } catch {}
      }

      let claimId;
      try {
        // insert claim
        const [ins] = await db.query(
          "INSERT INTO claims (user_id, original_text, claim_hash, status) VALUES (?, ?, ?, ?)",
          [userId, text, hash, "pending"]
        );

        claimId = ins.insertId;

        let r;
        try {
          const nlpResp = await nlp.post("/verify", { text });
          r = nlpResp.data;
        } catch (nlpErr) {
          console.error(`NLP batch verify failed: ${nlpErr.message}`);
          throw nlpErr;
        }

        // Extract values from NLP response (structure varies by endpoint)
        const verdict = r.verdict ?? null;
        const confidence = r.confidence ?? null;
        const tierUsed = r.tier_used ?? "tier1";
        const explanation = r.explanation ?? null;

        // Handle both /verify (full verification) and /extract (extraction only) responses
        const officialVal =
          r.official_value ?? r.numeric_check?.official_value ?? null;
        const claimedVal =
          r.claimed_value ?? 
          r.extracted_value ?? 
          r.extraction?.value ??
          r.numeric_check?.claimed_value ?? null;
        const pctError =
          r.percentage_error ?? r.numeric_check?.percentage_error ?? null;

        const metric = 
          r.extracted_metric ?? 
          r.metric ?? 
          r.extraction?.metric ?? null;
        const year = 
          r.extracted_year ?? 
          r.year ??
          r.extraction?.year ?? null;

        const tiersRun = JSON.stringify(r.tiers_run ?? [tierUsed]);
        const evidenceJson = JSON.stringify(r.evidence ?? []);

        const difference =
          officialVal != null && claimedVal != null
            ? Math.abs(officialVal - claimedVal)
            : null;

        // store verification log
        await db.query(
          `INSERT INTO verification_log
           (claim_id, official_value, claimed_value, difference, percentage_error,
            verdict, tier_used, tiers_run, confidence, explanation, evidence_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            claimId,
            officialVal,
            claimedVal,
            difference,
            pctError,
            verdict,
            tierUsed,
            tiersRun,
            confidence,
            explanation,
            evidenceJson,
          ]
        );

        // update claim
        await db.query(
          `UPDATE claims SET
            extracted_metric  = ?,
            extracted_value   = ?,
            extracted_year    = ?,
            credibility_score = ?,
            verdict           = ?,
            confidence        = ?,
            status            = 'verified'
          WHERE id = ?`,
          [
            metric,
            claimedVal,
            year,
            confidence != null ? confidence * 100 : null,
            verdict,
            confidence,
            claimId,
          ]
        );

        const result = {
          claim_id: claimId,
          original_text: text,
          verdict,
          confidence,
          tier_used: tierUsed,
          explanation,
          official_value: officialVal,
          claimed_value: claimedVal,
          percentage_error: pctError,
          extracted_metric: metric,
          extracted_year: year,
          evidence: r.evidence ?? [],
          tiers_run: r.tiers_run ?? [tierUsed],
          source_url: r.source_url ?? r.numeric_check?.source_url ?? null,
        };

        // cache result
        try {
          await redis.set(
            `claim_result:${hash}`,
            JSON.stringify(result),
            "EX",
            86400
          );
        } catch {}

        results.push(result);
      } catch (err) {
        console.error(`Batch claim failed: ${err.message}`);
        if (claimId) {
          try {
            await db.query("UPDATE claims SET status = 'failed' WHERE id = ?", [
              claimId,
            ]);
          } catch {}
        }
        results.push({
          original_text: text,
          error: err.message || "Verification failed for this claim",
          verdict: "unverifiable",
          confidence: 0,
        });
      }
    }

    res.json({
      total: results.length,
      successful: results.filter((r) => !r.error).length,
      failed: results.filter((r) => r.error).length,
      results,
    });
  } catch (err) {
    console.error("submitBatch error:", err.message);
    res.status(500).json({ error: "Batch processing failed" });
  }
};

// get claims submitted by current user
exports.getUserClaims = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  try {
    const [rows] = await db.query(
      `SELECT c.id, c.original_text, c.extracted_metric, c.extracted_value,
              c.extracted_year, c.credibility_score, c.status, c.created_at,
              v.verdict, v.confidence, v.explanation
       FROM claims c
       LEFT JOIN verification_log v ON v.claim_id = c.id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC
       LIMIT ? OFFSET ?`,
      [req.user.uid, limit, offset],
    );

    const [[{ total }]] = await db.query(
      "SELECT COUNT(*) as total FROM claims WHERE user_id = ?",
      [req.user.uid],
    );

    res.json({
      claims: rows,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("getUserClaims:", err.message);
    res.status(500).json({ error: "Could not fetch claims" });
  }
};

// get single claim details
exports.getClaimById = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.*,
              v.official_value, v.claimed_value, v.difference, v.percentage_error,
              v.tier_used, v.tiers_run, v.confidence AS vlog_confidence,
              v.explanation, v.evidence_json, v.verified_at
       FROM claims c
       LEFT JOIN verification_log v ON v.claim_id = c.id
       WHERE c.id = ? AND c.user_id = ?`,
      [req.params.id, req.user.uid],
    );

    if (!rows[0]) return res.status(404).json({ error: "Claim not found" });

    const claim = rows[0];

    // convert stored json strings to objects
    try {
      if (claim.evidence_json)
        claim.evidence_json = JSON.parse(claim.evidence_json);
    } catch {}

    try {
      if (claim.tiers_run) claim.tiers_run = JSON.parse(claim.tiers_run);
    } catch {}

    res.json(claim);
  } catch (err) {
    console.error("getClaimById:", err.message);
    res.status(500).json({ error: "Could not fetch claim" });
  }
};

// statistics of user claims
exports.getStats = async (req, res) => {
  const cacheKey = `stats_cache:${req.user.uid}`;

  // check if stats exist in redis
  let cached = null;
  try {
    cached = await redis.get(cacheKey);
  } catch {
    /* Redis unavailable — fall through to DB */
  }
  if (cached) {
    try {
      return res.json(JSON.parse(cached));
    } catch {}
  }

  try {
    const [verdictRows] = await db.query(
      `SELECT v.verdict, COUNT(*) as count
       FROM claims c
       JOIN verification_log v ON v.claim_id = c.id
       WHERE c.user_id = ?
       GROUP BY v.verdict`,
      [req.user.uid],
    );

    const [[{ total, avg_conf }]] = await db.query(
      `SELECT COUNT(*) as total, AVG(v.confidence) as avg_conf
       FROM claims c
       JOIN verification_log v ON v.claim_id = c.id
       WHERE c.user_id = ?`,
      [req.user.uid],
    );

    const counts = {
      accurate: 0,
      misleading: 0,
      false: 0,
      unverifiable: 0,
    };

    // fill verdict counts
    for (const r of verdictRows) {
      if (r.verdict in counts) counts[r.verdict] = Number(r.count);
    }

    const stats = {
      total: total || 0,
      avg_confidence: Number(parseFloat(avg_conf || 0).toFixed(2)),
      ...counts,
    };

    // cache stats for 10 minutes
    try {
      await redis.set(cacheKey, JSON.stringify(stats), "EX", 600);
    } catch {
      // Redis unavailable
    }

    res.json(stats);
  } catch (err) {
    console.error("getStats:", err.message);
    res.status(500).json({ error: "Could not fetch stats" });
  }
};
