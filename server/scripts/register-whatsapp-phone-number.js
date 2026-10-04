import 'dotenv/config';

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || getArg('graph-version') || 'v20.0';
const phoneNumberId = getArg('phone-number-id') || process.env.WHATSAPP_PHONE_NUMBER_ID;
const accessToken = getArg('access-token') || process.env.WHATSAPP_ACCESS_TOKEN;
const pin = getArg('pin') || process.env.WHATSAPP_REGISTRATION_PIN;

const missing = [
  !phoneNumberId ? 'WHATSAPP_PHONE_NUMBER_ID' : null,
  !accessToken ? 'WHATSAPP_ACCESS_TOKEN' : null,
  !pin ? 'WHATSAPP_REGISTRATION_PIN' : null,
].filter(Boolean);

if (missing.length > 0) {
  console.error([
    'Missing required WhatsApp registration values.',
    `Missing: ${missing.join(', ')}`,
    '',
    'Set these env vars:',
    '  WHATSAPP_PHONE_NUMBER_ID=...',
    '  WHATSAPP_ACCESS_TOKEN=...',
    '  WHATSAPP_REGISTRATION_PIN=123456',
    '',
    'Or pass:',
    '  node scripts/register-whatsapp-phone-number.js --phone-number-id=... --access-token=... --pin=123456',
  ].join('\n'));
  process.exit(1);
}

const url = `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`;

console.log('[whatsapp.register-phone] registering phone number', {
  graphVersion,
  phoneNumberId,
  hasAccessToken: true,
  hasPin: true,
});

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    messaging_product: 'whatsapp',
    pin,
  }),
});

const data = await response.json().catch(() => ({}));

if (!response.ok) {
  console.error('[whatsapp.register-phone] failed', {
    status: response.status,
    providerPayload: JSON.stringify(data, null, 2),
  });
  process.exit(1);
}

console.log('[whatsapp.register-phone] success', data);
