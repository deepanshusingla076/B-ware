const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const REQUIRED_ENV = ["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length && process.env.NODE_ENV !== "test") {
  console.error(`Missing required env vars: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const db = require("./config/db");
const redis = require("./config/redis");

const app = express();

app.use(helmet());

const ALLOWED_ORIGINS = [
  process.env.FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  "https://b-ware-front.vercel.app",
].filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (req, res) => {
  let dbOk = false;
  let redisOk = false;

  try {
    await db.query("SELECT 1");
    dbOk = true;
  } catch {}

  try {
    await redis.ping();
    redisOk = true;
  } catch {}

  res.json({
    status: dbOk && redisOk ? "healthy" : "degraded",
    mysql: dbOk ? "ok" : "down",
    redis: redisOk ? "ok" : "down",
    timestamp: new Date().toISOString(),
  });
});

const isProduction = process.env.NODE_ENV === "production";
const rateLimitMax = isProduction ? 100 : 500;

app.use(
  "/api/",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests, slow down" },
  }),
);

app.use("/api/auth", require("./routes/authRoutes"));
app.use("/api/claims", require("./routes/claimRoutes"));
app.use("/api/trending", require("./routes/trendingRoutes"));
app.use("/api/outlets", require("./routes/outletRoutes"));

app.use((req, res) =>
  res.status(404).json({ error: `${req.method} ${req.path} not found` }),
);

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err.stack || err.message);
  res.status(err.status && err.status < 500 ? err.status : 500).json({
    error: err.status && err.status < 500 ? err.message : "Internal server error",
  });
});

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "test") {
  const server = app.listen(PORT, () => {
    console.log(`B-ware backend running at http://localhost:${PORT}`);
  });

  function shutdown(signal) {
    console.log(`${signal} received. Shutting down...`);
    server.close(async () => {
      try {
        await db.end();
      } catch {}
      try {
        redis.disconnect();
      } catch {}
      process.exit(0);
    });
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  require("./jobs/trendingJob");
}

module.exports = app;
