ALTER TABLE driver_identity
  ADD COLUMN selfie_with_id_card_url VARCHAR(512) DEFAULT NULL AFTER selfie_url;
