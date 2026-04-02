-- Add phone verification fields to users (run once on existing DBs)
ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) DEFAULT NULL;
ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMP NULL DEFAULT NULL;
