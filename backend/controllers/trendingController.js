const db = require("../config/db");
const redis = require("../config/redis");
const nlp = require("../services/nlpService");
const axios = require("axios");
const crypto = require("crypto");

function normalizeDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return null;
  }
}

/** Map NewsAPI / FactCheck publisher names onto outlet preference labels. */
function normalizeOutletName(name) {
  if (!name) return "Unknown";
  const n = String(name).toLowerCase();
  if (n.includes("bbc")) return "BBC";
  if (n.includes("reuters")) return "Reuters";
  if (n.includes("bloomberg")) return "Bloomberg";
  if (n.includes("guardian")) return "The Guardian";
  if (n.includes("wall street") || n.includes("wsj")) return "Wall Street Journal";
  if (n.includes("financial times") || n === "ft") return "Financial Times";
  return name;
}

/*
  function to calculate danger score for a story

  logic:
  false claim = highest base score
  misleading = medium
  unverifiable = low
  accurate = 0

  then we add:
  + confidence bonus
  + recency bonus (recent news more dangerous)
*/

function calcDangerScore(verdict, confidence, publishedAt,sourceCount=1) {
  const weights = {
    false: 80,
    misleading: 40,
    unverifiable: 15,
    accurate: 0,
  };

  let score = weights[verdict] || 0;

  // confidence bonus
  score += (confidence || 0) * 20;

  // recency bonus
  if (publishedAt) {
    const hoursOld = (Date.now() - new Date(publishedAt).getTime()) / 3600000;

    if (hoursOld < 2) score += 10;
    else if (hoursOld < 24) score += 5;
  }
  score+=(sourceCount-1)*5;
  // cap score at 100
  return Math.min(Math.round(score), 100);
}

// get trending stories feed
exports.getTrending = async (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const filter = req.query.verdict;
  let sources = req.query.sources ? req.query.sources.split(",").map(s => s.trim()) : null;

  // If user is authenticated and no sources specified, get their preferences
  if (req.user && !sources) {
    try {
      const [outlets] = await db.query(
        "SELECT outlet_name FROM user_outlet_preferences WHERE user_id = ?",
        [req.user.uid]
      );
      if (outlets.length > 0) {
        sources = outlets.map(o => o.outlet_name);
      }
    } catch (err) {
      console.error("Could not fetch user outlets, using all sources:", err.message);
    }
  }

  // Build cache key including sources filter
  const sourcesKey = sources ? sources.sort().join(",") : "all";
  const cacheKey = `trending_feed:${filter || "all"}:${sourcesKey}`;

  // check redis cache
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
    const allowed = ["accurate", "misleading", "false", "unverifiable"];

    const queryParams = [];
    let where = "WHERE is_active = 1";

    // optional filter by verdict
    if (filter && allowed.includes(filter)) {
      where += " AND verdict = ?";
      queryParams.push(filter);
    }

    // optional filter by sources
    if (sources && sources.length > 0) {
      const placeholders = sources.map(() => "?").join(",");
      where += ` AND source_name IN (${placeholders})`;
      queryParams.push(...sources);
    }

    queryParams.push(limit);

    const [rows] = await db.query(
      `SELECT id, headline, claim_text, source_name, source_url, published_at,
              fetched_at, verdict, confidence, danger_score, metric,
              official_value, claimed_value, pct_error, explanation, tier_used
       FROM trending_stories
       ${where}
       ORDER BY danger_score DESC
       LIMIT ?`,
      queryParams,
    );

    // get last update time
    const [[{ last_updated }]] = await db.query(
      "SELECT MAX(fetched_at) as last_updated FROM trending_stories WHERE is_active = 1",
    );

    const result = {
      stories: rows,
      last_updated,
      total: rows.length,
      sources_filter: sources || null,
    };

    // cache for 5 minutes (non-fatal if Redis is down)
    try {
      await redis.set(cacheKey, JSON.stringify(result), "EX", 300);
    } catch {
      /* Redis unavailable */
    }

    res.json(result);
  } catch (err) {
    console.error("getTrending:", err.message);

    res.status(500).json({
      error: "Could not fetch trending stories",
    });
  }
};

