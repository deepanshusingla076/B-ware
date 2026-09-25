CREATE DATABASE IF NOT EXISTS bware_ai
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE bware_ai;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  firebase_uid  VARCHAR(128) NOT NULL,
  name          VARCHAR(100) NULL,
  email         VARCHAR(150) NULL,
  avatar_url    TEXT NULL,
  role          ENUM('user','admin') DEFAULT 'user',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  TIMESTAMP NULL,
  UNIQUE KEY idx_firebase_uid (firebase_uid),
  UNIQUE KEY idx_email (email)
);

CREATE TABLE IF NOT EXISTS claims (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           VARCHAR(128) NULL,
  original_text     TEXT NOT NULL,
  claim_hash        CHAR(64) NULL,
  extracted_metric  VARCHAR(200) NULL,
  extracted_value   DECIMAL(20,2) NULL,
  extracted_year    INT NULL,
  credibility_score DECIMAL(5,2) NULL,
  verdict           ENUM('accurate','misleading','false','unverifiable') NULL,
  confidence        FLOAT NULL,
  status            ENUM('pending','verified','failed') DEFAULT 'pending',
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_claim_hash (claim_hash),
  INDEX idx_user_created (user_id, created_at)
);

CREATE TABLE IF NOT EXISTS verification_log (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  claim_id         INT NOT NULL,
  official_value   DECIMAL(20,2) NULL,
  claimed_value    DECIMAL(20,2) NULL,
  difference       DECIMAL(20,2) NULL,
  percentage_error DECIMAL(5,2) NULL,
  verdict          ENUM('accurate','misleading','false','unverifiable') NOT NULL,
  tier_used        VARCHAR(20) NOT NULL DEFAULT 'tier1',
  tiers_run        JSON NULL,
  confidence       DECIMAL(5,4) NULL,
  explanation      TEXT NULL,
  evidence_json    JSON NULL,
  verified_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_claim_id (claim_id),
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trending_stories (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  headline       TEXT NOT NULL,
  claim_text     TEXT NULL,
  source_name    VARCHAR(255) NULL,
  source_url     TEXT NULL,
  published_at   DATETIME NULL,
  fetched_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  verdict        ENUM('accurate','misleading','false','unverifiable') NULL,
  confidence     FLOAT NULL,
  danger_score   FLOAT DEFAULT 0,
  metric         VARCHAR(100) NULL,
  official_value FLOAT NULL,
  claimed_value  FLOAT NULL,
  pct_error      FLOAT NULL,
  explanation    TEXT NULL,
  evidence_json  JSON NULL,
  tier_used      VARCHAR(20) NULL,
  is_active      TINYINT(1) DEFAULT 1,
  url_hash       CHAR(32) NULL,
  INDEX idx_danger (danger_score),
  INDEX idx_fetched (fetched_at),
  INDEX idx_active (is_active),
  INDEX idx_url_hash (url_hash)
);

CREATE TABLE IF NOT EXISTS user_outlet_preferences (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(128) NOT NULL,
  outlet_name VARCHAR(255) NOT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_user_outlet (user_id, outlet_name),
  INDEX idx_user_id (user_id)
);

CREATE TABLE IF NOT EXISTS source_stats (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  source_name      VARCHAR(255) UNIQUE NOT NULL,
  total_claims     INT DEFAULT 0,
  accurate_count   INT DEFAULT 0,
  misleading_count INT DEFAULT 0,
  false_count      INT DEFAULT 0,
  avg_danger_score FLOAT DEFAULT 0,
  last_updated     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Demo trending rows (skipped if empty so first local run is not blank)
INSERT INTO trending_stories
  (headline, claim_text, source_name, source_url, published_at, verdict, confidence, danger_score, metric, official_value, claimed_value, pct_error, explanation, tier_used, is_active, url_hash)
SELECT * FROM (
  SELECT
    'India GDP growth claimed at 10% for 2023' AS headline,
    'India GDP grew by 10% in 2023' AS claim_text,
    'BBC' AS source_name,
    'https://example.com/demo/gdp-10' AS source_url,
    DATE_SUB(NOW(), INTERVAL 6 HOUR) AS published_at,
    'misleading' AS verdict,
    0.82 AS confidence,
    55 AS danger_score,
    'GDP growth' AS metric,
    7.6 AS official_value,
    10.0 AS claimed_value,
    31.6 AS pct_error,
    'Official World Bank figure for India GDP growth is lower than the claimed 10%.' AS explanation,
    'tier1' AS tier_used,
    1 AS is_active,
    MD5('https://example.com/demo/gdp-10') AS url_hash
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM trending_stories LIMIT 1);

INSERT INTO trending_stories
  (headline, claim_text, source_name, source_url, published_at, verdict, confidence, danger_score, metric, official_value, claimed_value, pct_error, explanation, tier_used, is_active, url_hash)
SELECT * FROM (
  SELECT
    'Inflation in India said to hit 15% last year' AS headline,
    'India inflation reached 15% last year' AS claim_text,
    'Reuters' AS source_name,
    'https://example.com/demo/inflation-15' AS source_url,
    DATE_SUB(NOW(), INTERVAL 12 HOUR) AS published_at,
    'false' AS verdict,
    0.91 AS confidence,
    88 AS danger_score,
    'inflation' AS metric,
    5.4 AS official_value,
    15.0 AS claimed_value,
    177.8 AS pct_error,
    'Claimed inflation is far above the official reported range.' AS explanation,
    'tier1' AS tier_used,
    1 AS is_active,
    MD5('https://example.com/demo/inflation-15') AS url_hash
) AS seed
WHERE (SELECT COUNT(*) FROM trending_stories) < 2;

