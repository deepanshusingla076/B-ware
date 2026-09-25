const db = require("../config/db");
const redis = require("../config/redis");
const admin = require("../services/firebaseAdmin");
const {
  sendPasswordResetEmail,
  sendVerificationEmail,
} = require("../services/emailService");

exports.syncUser = async (req, res) => {
  const { uid, email, name, picture } = req.user;

  try {
    const [existing] = await db.query(
      "SELECT id FROM users WHERE firebase_uid = ?",
      [uid],
    );
    const isNewUser = existing.length === 0;

    await db.query(
      `INSERT INTO users (firebase_uid, email, name, avatar_url, role, created_at)
       VALUES (?, ?, ?, ?, 'user', NOW())
       ON DUPLICATE KEY UPDATE
         name         = COALESCE(VALUES(name), name),
         avatar_url   = COALESCE(VALUES(avatar_url), avatar_url),
         last_seen_at = NOW()`,
      [uid, email, name, picture || null],
    );

    const [rows] = await db.query(
      `SELECT id, firebase_uid, name, email, avatar_url, role, created_at
       FROM users WHERE firebase_uid = ?`,
      [uid],
    );

    const user = rows[0];
    if (!user) {
      return res.status(500).json({ error: "User sync failed" });
    }

    try {
      await redis.set(`session:${uid}`, "1", "EX", 7 * 24 * 60 * 60);
      await redis.del(`session_blacklist:${uid}`);
    } catch (redisErr) {
      console.warn("[syncUser] Redis session store failed:", redisErr.message);
    }

    if (isNewUser && !req.user.email_verified) {
      try {
        const actionCodeSettings = {
          url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/login?verified=true`,
        };
        const verifyLink = await admin
          .auth()
          .generateEmailVerificationLink(email, actionCodeSettings);
        await sendVerificationEmail(email, verifyLink);
      } catch (emailErr) {
        console.warn(
          "[syncUser] Could not send verification email:",
          emailErr.message,
        );
      }
    }

    return res.json({
      user,
      emailVerificationSent: isNewUser && !req.user.email_verified,
    });
  } catch (err) {
    console.error("[syncUser] DB error:", err.message);
    return res.status(500).json({ error: "Could not sync user" });
  }
};

exports.getMe = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, firebase_uid, name, email, avatar_url, role, created_at
       FROM users WHERE firebase_uid = ?`,
      [req.user.uid],
    );

    if (!rows[0]) {
      return res.status(404).json({ error: "User not found" });
    }

    return res.json(rows[0]);
  } catch (err) {
    console.error("[getMe] DB error:", err.message);
    return res.status(500).json({ error: "Could not fetch user" });
  }
};

exports.logout = async (req, res) => {
  const { uid } = req.user;

  try {
    await admin.auth().revokeRefreshTokens(uid);
    await redis.set(`session_blacklist:${uid}`, "1", "EX", 24 * 60 * 60);
    await redis.del(`session:${uid}`);
  } catch (err) {
    console.error("[logout] Error:", err.message);
  }

  return res.json({ message: "Logged out" });
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body ?? {};

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "email is required" });
  }

  const normalised = email.trim().toLowerCase();
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_RE.test(normalised)) {
    return res.status(400).json({ error: "Invalid email address" });
  }

  try {
    const resetLink = await admin.auth().generatePasswordResetLink(normalised);
    await sendPasswordResetEmail(normalised, resetLink);
    return res.json({ message: "Password reset email sent" });
  } catch (err) {
    console.error("[forgotPassword] Error:", err.code || err.message);
    return res.json({
      message:
        "If an account exists for this email, a reset link has been sent.",
    });
  }
};

exports.resendVerification = async (req, res) => {
  const { email, email_verified: emailVerified } = req.user;

  if (emailVerified) {
    return res.status(400).json({ error: "Email is already verified" });
  }

  try {
    const actionCodeSettings = {
      url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/login?verified=true`,
    };
    const verifyLink = await admin
      .auth()
      .generateEmailVerificationLink(email, actionCodeSettings);
    await sendVerificationEmail(email, verifyLink);
    return res.json({ message: "Verification email sent" });
  } catch (err) {
    console.error("[resendVerification] Error:", err.message);
    return res.status(500).json({ error: "Could not send verification email" });
  }
};

exports.getEmailVerifiedStatus = async (req, res) => {
  try {
    const userRecord = await admin.auth().getUser(req.user.uid);
    return res.json({
      emailVerified: userRecord.emailVerified,
      email: userRecord.email,
    });
  } catch (err) {
    console.error("[getEmailVerifiedStatus] Error:", err.message);
    return res
      .status(500)
      .json({ error: "Could not fetch verification status" });
  }
};