// get reliability stats of sources
exports.getSourceStats = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT source_name, total_claims, accurate_count, misleading_count,
              false_count, avg_danger_score, last_updated
       FROM source_stats ORDER BY avg_danger_score DESC LIMIT 50`,
    );

    res.json({ sources: rows });
  } catch (err) {
    res.status(500).json({
      error: "Could not fetch source stats",
    });
  }
};

// get single trending story by id
exports.getTrendingById = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM trending_stories WHERE id = ? AND is_active = 1",
      [req.params.id],
    );

    if (!rows[0]) {
      return res.status(404).json({
        error: "Story not found",
      });
    }

    const story = rows[0];

    // convert evidence json string to object
    if (story.evidence_json && typeof story.evidence_json === "string") {
      try {
        story.evidence_json = JSON.parse(story.evidence_json);
      } catch {}
    }

    res.json(story);
  } catch (err) {
    res.status(500).json({
      error: "Could not fetch story",
    });
  }
};

// GET LIVE FEED — fetches directly from NewsAPI + Google Fact Check (no DB)
// Returns real-time news cards and fact-check results for the trending page
exports.getLiveFeed = async (req, res) => {
  const cacheKey = 'trending_live_feed';

  // Check Redis cache (10-minute TTL)
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return res.json(JSON.parse(cached));
  } catch { /* Redis unavailable */ }

  const newsItems = [];
  const factCheckItems = [];

  if (process.env.NEWS_API_KEY) {
    try {
      const { data } = await axios.get('https://newsapi.org/v2/everything', {
        params: {
          q: 'India AND (economy OR petrol OR unemployment OR election OR GDP OR fuel OR inflation OR "government scheme")',
          language: 'en',
          sortBy: 'publishedAt',
          pageSize: 20,
          apiKey: process.env.NEWS_API_KEY,
        },
        timeout: 10000,
      });

      for (const a of data.articles || []) {
        if (!a.title || a.title === '[Removed]') continue;
        newsItems.push({
          type: 'news',
          title: a.title,
          source: a.source?.name || 'Unknown',
          publishedAt: a.publishedAt,
          image: a.urlToImage || null,
          description: a.description || '',
          url: a.url,
        });
      }
    } catch (err) {
      console.error('[getLiveFeed] NewsAPI error:', err.message);
    }
  }

  if (process.env.GOOGLE_FACT_CHECK_API_KEY) {
    const queries = ['petrol price India', 'India election', 'India economy', 'unemployment India'];

    for (const query of queries) {
      try {
        const { data } = await axios.get(
          'https://factchecktools.googleapis.com/v1alpha1/claims:search',
          {
            params: {
              query,
              languageCode: 'en',
              pageSize: 5,
              key: process.env.GOOGLE_FACT_CHECK_API_KEY,
            },
            timeout: 8000,
          }
        );

        for (const claim of data.claims || []) {
          const review = claim.claimReview?.[0];
          if (!review) continue;
          factCheckItems.push({
            type: 'factcheck',
            claim: claim.text,
            claimant: claim.claimant || 'Unknown',
            publisher: review.publisher?.name || 'Unknown',
            rating: review.textualRating || 'Unrated',
            reviewUrl: review.url || null,
            claimDate: claim.claimDate || null,
          });
        }
      } catch (err) {
        console.error(`[getLiveFeed] FactCheck error for "${query}":`, err.message);
      }
    }
  }

  const result = {
    news: newsItems,
    factChecks: factCheckItems,
    fetchedAt: new Date().toISOString(),
    total: newsItems.length + factCheckItems.length,
  };

  // Cache for 10 minutes
  try {
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);
  } catch { /* Redis unavailable */ }

  return res.json(result);
};

// manual refresh endpoint (admin only)
exports.refreshTrending = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT role FROM users WHERE firebase_uid = ? LIMIT 1",
      [req.user.uid],
    );
    if (!rows.length || rows[0].role !== "admin") {
      return res.status(403).json({ error: "Admin only" });
    }

    const count = await runTrendingRefresh();

    res.json({
      refreshed: true,
      stories_processed: count,
    });
  } catch (err) {
    console.error("refreshTrending:", err.message);

    res.status(500).json({
      error: "Refresh failed",
    });
  }
};

// main function which fetches news and verifies them
async function runTrendingRefresh() {
  // Map of outlet names to their NewsAPI domain(s)
  const outletDomains = {
    "Bloomberg": "bloomberg.com",
    "The Guardian": "theguardian.com",
    "BBC": "bbc.co.uk,bbc.com",
    "Reuters": "reuters.com",
    "Wall Street Journal": "wsj.com",
    "Financial Times": "ft.com",
  };

  //inner function to fetch news from NewsAPI
  async function fetchFromNewsAPI() {
    const articles = [];

    if (process.env.NEWS_API_KEY) {
      try {
        // Build domains string from outlet mapping
        const domains = Object.values(outletDomains).join(",");
        
        const { data } = await axios.get("https://newsapi.org/v2/everything", {
          params: {
            q: "India AND (economy OR GDP OR inflation OR unemployment)",
            language: "en",
            domains: domains,
            sortBy: "publishedAt",
            pageSize: 20,
            apiKey: process.env.NEWS_API_KEY,
          },
          timeout: 10000,
        });
        for (const a of data.articles || []) {
          articles.push({
            headline: a.title,
            source_name: normalizeOutletName(a.source?.name),
            source_url: a.url,
            published_at: a.publishedAt,
            content: a.description || a.title,
          });
        }
      } catch (err) {
        console.error("NewsAPI fetch failed:", err.message);
      }
    }
    return articles;
  }

  //inner function to fetch claims from Google fact check api
  async function fetchFromGoogleFactCheck() {
    const items = [];
    if (!process.env.GOOGLE_FACT_CHECK_API_KEY) {
      return items;
    }
    try {
      const { data } = await axios.get(
        "https://factchecktools.googleapis.com/v1alpha1/claims:search",
        {
          params: {
            query: "India economy",
            languageCode: "en",
            pageSize: 20,
            key: process.env.GOOGLE_FACT_CHECK_API_KEY,
          },
          timeout: 10000,
        },
      );
      // convert api response to our article format (Google Fact Check shape)
      for (const claim of data.claims || []) {
        const review = claim.claimReview?.[0];
        if (!review?.url) continue;
        items.push({
          headline: claim.text || review.title || "Fact-checked claim",
          source_name: normalizeOutletName(review.publisher?.name) || "Fact Check",
          source_url: review.url,
          published_at: claim.claimDate || review.reviewDate || null,
          content: claim.text || review.title || "",
        });
      }
    } catch (err) {
      console.error("Google Fact check fetch failed:", err.message);
    }
    return items;
  }
  //fetch both sources in parallel
  const [newsArticles, factChecks] = await Promise.all([
    fetchFromNewsAPI(),
    fetchFromGoogleFactCheck(),
  ]);
  const articles = [...newsArticles, ...factChecks];

  // filter articles that are not already stored
  const fresh = [];

  for (const a of articles) {
    if (!a.source_url) continue;

    // compute hash in JS so MySQL can use the indexed url_hash column
    const urlHash = crypto.createHash("md5").update(a.source_url).digest("hex");

    const [exists] = await db.query(
      "SELECT id FROM trending_stories WHERE url_hash = ?",
      [urlHash],
    );

    if (exists.length === 0) fresh.push({ ...a, urlHash });
  }

  let processed = 0;

  // process each new article
  for (const article of fresh) {
    try {
      // Try to get NLP analysis, but don't block on it
      let claimText = article.content || article.headline;
      let verdict = "unverifiable";
      let confidence = 0.5;
      let tierUsed = "tier0";
      let explanation = null;
      let officialValue = null;
      let claimedValue = null;
      let pctError = null;
      let metric = null;
      let evidenceJson = "[]";

      try {
        // analyze article text to extract claims (short timeout so we don't block)
        const { data: analysis } = await nlp.post("/analyze", {
          text: article.content,
        }, { timeout: 30000 });

        // pick claim with highest confidence
        const top = analysis.results?.sort(
          (a, b) => b.extraction.confidence - a.extraction.confidence,
        )[0];

        if (top && top.extraction.confidence >= 0.3) {
          claimText = top.sentence;

          // verify the extracted claim
          const { data: result } = await nlp.post("/verify", {
            text: top.sentence,
          }, { timeout: 30000 });

          if (result.verdict) {
            verdict = result.verdict;
            confidence = result.confidence || 0.5;
            tierUsed = result.tier_used || "tier1";
            explanation = result.explanation || null;
            officialValue = result.official_value || null;
            claimedValue = result.extracted_value || null;
            pctError = result.percentage_error || null;
            metric = result.extracted_metric || null;
            evidenceJson = JSON.stringify(result.evidence || []);
          }
        }
      } catch (nlpErr) {
        // NLP failed (cold start / timeout) — save article without NLP enrichment
        console.error(`NLP unavailable for trending article, saving without analysis: ${nlpErr.message}`);
      }

      const score = calcDangerScore(verdict, confidence, article.published_at, 1);

      // save trending story (even without NLP analysis)
      await db.query(
        `INSERT INTO trending_stories
           (headline, claim_text, source_name, source_url, url_hash, published_at,
            verdict, confidence, danger_score, metric, official_value,
            claimed_value, pct_error, explanation, evidence_json, tier_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          article.headline,
          claimText,
          article.source_name,
          article.source_url,
          article.urlHash,
          normalizeDate(article.published_at),
          verdict,
          confidence,
          score,
          metric,
          officialValue,
          claimedValue,
          pctError,
          explanation,
          evidenceJson,
          tierUsed,
        ],
      );

      processed++;
    } catch (err) {
      console.error(`skipping "${article.headline}":`, err.message);
    }
  }

  // deactivate stories older than 48 hours
  await db.query(
    "UPDATE trending_stories SET is_active = 0 WHERE fetched_at < DATE_SUB(NOW(), INTERVAL 48 HOUR)",
  );

  // clear redis cache for trending feed (use pipeline to avoid arg-count limits)
  try {
    const keys = await redis.keys("trending_feed:*");
    if (keys.length > 0) {
      const pipeline = redis.pipeline();
      keys.forEach((k) => pipeline.del(k));
      await pipeline.exec();
    }
  } catch { /* redis down */ }

  return processed;
}

exports.runTrendingRefresh = runTrendingRefresh;
