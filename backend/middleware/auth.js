const admin = require('../services/firebaseAdmin');
const redis = require('../config/redis');

module.exports = async function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const idToken = header.split(' ')[1];

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    console.error('[auth] Token verification failed:', err.code || err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  // /sync must run even after logout so a fresh login can clear the blacklist
  if (!req.originalUrl || !req.originalUrl.includes('/sync')) {
    try {
      const blacklisted = await redis.get(`session_blacklist:${decoded.uid}`);
      if (blacklisted) {
        return res.status(401).json({ error: 'Session has been revoked. Please log in again.' });
      }
    } catch {
      // Redis down — don't block the request
    }

    if (decoded.email && decoded.email_verified === false) {
      if (
        !req.originalUrl ||
        (!req.originalUrl.includes('/verify-email') &&
          !req.originalUrl.includes('/logout'))
      ) {
        return res
          .status(403)
          .json({ error: 'Please verify your email address to access this resource.' });
      }
    }
  }

  req.user = {
    uid: decoded.uid,
    email: decoded.email,
    name: decoded.name || decoded.email?.split('@')[0] || 'User',
    picture: decoded.picture || null,
    email_verified: decoded.email_verified === true,
  };

  next();
};
