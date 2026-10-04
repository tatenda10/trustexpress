const GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || 'v20.0';
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';

function isConfigured() {
  return !!(ACCESS_TOKEN && PHONE_NUMBER_ID);
}

async function sendWhatsAppPayload(payload) {
  if (!isConfigured()) {
    console.warn('[whatsapp.cloud-api] not configured; outbound payload skipped', {
      hasAccessToken: !!ACCESS_TOKEN,
      hasPhoneNumberId: !!PHONE_NUMBER_ID,
      to: payload?.to || null,
      type: payload?.type || null,
    });
    return { skipped: true };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`;
  console.log('[whatsapp.cloud-api] sending outbound message', {
    graphVersion: GRAPH_VERSION,
    phoneNumberId: PHONE_NUMBER_ID,
    to: payload?.to || null,
    type: payload?.type || null,
  });
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      ...payload,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[whatsapp.cloud-api] outbound send failed', {
      status: response.status,
      to: payload?.to || null,
      type: payload?.type || null,
      providerPayload: data,
    });
    const error = new Error(data?.error?.message || `WhatsApp send failed with status ${response.status}`);
    error.status = response.status;
    error.providerPayload = data;
    throw error;
  }
  console.log('[whatsapp.cloud-api] outbound send accepted', {
    to: payload?.to || null,
    type: payload?.type || null,
    contacts: Array.isArray(data?.contacts) ? data.contacts.map((contact) => ({
      input: contact?.input || null,
      waId: contact?.wa_id || null,
    })) : [],
    messages: Array.isArray(data?.messages) ? data.messages.map((message) => ({
      id: message?.id || null,
      messageStatus: message?.message_status || null,
    })) : [],
  });
  return data;
}

export async function sendText(to, body) {
  return sendWhatsAppPayload({
    to,
    type: 'text',
    text: {
      preview_url: false,
      body: String(body || '').slice(0, 4096),
    },
  });
}

export async function sendButtons(to, body, buttons) {
  return sendWhatsAppPayload({
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: String(body || '').slice(0, 1024) },
      action: {
        buttons: buttons.slice(0, 3).map((button) => ({
          type: 'reply',
          reply: {
            id: button.id,
            title: String(button.title || '').slice(0, 20),
          },
        })),
      },
    },
  });
}

export async function sendList(to, body, buttonText, rows) {
  return sendWhatsAppPayload({
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: String(body || '').slice(0, 1024) },
      action: {
        button: String(buttonText || 'Select').slice(0, 20),
        sections: [
          {
            title: 'Options',
            rows: rows.slice(0, 10).map((row) => ({
              id: row.id,
              title: String(row.title || '').slice(0, 24),
              description: row.description ? String(row.description).slice(0, 72) : undefined,
            })),
          },
        ],
      },
    },
  });
}

export async function sendLocationRequest(to, body) {
  try {
    return await sendWhatsAppPayload({
      to,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text: String(body || '').slice(0, 1024) },
        action: { name: 'send_location' },
      },
    });
  } catch (error) {
    console.warn('[whatsapp.cloud-api] location request failed; falling back to text', {
      to,
      status: error?.status || null,
      message: error?.message || String(error),
    });
    return sendText(to, `${body}\n\nUse WhatsApp attachment/location and send a pinned location.`);
  }
}
