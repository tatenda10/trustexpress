ALTER TABLE passenger_identity
  ADD COLUMN selfie_url VARCHAR(512) DEFAULT NULL AFTER national_id_back_url;
