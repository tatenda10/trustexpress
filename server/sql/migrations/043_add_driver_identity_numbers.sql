ALTER TABLE driver_identity
  ADD COLUMN national_id_number VARCHAR(64) NULL DEFAULT NULL AFTER selfie_with_id_card_url,
  ADD COLUMN driver_licence_number VARCHAR(64) NULL DEFAULT NULL AFTER national_id_number;

CREATE UNIQUE INDEX uniq_driver_identity_national_id_number
  ON driver_identity (national_id_number);

CREATE UNIQUE INDEX uniq_driver_identity_driver_licence_number
  ON driver_identity (driver_licence_number);
