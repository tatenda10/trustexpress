CREATE TABLE IF NOT EXISTS discount_codes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  description TEXT NULL,
  discount_type ENUM('fixed', 'percent') NOT NULL DEFAULT 'fixed',
  discount_value DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  max_discount_amount DECIMAL(10,2) NULL DEFAULT NULL,
  min_ride_amount DECIMAL(10,2) NULL DEFAULT NULL,
  usage_limit_total INT NULL DEFAULT NULL,
  usage_limit_per_passenger INT NULL DEFAULT NULL,
  allow_multiple_use TINYINT(1) NOT NULL DEFAULT 1,
  starts_at TIMESTAMP NULL DEFAULT NULL,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by_admin_id VARCHAR(191) NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_discount_codes_code (code),
  KEY idx_discount_codes_active (is_active, starts_at, expires_at)
);

ALTER TABLE ride_requests
  ADD COLUMN original_estimated_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER estimated_amount,
  ADD COLUMN discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER original_estimated_amount,
  ADD COLUMN final_estimated_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER discount_amount,
  ADD COLUMN driver_reimbursement_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER final_estimated_amount,
  ADD COLUMN discount_code_id BIGINT UNSIGNED NULL DEFAULT NULL AFTER driver_reimbursement_amount,
  ADD COLUMN discount_code VARCHAR(64) NULL DEFAULT NULL AFTER discount_code_id,
  ADD COLUMN discount_type VARCHAR(16) NULL DEFAULT NULL AFTER discount_code,
  ADD COLUMN discount_value DECIMAL(10,2) NULL DEFAULT NULL AFTER discount_type,
  ADD COLUMN discount_applied_at TIMESTAMP NULL DEFAULT NULL AFTER discount_value;

UPDATE ride_requests
SET original_estimated_amount = COALESCE(NULLIF(original_estimated_amount, 0.00), estimated_amount, 0.00),
    discount_amount = COALESCE(discount_amount, 0.00),
    final_estimated_amount = COALESCE(NULLIF(final_estimated_amount, 0.00), estimated_amount, 0.00),
    driver_reimbursement_amount = COALESCE(driver_reimbursement_amount, 0.00)
WHERE 1 = 1;

ALTER TABLE ride_requests
  ADD KEY idx_ride_requests_discount_code_id (discount_code_id),
  ADD KEY idx_ride_requests_discount_code (discount_code),
  ADD CONSTRAINT fk_ride_requests_discount_code
    FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
    ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS discount_code_redemptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  discount_code_id BIGINT UNSIGNED NOT NULL,
  ride_request_id BIGINT NOT NULL,
  passenger_user_id VARCHAR(191) NOT NULL,
  driver_user_id VARCHAR(191) NULL DEFAULT NULL,
  code_snapshot VARCHAR(64) NOT NULL,
  discount_type_snapshot VARCHAR(16) NOT NULL,
  discount_value_snapshot DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  original_fare_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  discount_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  final_fare_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  driver_reimbursement_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  status ENUM('applied', 'approved', 'reimbursed', 'cancelled') NOT NULL DEFAULT 'applied',
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reimbursed_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_discount_code_redemptions_ride (ride_request_id),
  KEY idx_discount_code_redemptions_code (discount_code_id),
  KEY idx_discount_code_redemptions_driver (driver_user_id, status),
  KEY idx_discount_code_redemptions_passenger (passenger_user_id),
  CONSTRAINT fk_discount_redemptions_code
    FOREIGN KEY (discount_code_id) REFERENCES discount_codes(id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_discount_redemptions_ride
    FOREIGN KEY (ride_request_id) REFERENCES ride_requests(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS driver_discount_reimbursements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  driver_user_id VARCHAR(191) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_discount_reimbursement DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  ride_count INT NOT NULL DEFAULT 0,
  status ENUM('pending', 'approved', 'paid') NOT NULL DEFAULT 'pending',
  admin_note TEXT NULL,
  created_by_admin_id VARCHAR(191) NULL DEFAULT NULL,
  approved_by_admin_id VARCHAR(191) NULL DEFAULT NULL,
  approved_at TIMESTAMP NULL DEFAULT NULL,
  paid_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_driver_discount_reimbursements_period (driver_user_id, period_start, period_end),
  KEY idx_driver_discount_reimbursements_status (status, period_start, period_end)
);

CREATE TABLE IF NOT EXISTS driver_discount_reimbursement_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reimbursement_id BIGINT UNSIGNED NOT NULL,
  redemption_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_driver_discount_reimbursement_item_redemption (redemption_id),
  KEY idx_driver_discount_reimbursement_items_reimbursement (reimbursement_id),
  CONSTRAINT fk_driver_discount_reimbursement_items_reimbursement
    FOREIGN KEY (reimbursement_id) REFERENCES driver_discount_reimbursements(id)
    ON DELETE CASCADE,
  CONSTRAINT fk_driver_discount_reimbursement_items_redemption
    FOREIGN KEY (redemption_id) REFERENCES discount_code_redemptions(id)
    ON DELETE CASCADE
);
