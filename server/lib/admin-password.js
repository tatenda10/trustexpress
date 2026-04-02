import crypto from 'crypto';

const PBKDF2_ITERATIONS = 120000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto
    .pbkdf2Sync(String(password), salt, PBKDF2_ITERATIONS, KEY_LENGTH, DIGEST)
    .toString('hex');

  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, iterations, salt, expectedHash] = String(encodedHash).split('$');
    if (algorithm !== 'pbkdf2' || !iterations || !salt || !expectedHash) {
      return false;
    }

    const hash = crypto
      .pbkdf2Sync(String(password), salt, Number(iterations), KEY_LENGTH, DIGEST)
      .toString('hex');

    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch {
    return false;
  }
}