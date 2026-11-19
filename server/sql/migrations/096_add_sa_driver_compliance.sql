ALTER TABLE driver_identity
  ADD COLUMN registration_country_code CHAR(2) NULL AFTER driver_kind,
  ADD COLUMN identity_document_type VARCHAR(32) NULL AFTER registration_country_code,
  ADD COLUMN residential_address VARCHAR(500) NULL AFTER driver_licence_expires_at,
  ADD COLUMN proof_of_address_url VARCHAR(512) NULL AFTER residential_address,
  ADD COLUMN prdp_number VARCHAR(80) NULL AFTER proof_of_address_url,
  ADD COLUMN prdp_url VARCHAR(512) NULL AFTER prdp_number,
  ADD COLUMN prdp_expires_at DATE NULL AFTER prdp_url,
  ADD COLUMN criminal_record_report_url VARCHAR(512) NULL AFTER prdp_expires_at,
  ADD COLUMN criminal_declaration_accepted_at DATETIME NULL AFTER criminal_record_report_url,
  ADD COLUMN rica_eca_declaration_accepted_at DATETIME NULL AFTER criminal_declaration_accepted_at,
  ADD COLUMN operator_agreement_version VARCHAR(32) NULL AFTER rica_eca_declaration_accepted_at,
  ADD COLUMN operator_agreement_accepted_at DATETIME NULL AFTER operator_agreement_version,
  ADD COLUMN operator_agreement_signature VARCHAR(255) NULL AFTER operator_agreement_accepted_at,
  ADD COLUMN operating_licence_condition_accepted_at DATETIME NULL AFTER operator_agreement_signature;

ALTER TABLE driver_vehicle
  ADD COLUMN first_registered_at DATE NULL AFTER year,
  ADD COLUMN operating_licence_number VARCHAR(128) NULL AFTER zinara_url,
  ADD COLUMN operating_licence_url VARCHAR(512) NULL AFTER operating_licence_number,
  ADD COLUMN operating_licence_expires_at DATE NULL AFTER operating_licence_url,
  ADD COLUMN operator_legal_name VARCHAR(255) NULL AFTER operating_licence_expires_at,
  ADD COLUMN operator_business_address VARCHAR(500) NULL AFTER operator_legal_name,
  ADD COLUMN panic_device_proof_url VARCHAR(512) NULL AFTER operator_business_address,
  ADD COLUMN vehicle_marking_left_url VARCHAR(512) NULL AFTER panic_device_proof_url,
  ADD COLUMN vehicle_marking_right_url VARCHAR(512) NULL AFTER vehicle_marking_left_url;
