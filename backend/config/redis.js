const Redis = require("ioredis");

const REDIS_URL = process.env.REDIS_URL;
let available = false;

function createStub() {
  const noop = async () => null;
  return {
    status: "end",
    get: noop,
    set: noop,
    del: noop,
    ping: async () => {
      throw new Error("Redis unavailable");
    },
    call: async () => {
      throw new Error("Redis unavailable");
    },
    keys: async () => [],
    pipeline: () => ({
      del: () => {},
      exec: async () => [],
    }),
    disconnect: () => {},
    quit: async () => "OK",
    on: () => {},
  };
}

function createClient(url) {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    retryStrategy: (times) => {
      if (times > 10) {
        console.error("Redis: giving up after repeated failures");
        available = false;
        return null;
      }
      return Math.min(times * 200, 3000);
    },
    enableReadyCheck: false,
    connectTimeout: 10000,
  });

  client.on("connect", () => {
    available = true;
    console.log("Redis connected");
  });
  client.on("ready", () => {
    available = true;
  });
  client.on("close", () => {
    available = false;
  });
  client.on("end", () => {
    available = false;
  });
  client.on("error", (err) => {
    available = false;
    if (createClient._lastError !== err.message) {
      createClient._lastError = err.message;
      console.error("Redis error:", err.message);
    }
  });

  return client;
}

let redis;

if (!REDIS_URL) {
  console.warn("REDIS_URL not set — running without Redis");
  redis = createStub();
} else {
  redis = createClient(REDIS_URL);
}

redis.isAvailable = () => available;

module.exports = redis;
