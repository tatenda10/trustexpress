ALTER TABLE agent_users
  ADD COLUMN id_number VARCHAR(64) DEFAULT NULL AFTER employee_code,
  ADD COLUMN address TEXT DEFAULT NULL AFTER id_number;
