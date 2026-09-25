const axios = require("axios");

const nlp = axios.create({
  baseURL: process.env.NLP_SERVICE_URL || "http://127.0.0.1:5001",
  // Full verify (Tier 2 NLI) can take 30–90s on first model load
  timeout: Number(process.env.NLP_TIMEOUT_MS) || 180000,
  headers: { "Content-Type": "application/json" },
});

nlp.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.detail ?? err.message;
    const e = new Error(`NLP Error [${status}]: ${detail}`);
    e.status = status;
    e.nlpDetail = detail;
    return Promise.reject(e);
  },
);

module.exports = nlp;
