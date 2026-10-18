import { apiFetch } from '../api';
import { getDeviceInfo } from './AuthProvider';

function post(path, body) {
  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({ ...body, ...getDeviceInfo() }),
    suppressAuthErrorHandler: true,
  });
}

export const sendPhoneCode = ({ phone, role, channel }) => post('/api/auth/phone/send-code', { phone, role, channel });
export const verifyPhoneCode = ({ phone, role, code }) => post('/api/auth/phone/verify', { phone, role, code });
export const completePhoneSignUp = ({ signupToken, firstName, lastName, email }) =>
  post('/api/auth/phone/complete-sign-up', { signupToken, firstName, lastName, email });

export const emailSignUp = ({ email, password, firstName, lastName, role }) =>
  post('/api/auth/email/sign-up', { email, password, firstName, lastName, role });
export const verifyEmailCode = ({ email, role, code }) => post('/api/auth/email/verify', { email, role, code });
export const resendEmailCode = ({ email, role }) => post('/api/auth/email/resend-code', { email, role });
export const emailSignIn = ({ email, password, role }) => post('/api/auth/email/sign-in', { email, password, role });

export const forgotPassword = ({ identifier, role, channel }) => post('/api/auth/password/forgot', { identifier, role, channel });
export const resetPassword = ({ identifier, role, channel, code, newPassword }) =>
  post('/api/auth/password/reset', { identifier, role, channel, code, newPassword });

export const changePassword = (token, { currentPassword, newPassword }) =>
  apiFetch('/api/auth/password/change', {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
    suppressAuthErrorHandler: true,
  }, token);

/** Checks a password without creating a new session (used before turning on biometric sign-in). */
export const verifyCurrentPassword = (token, password) =>
  apiFetch('/api/auth/password/verify', {
    method: 'POST',
    body: JSON.stringify({ password }),
    suppressAuthErrorHandler: true,
  }, token);

/** apiFetch replaces 401 messages with "Session expired"; auth endpoints need the server's own message. */
export function getAuthErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error?.status === 0) return 'Could not reach Trust Express. Check your internet and try again.';
  if (error?.code === 'INVALID_CREDENTIALS') return 'Email or password is incorrect.';
  if (error?.code === 'SESSION_INVALID') return 'Your session ended. Please sign in again.';
  return error?.message || fallback;
}
