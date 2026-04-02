CREATE TABLE IF NOT EXISTS support_threads (
  id BIGINT NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(255) NOT NULL,
  user_role ENUM('driver', 'passenger') NOT NULL,
  status ENUM('open', 'closed') NOT NULL DEFAULT 'open',
  last_message_at TIMESTAMP NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_support_thread_user_role (user_id, user_role),
  KEY idx_support_threads_status_last_message (status, last_message_at),
  KEY idx_support_threads_user_role (user_id, user_role)
);

CREATE TABLE IF NOT EXISTS support_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  thread_id BIGINT NOT NULL,
  sender_type ENUM('driver', 'passenger', 'admin') NOT NULL,
  sender_user_id VARCHAR(255) DEFAULT NULL,
  admin_user_id INT DEFAULT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_support_messages_thread_created (thread_id, created_at),
  KEY idx_support_messages_read (read_at),
  CONSTRAINT fk_support_messages_thread
    FOREIGN KEY (thread_id) REFERENCES support_threads(id)
    ON DELETE CASCADE
);
