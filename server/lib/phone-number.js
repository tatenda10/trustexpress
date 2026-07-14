export const LOCAL_PHONE_LENGTH = 10;
export const LOCAL_PHONE_PREFIX = '07';
export const LOCAL_PHONE_REGEX = /^07\d{8}$/;

export const INVALID_LOCAL_PHONE_MESSAGE =
  'Enter a valid 10-digit number starting with 07 (e.g. 0771234567).';

export function sanitizeLocalPhoneInput(value) {
  return String(value || '').replace(/\D/g, '').slice(0, LOCAL_PHONE_LENGTH);
}

export function toLocalPhoneDigits(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (LOCAL_PHONE_REGEX.test(digits)) return digits;
  if (digits.startsWith('263') && digits.length === 12) {
    const local = `0${digits.slice(3)}`;
    if (LOCAL_PHONE_REGEX.test(local)) return local;
  }
  if (digits.length === 9 && digits.startsWith('7')) {
    const local = `0${digits}`;
    if (LOCAL_PHONE_REGEX.test(local)) return local;
  }
  return sanitizeLocalPhoneInput(digits);
}

export function isValidLocalPhoneNumber(value) {
  return LOCAL_PHONE_REGEX.test(toLocalPhoneDigits(value));
}

export function normalizeZimbabwePhoneNumber(value) {
  const localPhone = toLocalPhoneDigits(value);
  if (!LOCAL_PHONE_REGEX.test(localPhone)) {
    return {
      ok: false,
      error: INVALID_LOCAL_PHONE_MESSAGE,
      localPhone: null,
      e164Phone: null,
    };
  }

  return {
    ok: true,
    error: null,
    localPhone,
    e164Phone: `+263${localPhone.slice(1)}`,
  };
}

export function normalizeLookupIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw.toLowerCase();

  const result = normalizeZimbabwePhoneNumber(raw);
  return result.ok ? result.e164Phone : '';
}
