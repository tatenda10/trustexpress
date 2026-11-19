export const LOCAL_PHONE_LENGTH = 10;
export const LOCAL_PHONE_PREFIX = '07';
export const LOCAL_PHONE_REGEX = /^07\d{8}$/;

export const INVALID_LOCAL_PHONE_MESSAGE =
  'Enter a valid 10-digit number starting with 07 (e.g. 0771234567).';

export const INVALID_SA_PHONE_MESSAGE =
  'Enter a valid South African mobile number (e.g. 0712345678 or +27712345678).';

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

export function normalizeSouthAfricaPhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  let national = '';
  if (/^27[6-8]\d{8}$/.test(digits)) national = digits.slice(2);
  else if (/^0[6-8]\d{8}$/.test(digits)) national = digits.slice(1);
  else if (/^[6-8]\d{8}$/.test(digits)) national = digits;

  if (!national) {
    return { ok: false, error: INVALID_SA_PHONE_MESSAGE, localPhone: null, e164Phone: null };
  }
  return {
    ok: true,
    error: null,
    localPhone: `0${national}`,
    e164Phone: `+27${national}`,
  };
}

export function normalizePhoneNumber(value, countryCode = null) {
  const country = String(countryCode || '').trim().toUpperCase();
  const digits = String(value || '').replace(/\D/g, '');
  if (country === 'ZA' || digits.startsWith('27')) return normalizeSouthAfricaPhoneNumber(value);
  return normalizeZimbabwePhoneNumber(value);
}

export function normalizeLookupIdentifier(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw.toLowerCase();

  const result = normalizePhoneNumber(raw, raw.replace(/\D/g, '').startsWith('27') ? 'ZA' : 'ZW');
  return result.ok ? result.e164Phone : '';
}
