/**
 * Quick-reject presets for driver verification reviews.
 * Keep copy stable so rejected drivers see clear, consistent messages in-app.
 */

export const IDENTITY_REJECT_REASON_GROUPS = [
  {
    label: 'Identity Verification',
    options: [
      'Wrong identity document',
      'Blurry or unreadable file',
      'Name mismatch',
      'Expired identity document',
      'Invalid identity document',
      'Incomplete document',
      'Document damaged',
      'Photo does not match applicant',
      'Selfie does not match ID',
      'Selfie not provided',
      'ID cropped or partially visible',
      'Front/back of ID missing',
      'Duplicate account detected',
      'Suspected fraudulent document',
      'Unsupported identity document',
      'Other (Specify)',
    ],
  },
  {
    label: "Driver's Licence",
    options: [
      "Driver's licence not uploaded",
      "Expired driver's licence",
      "Invalid driver's licence",
      'Wrong licence category',
      'Licence details unreadable',
      'Front/back missing',
    ],
  },
  {
    label: 'Banking',
    options: [
      'Bank details missing',
      'Bank account verification failed',
      'Account name mismatch',
      'Invalid account number',
    ],
  },
  {
    label: 'General',
    options: [
      'Additional information required',
      'Resubmit clear documents',
      'Verification could not be completed',
      'Duplicate submission',
      'Manual review required',
      'Other (Custom reason)',
    ],
  },
]

export const VEHICLE_REJECT_REASON_GROUPS = [
  {
    label: 'Vehicle Verification',
    options: [
      'Registration book not uploaded',
      'Registration book unreadable',
      'Vehicle registration expired',
      'Vehicle not registered to applicant',
      'Vehicle photos missing',
      'Vehicle photos unclear',
      'Vehicle does not meet requirements',
      'Vehicle colour mismatch',
      'Vehicle plate mismatch',
      'Insurance not uploaded',
      'Insurance expired',
      'Insurance invalid',
      'Roadworthy certificate expired',
      'Vehicle inspection required',
    ],
  },
  {
    label: 'Banking',
    options: [
      'Bank details missing',
      'Bank account verification failed',
      'Account name mismatch',
      'Invalid account number',
    ],
  },
  {
    label: 'General',
    options: [
      'Additional information required',
      'Resubmit clear documents',
      'Verification could not be completed',
      'Duplicate submission',
      'Manual review required',
      'Other (Custom reason)',
    ],
  },
]

export const PROFILE_IMAGE_REJECT_REASON_GROUPS = [
  {
    label: 'Profile Photo',
    options: [
      'Photo does not match applicant',
      'Selfie does not match ID',
      'Selfie not provided',
      'Blurry or unreadable file',
      'Suspected fraudulent document',
    ],
  },
  {
    label: 'General',
    options: [
      'Additional information required',
      'Resubmit clear documents',
      'Other (Custom reason)',
    ],
  },
]

export function getRejectReasonGroups(reviewTarget) {
  if (reviewTarget === 'vehicle') return VEHICLE_REJECT_REASON_GROUPS
  if (reviewTarget === 'profile_image') return PROFILE_IMAGE_REJECT_REASON_GROUPS
  return IDENTITY_REJECT_REASON_GROUPS
}

export function isOtherRejectPreset(value) {
  const text = String(value || '').trim().toLowerCase()
  return text.startsWith('other')
}
