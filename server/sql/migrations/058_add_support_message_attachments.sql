-- Allow support messages with optional photo attachments (account recovery, ID verification, etc.).
ALTER TABLE support_messages
  ADD COLUMN attachment_url VARCHAR(512) NULL DEFAULT NULL AFTER message;

ALTER TABLE support_messages
  MODIFY COLUMN message TEXT NULL;
