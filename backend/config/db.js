const mysql = require("mysql2/promise");
const fs = require("fs");
const path = require("path");

const host = process.env.DB_HOST || "127.0.0.1";
const useSsl =
  process.env.DB_SSL === "true" ||
  (host !== "localhost" && host !== "127.0.0.1");

const dbConfig = {
  host,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  multipleStatements: true,
};

if (useSsl) {
  const caPath = process.env.DB_SSL_CA || path.join(__dirname, "ca.pem");
  try {
    dbConfig.ssl = {
      ca: fs.readFileSync(caPath),
      minVersion: "TLSv1.2",
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false",
    };
  } catch (err) {
    console.error(`[MySQL] SSL CA missing at ${caPath}:`, err.message);
    throw err;
  }
}

console.log(
  `[MySQL] Connecting to ${dbConfig.host}:${dbConfig.port} as ${dbConfig.user} (db=${dbConfig.database}${useSsl ? ", ssl" : ""})`,
);

const pool = mysql.createPool(dbConfig);

pool
  .getConnection()
  .then((conn) => {
    console.log("MySQL connected");
    conn.release();
  })
  .catch((err) => {
    console.error("MySQL failed:", err.message);
  });

module.exports = pool;
