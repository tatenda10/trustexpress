CREATE TABLE IF NOT EXISTS user_account_restrictions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  clerk_user_id VARCHAR(255) NOT NULL,
  user_role ENUM('driver', 'passenger', 'any') NOT NULL DEFAULT 'any',
  scope ENUM('all', 'login', 'request_rides', 'go_online', 'accept_rides', 'cash_out') NOT NULL DEFAULT 'all',
  status ENUM('active', 'lifted', 'expired') NOT NULL DEFAULT 'active',
  reason TEXT NOT NULL,
  starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL DEFAULT NULL,
  created_by_admin_id INT NULL,
  lifted_by_admin_id INT NULL,
  lifted_at TIMESTAMP NULL DEFAULT NULL,
  lift_reason TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_user_restrictions_user_status (clerk_user_id, status),
  KEY idx_user_restrictions_scope_status (scope, status),
  KEY idx_user_restrictions_expiry (expires_at),
  CONSTRAINT fk_user_restrictions_created_by
    FOREIGN KEY (created_by_admin_id) REFERENCES admin_users(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_user_restrictions_lifted_by
    FOREIGN KEY (lifted_by_admin_id) REFERENCES admin_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_account_restriction_audit (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  restriction_id BIGINT UNSIGNED NULL,
  clerk_user_id VARCHAR(255) NOT NULL,
  action ENUM('created', 'extended', 'lifted', 'expired') NOT NULL,
  previous_scope VARCHAR(64) NULL,
  new_scope VARCHAR(64) NULL,
  previous_expires_at TIMESTAMP NULL DEFAULT NULL,
  new_expires_at TIMESTAMP NULL DEFAULT NULL,
  reason TEXT NULL,
  admin_user_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_restriction_audit_user_created (clerk_user_id, created_at),
  KEY idx_restriction_audit_restriction (restriction_id),
  CONSTRAINT fk_restriction_audit_restriction
    FOREIGN KEY (restriction_id) REFERENCES user_account_restrictions(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_restriction_audit_admin
    FOREIGN KEY (admin_user_id) REFERENCES admin_users(id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO permissions (`key`, module, name, description)
VALUES
  ('account_restrictions.read', 'account_restrictions', 'Read Account Restrictions', 'View user blocks, restrictions, and audit history'),
  ('account_restrictions.manage', 'account_restrictions', 'Manage Account Restrictions', 'Create, extend, and lift user blocks and restrictions')
ON DUPLICATE KEY UPDATE
  module = VALUES(module),
  name = VALUES(name),
  description = VALUES(description);

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.`key` IN ('account_restrictions.read', 'account_restrictions.manage')
WHERE r.slug IN ('super_admin', 'support_admin');

INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.`key` = 'account_restrictions.read'
WHERE r.slug IN ('admin', 'operations_admin');
