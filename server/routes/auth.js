import { Router } from 'express';
import { query } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { assertNoActiveRestriction, restrictionErrorResponse } from '../lib/account-restrictions.js';
import {
  assertLoginNotLocked,
  assertPasswordStrength,
  checkPassword,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByPhone,
  hashPassword,
  markEmailVerified,
  markPhoneVerified,
  normalizeEmail,
  normalizePhone,
  normalizeRole,
  recordLoginAttempt,
  setUserPassword,
  toPublicUser,
} from '../lib/auth/accounts.js';
import { sendCode, verifyCode } from '../lib/auth/codes.js';
import {
  createSession,
  refreshSession,
  revokeAllUserSessions,
  revokeSession,
  signJwt,
  verifyJwt,
} from '../lib/auth/tokens.js';

const router = Router();
const PHONE_SIGNUP_TOKEN_TTL_SECONDS = 15 * 60;

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return (forwarded || req.socket?.remoteAddress || '').slice(0, 64) || null;
}

function badRequest(message, code = 'INVALID_REQUEST') {
  return Object.assign(new Error(message), { status: 400, code });
}

function sendError(res, error, label) {
  if (error?.restriction || error?.code === 'ACCOUNT_RESTRICTED') {
    return res.status(error?.status || 403).json(restrictionErrorResponse(error));
  }
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(`[auth] ${label}`, error);
  return res.status(status).json({
    error: status >= 500 && !error?.code ? 'Server error' : error?.message || 'Request failed',
    code: error?.code || null,
    retryAfterSeconds: error?.retryAfterSeconds ?? undefined,
  });
}

function deviceInfo(req) {
  return {
    deviceName: req.body?.deviceName || null,
    platform: req.body?.platform || null,
    ipAddress: getClientIp(req),
  };
}

async function startSession(req, user) {
  await assertNoActiveRestriction(user.id, 'login');
  const tokens = await createSession({ userId: user.id, role: normalizeRole(user.role), ...deviceInfo(req) });
  await query('UPDATE users SET last_sign_in_at = CURRENT_TIMESTAMP WHERE clerk_user_id = ?', [user.id]).catch(() => {});
  return { ...tokens, user: toPublicUser(user) };
}

function readChannel(value, fallback) {
  const channel = String(value || fallback).trim().toLowerCase();
  if (!['email', 'sms', 'whatsapp'].includes(channel)) throw badRequest('Choose email, SMS or WhatsApp');
  return channel;
}

// ---------- Phone: code by WhatsApp or SMS, no password ----------

router.post('/phone/send-code', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw badRequest('Enter a valid number starting with 07 (e.g. 0771234567).', 'INVALID_PHONE');
    const channel = readChannel(req.body?.channel, 'whatsapp');
    if (channel === 'email') throw badRequest('Choose SMS or WhatsApp');
    const role = normalizeRole(req.body?.role);

    // Same response whether or not an account exists; the verify step decides sign-in vs sign-up.
    const result = await sendCode({ purpose: 'sign_in', channel, destination: phone, role, ipAddress: getClientIp(req) });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'phone/send-code');
  }
});

router.post('/phone/verify', async (req, res) => {
  try {
    const phone = normalizePhone(req.body?.phone);
    if (!phone) throw badRequest('Enter a valid phone number.', 'INVALID_PHONE');
    const role = normalizeRole(req.body?.role);
    await verifyCode({ purpose: 'sign_in', destination: phone, code: req.body?.code });

    const user = await findUserByPhone(phone, role);
    if (user) {
      await markPhoneVerified(user.id, phone);
      return res.json({ ok: true, status: 'signed_in', ...(await startSession(req, await findUserById(user.id))) });
    }

    // New number: the app collects a name, then calls /phone/complete-sign-up with this token.
    const signupToken = signJwt({ typ: 'phone_signup', phone, role }, PHONE_SIGNUP_TOKEN_TTL_SECONDS);
    return res.json({ ok: true, status: 'needs_profile', signupToken });
  } catch (error) {
    return sendError(res, error, 'phone/verify');
  }
});

