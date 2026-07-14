CREATE TABLE IF NOT EXISTS passenger_referral_codes (
  passenger_user_id VARCHAR(255) NOT NULL,
  referral_code VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (passenger_user_id),
  UNIQUE KEY uniq_passenger_referral_codes_code (referral_code)
);

CREATE TABLE IF NOT EXISTS passenger_peer_referrals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  referrer_user_id VARCHAR(255) NOT NULL,
  referred_user_id VARCHAR(255) NOT NULL,
  referral_code VARCHAR(32) NULL DEFAULT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'signup_code',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_passenger_peer_referrals_referred (referred_user_id),
  KEY idx_passenger_peer_referrals_referrer (referrer_user_id, created_at),
  KEY idx_passenger_peer_referrals_code (referral_code)
);
