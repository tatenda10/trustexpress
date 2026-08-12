CREATE TABLE IF NOT EXISTS rating_performance_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  subject_user_id VARCHAR(128) NOT NULL,
  role VARCHAR(32) NOT NULL,
  action VARCHAR(64) NOT NULL,
  avg_rating DECIMAL(4, 2) NULL,
  sample_size INT UNSIGNED NOT NULL DEFAULT 0,
  from_tier VARCHAR(80) NULL,
  to_tier VARCHAR(80) NULL,
  from_status VARCHAR(32) NULL,
  to_status VARCHAR(32) NULL,
  details_json TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_rating_perf_subject_created (subject_user_id, created_at),
  INDEX idx_rating_perf_role_created (role, created_at)
);
