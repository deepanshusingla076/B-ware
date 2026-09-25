const cron = require("node-cron");
const redis = require("../config/redis");
const { runTrendingRefresh } = require("../controllers/trendingController");

async function refreshWithLock(label) {
  let lock = null;

  try {
    lock = await redis.set("trending_job_lock", "1", "NX", "EX", 300);
  } catch (err) {
    console.warn(`${label}: Redis lock unavailable:`, err.message);
    lock = "1";
  }

  if (!lock) return;

  try {
    await runTrendingRefresh();
  } catch (err) {
    console.error(`${label}:`, err.message);
  } finally {
    try {
      await redis.del("trending_job_lock");
    } catch {}
  }
}

// Daily at midnight
cron.schedule("0 0 * * *", () => refreshWithLock("trending cron"));

// Local/demo: also refresh shortly after boot so Trending is not empty
if (process.env.NODE_ENV !== "production") {
  setTimeout(() => refreshWithLock("trending startup"), 8000);
}

console.log("trending cron scheduled (daily + startup refresh in non-production)");
