ALTER TABLE driver_wallets
  ADD COLUMN promotional_balance DECIMAL(12,2) NOT NULL DEFAULT 0.00 AFTER available_balance;

ALTER TABLE driver_wallet_transactions
  MODIFY COLUMN transaction_type ENUM(
    'top_up_credit',
    'commission_debit',
    'manual_credit',
    'manual_debit',
    'captain_promo_credit',
    'promo_commission_debit'
  ) NOT NULL;

CREATE TABLE IF NOT EXISTS captain_reward_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  cycle_length_days INT UNSIGNED NOT NULL DEFAULT 14,
  cycle_weekday TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '0=Sunday .. 6=Saturday',
  cycle_anchor_starts_at DATETIME NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'USD',
  updated_by_admin_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS captain_reward_tiers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tier_key VARCHAR(32) NOT NULL,
  tier_name VARCHAR(64) NOT NULL,
  badge_color VARCHAR(16) NOT NULL DEFAULT '#2563EB',
  min_rides INT UNSIGNED NOT NULL,
  max_rides INT UNSIGNED NULL DEFAULT NULL,
  reward_amount_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_captain_reward_tiers_key (tier_key)
);

CREATE TABLE IF NOT EXISTS captain_reward_cycles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cycle_key VARCHAR(64) NOT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NOT NULL,
  status ENUM('active', 'closed', 'credited') NOT NULL DEFAULT 'active',
  credited_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_captain_reward_cycles_key (cycle_key),
  KEY idx_captain_reward_cycles_status (status, ends_at)
);

CREATE TABLE IF NOT EXISTS captain_reward_cycle_drivers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cycle_id BIGINT UNSIGNED NOT NULL,
  driver_user_id VARCHAR(255) NOT NULL,
  qualifying_rides_count INT UNSIGNED NOT NULL DEFAULT 0,
  achieved_tier_key VARCHAR(32) NULL DEFAULT NULL,
  reward_amount_usd DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  reward_status ENUM('in_progress', 'qualified', 'credited', 'ineligible') NOT NULL DEFAULT 'in_progress',
  credited_at DATETIME NULL DEFAULT NULL,
  wallet_transaction_id BIGINT UNSIGNED NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_captain_cycle_driver (cycle_id, driver_user_id),
  KEY idx_captain_cycle_drivers_status (cycle_id, reward_status),
  CONSTRAINT fk_captain_cycle_drivers_cycle
    FOREIGN KEY (cycle_id) REFERENCES captain_reward_cycles (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS captain_reward_qualifying_rides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  cycle_id BIGINT UNSIGNED NOT NULL,
  driver_user_id VARCHAR(255) NOT NULL,
  ride_request_id BIGINT NOT NULL,
  completed_at DATETIME NOT NULL,
  counted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_captain_qualifying_ride (cycle_id, ride_request_id),
  KEY idx_captain_qualifying_driver (cycle_id, driver_user_id),
  CONSTRAINT fk_captain_qualifying_cycle
    FOREIGN KEY (cycle_id) REFERENCES captain_reward_cycles (id) ON DELETE CASCADE
);

INSERT INTO captain_reward_settings (id, enabled, cycle_length_days, cycle_weekday, cycle_anchor_starts_at, currency)
SELECT 1, 1, 14, 1, DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL (DAYOFWEEK(CURDATE()) + 5) % 7 DAY), '%Y-%m-%d 00:00:00'), 'USD'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM captain_reward_settings WHERE id = 1);

INSERT INTO captain_reward_tiers (tier_key, tier_name, badge_color, min_rides, max_rides, reward_amount_usd, sort_order, is_active)
SELECT * FROM (
  SELECT 'blue' AS tier_key, 'Blue Captain' AS tier_name, '#2563EB' AS badge_color, 1 AS min_rides, 9 AS max_rides, 0.00 AS reward_amount_usd, 1 AS sort_order, 1 AS is_active
  UNION ALL SELECT 'silver', 'Silver Captain', '#94A3B8', 10, 19, 1.50, 2, 1
  UNION ALL SELECT 'gold', 'Gold Captain', '#EAB308', 20, 34, 3.00, 3, 1
  UNION ALL SELECT 'diamond', 'Diamond Captain', '#06B6D4', 35, NULL, 5.00, 4, 1
) seeded
WHERE NOT EXISTS (SELECT 1 FROM captain_reward_tiers LIMIT 1);
