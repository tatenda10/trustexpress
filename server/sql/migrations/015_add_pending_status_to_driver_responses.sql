ALTER TABLE ride_request_driver_responses
MODIFY COLUMN status ENUM('pending', 'accepted', 'declined', 'selected', 'expired') NOT NULL DEFAULT 'pending';
