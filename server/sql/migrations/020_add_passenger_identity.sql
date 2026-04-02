CREATE TABLE IF NOT EXISTS passenger_identity (
  passenger_user_id VARCHAR(255) NOT NULL,
  national_id_front_url VARCHAR(512) DEFAULT NULL,
  national_id_back_url VARCHAR(512) DEFAULT NULL,
  identity_status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
  identity_submitted_at TIMESTAMP NULL DEFAULT NULL,
  identity_reviewed_at TIMESTAMP NULL DEFAULT NULL,
  identity_rejection_reason TEXT DEFAULT NULL,
  identity_can_resubmit TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (passenger_user_id)
);
