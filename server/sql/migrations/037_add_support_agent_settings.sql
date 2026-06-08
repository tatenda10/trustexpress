CREATE TABLE IF NOT EXISTS support_agent_settings (
  id TINYINT NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  provider VARCHAR(32) NOT NULL DEFAULT 'claude',
  model VARCHAR(64) NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  system_prompt TEXT NOT NULL,
  training_content LONGTEXT NOT NULL,
  updated_by_admin_id INT DEFAULT NULL,
  last_tested_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO support_agent_settings (
  id,
  enabled,
  provider,
  model,
  system_prompt,
  training_content
)
SELECT
  1,
  0,
  'claude',
  'claude-sonnet-4-20250514',
  'You are the Trust Express support assistant. Reply clearly, briefly, and politely using only Trust Express policy and support guidance. If the answer is not fully covered by the training content, say that a human support agent will follow up and ask for the needed trip details. Never invent fees, rules, or promises. Keep replies practical and safe.',
  ''
WHERE NOT EXISTS (
  SELECT 1 FROM support_agent_settings WHERE id = 1
);

SET @has_is_ai_reply = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'support_messages'
    AND COLUMN_NAME = 'is_ai_reply'
);
SET @sql_is_ai_reply = IF(
  @has_is_ai_reply = 0,
  'ALTER TABLE support_messages ADD COLUMN is_ai_reply TINYINT(1) NOT NULL DEFAULT 0 AFTER admin_user_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql_is_ai_reply;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ai_provider = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'support_messages'
    AND COLUMN_NAME = 'ai_provider'
);
SET @sql_ai_provider = IF(
  @has_ai_provider = 0,
  'ALTER TABLE support_messages ADD COLUMN ai_provider VARCHAR(32) DEFAULT NULL AFTER is_ai_reply',
  'SELECT 1'
);
PREPARE stmt FROM @sql_ai_provider;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_ai_model = (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'support_messages'
    AND COLUMN_NAME = 'ai_model'
);
SET @sql_ai_model = IF(
  @has_ai_model = 0,
  'ALTER TABLE support_messages ADD COLUMN ai_model VARCHAR(64) DEFAULT NULL AFTER ai_provider',
  'SELECT 1'
);
PREPARE stmt FROM @sql_ai_model;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
