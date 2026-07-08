ALTER TABLE ride_requests
  ADD COLUMN cancelled_by VARCHAR(32) NULL DEFAULT NULL AFTER cancellation_reason;

-- Best-effort backfill from existing free-text reasons / expired status.
UPDATE ride_requests
SET cancelled_by = 'system'
WHERE cancelled_by IS NULL
  AND status = 'expired';

UPDATE ride_requests
SET cancelled_by = 'driver'
WHERE cancelled_by IS NULL
  AND status = 'cancelled'
  AND (
    LOWER(COALESCE(cancellation_reason, '')) LIKE '%driver cancelled%'
    OR LOWER(COALESCE(cancellation_reason, '')) LIKE 'driver %'
    OR LOWER(COALESCE(cancellation_reason, '')) IN (
      'passenger no-show',
      'passenger requested cancellation',
      'wrong pickup/drop-off location',
      'safety concern',
      'vehicle issue',
      'personal emergency',
      'pickup too far'
    )
  );

UPDATE ride_requests
SET cancelled_by = 'passenger'
WHERE cancelled_by IS NULL
  AND status = 'cancelled'
  AND (
    LOWER(COALESCE(cancellation_reason, '')) LIKE '%passenger cancelled%'
    OR LOWER(COALESCE(cancellation_reason, '')) LIKE 'passenger %'
    OR LOWER(COALESCE(cancellation_reason, '')) IN (
      'found another ride',
      'wrong destination entered',
      'driver too far / long wait',
      'change of plans',
      'booking mistake'
    )
  );

UPDATE ride_requests
SET cancelled_by = 'system'
WHERE cancelled_by IS NULL
  AND status = 'cancelled'
  AND LOWER(COALESCE(cancellation_reason, '')) LIKE '%no driver accepted%';