router.post('/phone/complete-sign-up', async (req, res) => {
  try {
    const claims = verifyJwt(req.body?.signupToken, 'phone_signup');
    if (!claims) throw badRequest('Sign-up expired. Please request a new code.', 'SIGNUP_EXPIRED');

    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    if (!firstName) throw badRequest('Enter your first name.');
    const email = req.body?.email ? normalizeEmail(req.body.email) : null;
    if (req.body?.email && !email) throw badRequest('Enter a valid email address.', 'INVALID_EMAIL');

    const existing = await findUserByPhone(claims.phone, claims.role);
    if (existing) {
      return res.json({ ok: true, status: 'signed_in', ...(await startSession(req, existing)) });
    }
    if (email && await findUserByEmail(email, claims.role)) {
      throw Object.assign(new Error('That email already has an account. Sign in with email instead.'), {
        status: 409,
        code: 'EMAIL_IN_USE',
      });
    }

    const user = await createUser({
      role: claims.role,
      phone: claims.phone,
      phoneVerified: true,
      email,
      firstName,
      lastName,
    });
    return res.status(201).json({ ok: true, status: 'signed_in', ...(await startSession(req, user)) });
  } catch (error) {
    if (error?.status === 401) error.code = 'SIGNUP_EXPIRED';
    return sendError(res, error, 'phone/complete-sign-up');
  }
});

// ---------- Email + password ----------

router.post('/email/sign-up', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) throw badRequest('Enter a valid email address.', 'INVALID_EMAIL');
    const role = normalizeRole(req.body?.role);
    assertPasswordStrength(req.body?.password);
    const firstName = String(req.body?.firstName || '').trim();
    const lastName = String(req.body?.lastName || '').trim();
    if (!firstName) throw badRequest('Enter your first name.');

    const existing = await findUserByEmail(email, role);
    if (existing?.email_verified_at) {
      throw Object.assign(new Error('That email already has an account. Please sign in.'), {
        status: 409,
        code: 'EMAIL_IN_USE',
      });
    }

    const passwordHash = await hashPassword(req.body.password);
    if (existing) {
      // Unfinished earlier sign-up: take the new details and resend the code.
      await setUserPassword(existing.id, passwordHash);
    } else {
      await createUser({ role, email, firstName, lastName, passwordHash });
    }

    const result = await sendCode({ purpose: 'verify_email', channel: 'email', destination: email, role, ipAddress: getClientIp(req) });
    return res.status(201).json({ ok: true, status: 'verify_email', ...result });
  } catch (error) {
    return sendError(res, error, 'email/sign-up');
  }
});

router.post('/email/verify', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) throw badRequest('Enter a valid email address.', 'INVALID_EMAIL');
    const role = normalizeRole(req.body?.role);
    await verifyCode({ purpose: 'verify_email', destination: email, code: req.body?.code });

    const user = await findUserByEmail(email, role);
    if (!user) throw badRequest('Account not found. Please sign up again.', 'ACCOUNT_NOT_FOUND');
    await markEmailVerified(user.id);
    return res.json({ ok: true, status: 'signed_in', ...(await startSession(req, await findUserById(user.id))) });
  } catch (error) {
    return sendError(res, error, 'email/verify');
  }
});

router.post('/email/resend-code', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) throw badRequest('Enter a valid email address.', 'INVALID_EMAIL');
    const role = normalizeRole(req.body?.role);
    const user = await findUserByEmail(email, role);
    if (user && !user.email_verified_at) {
      const result = await sendCode({ purpose: 'verify_email', channel: 'email', destination: email, role, ipAddress: getClientIp(req) });
      return res.json({ ok: true, ...result });
    }
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, 'email/resend-code');
  }
});

router.post('/email/sign-in', async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) throw badRequest('Enter a valid email address.', 'INVALID_EMAIL');
    const role = normalizeRole(req.body?.role);
    const ipAddress = getClientIp(req);
    const attemptKey = `email:${role}:${email}`;
    await assertLoginNotLocked(attemptKey, ipAddress);

    const user = await findUserByEmail(email, role);
    if (user && !user.password_hash) {
      // Imported account whose password didn't carry over from Clerk.
      throw Object.assign(new Error('Please set a new password to continue. Tap "Forgot password".'), {
        status: 409,
        code: 'PASSWORD_RESET_REQUIRED',
      });
    }

    const passwordOk = await checkPassword(req.body?.password, user?.password_hash);
    await recordLoginAttempt(attemptKey, ipAddress, passwordOk);
    if (!user || !passwordOk) {
      throw Object.assign(new Error('Email or password is incorrect.'), { status: 401, code: 'INVALID_CREDENTIALS' });
    }

    if (!user.email_verified_at) {
      const result = await sendCode({ purpose: 'verify_email', channel: 'email', destination: email, role, ipAddress });
      return res.json({ ok: true, status: 'verify_email', ...result });
    }
    return res.json({ ok: true, status: 'signed_in', ...(await startSession(req, user)) });
  } catch (error) {
    return sendError(res, error, 'email/sign-in');
  }
});

