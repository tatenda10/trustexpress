ALTER TABLE discount_codes
  ADD COLUMN auto_apply_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER allow_multiple_use,
  ADD COLUMN auto_apply_priority INT NOT NULL DEFAULT 0 AFTER auto_apply_enabled;

UPDATE discount_codes
SET auto_apply_enabled = COALESCE(auto_apply_enabled, 0),
    auto_apply_priority = COALESCE(auto_apply_priority, 0)
WHERE 1 = 1;
