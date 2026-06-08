ALTER TABLE ride_requests
  ADD COLUMN passenger_driver_feedback_tags JSON NULL AFTER passenger_driver_review,
  ADD COLUMN driver_passenger_feedback_tags JSON NULL AFTER driver_passenger_review;

ALTER TABLE ride_lost_items
  ADD COLUMN case_reference VARCHAR(64) NULL AFTER contact_phone,
  ADD COLUMN case_priority ENUM('normal', 'high') NOT NULL DEFAULT 'normal' AFTER case_reference,
  ADD COLUMN assigned_admin_id INT NULL AFTER admin_note,
  ADD COLUMN follow_up_status ENUM('pending', 'contacted', 'resolved', 'closed') NOT NULL DEFAULT 'pending' AFTER assigned_admin_id,
  ADD COLUMN follow_up_note TEXT NULL AFTER follow_up_status,
  ADD COLUMN follow_up_due_at TIMESTAMP NULL DEFAULT NULL AFTER follow_up_note,
  ADD COLUMN last_followed_up_at TIMESTAMP NULL DEFAULT NULL AFTER follow_up_due_at,
  ADD COLUMN resolved_at TIMESTAMP NULL DEFAULT NULL AFTER last_followed_up_at;

ALTER TABLE ride_panic_alerts
  ADD COLUMN case_reference VARCHAR(64) NULL AFTER message,
  ADD COLUMN case_priority ENUM('high', 'critical') NOT NULL DEFAULT 'critical' AFTER case_reference,
  ADD COLUMN assigned_admin_id INT NULL AFTER admin_note,
  ADD COLUMN follow_up_status ENUM('pending', 'contacted', 'monitoring', 'police_alerted', 'resolved') NOT NULL DEFAULT 'pending' AFTER assigned_admin_id,
  ADD COLUMN follow_up_note TEXT NULL AFTER follow_up_status,
  ADD COLUMN follow_up_due_at TIMESTAMP NULL DEFAULT NULL AFTER follow_up_note,
  ADD COLUMN last_followed_up_at TIMESTAMP NULL DEFAULT NULL AFTER follow_up_due_at,
  ADD COLUMN resolved_at TIMESTAMP NULL DEFAULT NULL AFTER last_followed_up_at;
