import crypto from 'node:crypto';

const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const MAX_CHALLENGES = 2000;
const challenges = new Map();

function pruneExpired(now = Date.now()) {
  for (const [token, entry] of challenges) {
    if (entry.expiresAt <= now) challenges.delete(token);
  }
  while (challenges.size > MAX_CHALLENGES) {
    challenges.delete(challenges.keys().next().value);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function decodeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function readAttribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  if (!match) return '';
  return decodeHtmlAttribute(match[2] ?? match[3] ?? '');
}

// The gateway's HTML posts the bank challenge into an iframe. Inside an iframe the final
// redirect to the app's custom scheme is not picked up by the in-app browser, so the
// challenge form is re-posted as a top-level navigation instead.
function extractChallengeForm(redirectHtml) {
  const formTag = /<form\b[^>]*>/i.exec(redirectHtml)?.[0];
  if (!formTag) return null;
  const action = readAttribute(formTag, 'action');
  if (!/^https:\/\//i.test(action)) return null;
  const method = (readAttribute(formTag, 'method') || 'POST').toUpperCase() === 'GET' ? 'GET' : 'POST';
  const formBody = /<form\b[^>]*>([\s\S]*?)<\/form>/i.exec(redirectHtml)?.[1] || '';
  const fields = [];
  for (const inputTag of formBody.match(/<input\b[^>]*>/gi) || []) {
    const name = readAttribute(inputTag, 'name');
    if (name) fields.push({ name, value: readAttribute(inputTag, 'value') });
  }
  if (!fields.length) return null;
  return { action, method, fields };
}

function renderPage(body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Confirm card payment</title>
<style>
  html, body { margin: 0; height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f6f7f3; color: #111827; }
  .wrap { min-height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box; text-align: center; }
  .spinner { width: 36px; height: 36px; border: 4px solid #d1d5db; border-top-color: #16a34a; border-radius: 50%; animation: spin 0.9s linear infinite; margin-bottom: 18px; }
  @keyframes spin { to { transform: rotate(360deg); } }
  p { margin: 6px 0; font-size: 15px; color: #4b5563; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  button { margin-top: 18px; padding: 12px 22px; border: 0; border-radius: 999px; background: #16a34a; color: #fff; font-size: 15px; font-weight: 600; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

export function createThreeDsChallenge(redirectHtml, { baseUrl, reference = null } = {}) {
  const html = String(redirectHtml || '').trim();
  const base = String(baseUrl || '').trim().replace(/\/$/, '');
  if (!html || !base) return null;
  pruneExpired();
  const token = crypto.randomBytes(24).toString('base64url');
  challenges.set(token, {
    redirectHtml: html,
    form: extractChallengeForm(html),
    reference,
    expiresAt: Date.now() + CHALLENGE_TTL_MS,
  });
  return `${base}/api/payments/3ds/${token}`;
}

export function renderThreeDsChallengePage(token) {
  const key = String(token || '').trim();
  const entry = key ? challenges.get(key) : null;
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) challenges.delete(key);
    return {
      status: 410,
      html: renderPage(`<div class="wrap">
  <h1>This payment link has expired</h1>
  <p>Close this page and start the card payment again.</p>
</div>`),
    };
  }

  if (!entry.form) {
    return {
      status: 200,
      html: renderPage(`<div style="height:100vh">${entry.redirectHtml}</div>`),
    };
  }

  const { action, method, fields } = entry.form;
  const inputs = fields
    .map((field) => `<input type="hidden" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value)}" />`)
    .join('\n    ');
  return {
    status: 200,
    html: renderPage(`<div class="wrap">
  <div class="spinner"></div>
  <h1>Connecting to your bank</h1>
  <p>Your bank will ask you to confirm this card payment.</p>
  <form id="challengeForm" method="${method}" action="${escapeHtml(action)}">
    ${inputs}
    <noscript><button type="submit">Continue to your bank</button></noscript>
  </form>
</div>
<script>document.getElementById('challengeForm').submit();</script>`),
  };
}
