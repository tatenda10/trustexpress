import nodemailer from 'nodemailer';
import { sendTemplate } from '../whatsapp/cloud-api.js';

const APP_NAME = 'Trust Express';

function configError(message) {
  return Object.assign(new Error(message), { status: 503, code: 'MESSAGING_NOT_CONFIGURED' });
}

let mailTransport = null;

function getMailTransport() {
  if (mailTransport) return mailTransport;
  const user = String(process.env.SMTP_USER || '').trim();
  const pass = String(process.env.SMTP_PASSWORD || '').trim();
  if (!user || !pass) throw configError('SMTP_USER and SMTP_PASSWORD must be configured for email');

  const port = Number(process.env.SMTP_PORT) || 465;
  mailTransport = nodemailer.createTransport({
    // Namecheap Private Email defaults.
    host: String(process.env.SMTP_HOST || 'mail.privateemail.com').trim(),
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return mailTransport;
}

export async function sendEmail({ to, subject, text, html }) {
  const from = String(process.env.EMAIL_FROM || process.env.SMTP_USER || '').trim();
  const info = await getMailTransport().sendMail({
    from: from.includes('<') ? from : `${APP_NAME} <${from}>`,
    to,
    subject,
    text,
    html,
  });
  console.log('[auth.messaging] email sent', { to, messageId: info?.messageId || null });
  return info;
}

/** Econet A2P wants 2637XXXXXXXX; accepts +263…, 263… or 07…. */
function toEconetMsisdn(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('263')) return digits;
  if (digits.startsWith('0')) return `263${digits.slice(1)}`;
  return digits;
}

export async function sendSms({ to, message }) {
  const apiKey = String(process.env.ECONET_SMS_API_KEY || '').trim();
  const senderId = String(process.env.ECONET_SMS_SENDER_ID || '').trim();
  if (!apiKey || !senderId) throw configError('ECONET_SMS_API_KEY and ECONET_SMS_SENDER_ID must be configured for SMS');

  const url = new URL(
    String(process.env.ECONET_SMS_API_URL || 'https://mobilemessaging.econet.co.zw/client/api/sendmessage').trim()
  );
  url.searchParams.set('apikey', apiKey);
  url.searchParams.set('mobiles', toEconetMsisdn(to));
  url.searchParams.set('sms', message);
  url.searchParams.set('senderid', senderId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  let body = '';
  try {
    response = await fetch(url, { method: 'GET', signal: controller.signal });
    body = await response.text().catch(() => '');
  } finally {
    clearTimeout(timeout);
  }

  // Success looks like {"status":{"error-code":"000"},"sms-response-details":[{"success-count":"1",...}]}.
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Non-JSON reply counts as a failure below.
  }
  const successCount = Number(parsed?.['sms-response-details']?.[0]?.['success-count'] || 0);
  const failed = !response.ok || parsed?.status?.['error-code'] !== '000' || successCount < 1;
  console[failed ? 'error' : 'log']('[auth.messaging] econet sms', {
    to: toEconetMsisdn(to),
    httpStatus: response.status,
    response: body.slice(0, 300),
  });
  if (failed) {
    throw Object.assign(new Error('SMS could not be sent. Please try again in a moment.'), { status: 502 });
  }
  return { ok: true, response: body.slice(0, 300) };
}

/** Uses a Meta "authentication" template: body {{1}} = code, plus the copy-code button. */
export async function sendWhatsAppCode({ to, code }) {
  const templateName = String(process.env.WHATSAPP_OTP_TEMPLATE_NAME || '').trim();
  if (!templateName) throw configError('WHATSAPP_OTP_TEMPLATE_NAME must be configured for WhatsApp codes');
  const language = String(process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'en').trim();
  const includeButton = String(process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON || 'true').toLowerCase() !== 'false';

  const components = [{ type: 'body', parameters: [{ type: 'text', text: code }] }];
  if (includeButton) {
    components.push({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] });
  }
  return sendTemplate(String(to || '').replace(/\D/g, ''), templateName, language, components);
}

const PURPOSE_TEXT = {
  sign_in: 'sign in',
  sign_up: 'create your account',
  verify_email: 'verify your email',
  verify_phone: 'verify your phone number',
  reset_password: 'reset your password',
};

export async function deliverCode({ channel, destination, code, purpose, expiresInMinutes }) {
  const action = PURPOSE_TEXT[purpose] || 'continue';
  if (channel === 'email') {
    return sendEmail({
      to: destination,
      subject: `${code} is your ${APP_NAME} code`,
      text: `Use ${code} to ${action} on ${APP_NAME}. It expires in ${expiresInMinutes} minutes.\n\nIf you didn't ask for this, you can ignore this email.`,
      html: `<p>Use this code to ${action} on ${APP_NAME}:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p>
<p>It expires in ${expiresInMinutes} minutes.</p>
<p style="color:#666">If you didn't ask for this, you can ignore this email.</p>`,
    });
  }
  if (channel === 'sms') {
    return sendSms({
      to: destination,
      message: `${code} is your ${APP_NAME} code to ${action}. It expires in ${expiresInMinutes} min. Don't share it with anyone.`,
    });
  }
  if (channel === 'whatsapp') {
    return sendWhatsAppCode({ to: destination, code });
  }
  throw Object.assign(new Error('Unsupported channel'), { status: 400 });
}