// ---------- Password reset by email or phone code ----------

async function resolveResetTarget(body) {
  const role = normalizeRole(body?.role);
  const identifier = String(body?.identifier || '').trim();
  if (identifier.includes('@')) {
    const email = normalizeEmail(identifier);
    if (!email) throw badRequest('Enter a valid email address.', 'INVALID_EMAIL');
    return { role, destination: email, user: await findUserByEmail(email, role), channel: 'email' };
  }
  const phone = normalizePhone(identifier);
  if (!phone) throw badRequest('Enter your email or phone number.', 'INVALID_IDENTIFIER');
  const channel = readChannel(body?.channel, 'whatsapp');
  if (channel === 'email') throw badRequest('Choose SMS or WhatsApp');
  return { role, destination: phone, user: await findUserByPhone(phone, role), channel };
}

router.post('/password/forgot', async (req, res) => {
  try {
    const target = await resolveResetTarget(req.body);
    // Don't reveal whether an account exists.
    if (!target.user) return res.json({ ok: true, channel: target.channel });
    const result = await sendCode({
      purpose: 'reset_password',
      channel: target.channel,
      destination: target.destination,
      role: target.role,
      ipAddress: getClientIp(req),
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return sendError(res, error, 'password/forgot');
  }
});

router.post('/password/reset', async (req, res) => {
  try {
    assertPasswordStrength(req.body?.newPassword);
    const target = await resolveResetTarget(req.body);
    await verifyCode({ purpose: 'reset_password', destination: target.destination, code: req.body?.code });
    if (!target.user) throw badRequest('That code is not correct or has expired.', 'CODE_INVALID');

    await setUserPassword(target.user.id, await hashPassword(req.body.newPassword));
    if (target.channel === 'email') await markEmailVerified(target.user.id);
    else await markPhoneVerified(target.user.id, target.destination);
    await revokeAllUserSessions(target.user.id, { reason: 'password_reset' });

    return res.json({ ok: true, status: 'signed_in', ...(await startSession(req, await findUserById(target.user.id))) });
  } catch (error) {
    return sendError(res, error, 'password/reset');
  }
});

// ---------- Session ----------

router.post('/refresh', async (req, res) => {
  try {
    const tokens = await refreshSession(req.body?.refreshToken, {
      loadRole: async (userId) => normalizeRole((await findUserById(userId))?.role),
    });
    return res.json({ ok: true, ...tokens });
  } catch (error) {
    return sendError(res, error, 'refresh');
  }
});

router.post('/sign-out', async (req, res) => {
  try {
    const sessionId = String(req.body?.refreshToken || '').split('.')[0];
    if (/^[a-f0-9]{32}$/.test(sessionId)) await revokeSession(sessionId, 'sign_out');
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, 'sign-out');
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    return res.json({ ok: true, user: toPublicUser(user) });
  } catch (error) {
    return sendError(res, error, 'me');
  }
});

router.post('/password/verify', requireAuth, async (req, res) => {
  try {
    const ipAddress = getClientIp(req);
    const attemptKey = `verify:${req.userId}`;
    await assertLoginNotLocked(attemptKey, ipAddress);
    const user = await findUserById(req.userId);
    const passwordOk = await checkPassword(req.body?.password, user?.password_hash);
    await recordLoginAttempt(attemptKey, ipAddress, passwordOk);
    if (!passwordOk) {
      throw Object.assign(new Error('That password is not correct.'), { status: 400, code: 'INVALID_CREDENTIALS' });
    }
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, 'password/verify');
  }
});

router.post('/password/change', requireAuth, async (req, res) => {
  try {
    assertPasswordStrength(req.body?.newPassword);
    const user = await findUserById(req.userId);
    if (!user) return res.status(404).json({ error: 'Account not found' });
    if (user.password_hash && !(await checkPassword(req.body?.currentPassword, user.password_hash))) {
      throw Object.assign(new Error('Current password is incorrect.'), { status: 401, code: 'INVALID_CREDENTIALS' });
    }
    await setUserPassword(user.id, await hashPassword(req.body.newPassword));
    await revokeAllUserSessions(user.id, { exceptSessionId: req.auth?.sid || null, reason: 'password_changed' });
    return res.json({ ok: true });
  } catch (error) {
    return sendError(res, error, 'password/change');
  }
});

export default router;
