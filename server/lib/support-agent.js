import { query } from '../db/connection.js';
import {
  DEFAULT_SUPPORT_AGENT_SYSTEM_PROMPT,
  buildDefaultSupportAgentTrainingContent,
} from './support-agent-training.js';

const DEFAULT_PROVIDER = 'claude';
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

function coerceBoolean(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function normalizeText(value, fallback = '') {
  const nextValue = String(value ?? '').trim();
  return nextValue || fallback;
}

function parseAnthropicTextContent(payload) {
  const blocks = Array.isArray(payload?.content) ? payload.content : [];
  return blocks
    .filter((block) => block?.type === 'text')
    .map((block) => String(block?.text || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

export function shapeSupportAgentSettings(row) {
  const trainingContent = normalizeText(row?.training_content, buildDefaultSupportAgentTrainingContent());
  return {
    enabled: coerceBoolean(row?.enabled),
    provider: normalizeText(row?.provider, DEFAULT_PROVIDER),
    model: normalizeText(row?.model, DEFAULT_MODEL),
    systemPrompt: normalizeText(row?.system_prompt, DEFAULT_SUPPORT_AGENT_SYSTEM_PROMPT),
    trainingContent,
    updatedByAdminId: row?.updated_by_admin_id || null,
    lastTestedAt: row?.last_tested_at ? new Date(row.last_tested_at).toISOString() : null,
    createdAt: row?.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
    hasApiKey: !!String(process.env.ANTHROPIC_API_KEY || '').trim(),
  };
}

async function ensureSupportAgentSettingsRow() {
  await query(
    `INSERT INTO support_agent_settings (
      id,
      enabled,
      provider,
      model,
      system_prompt,
      training_content
    )
    SELECT 1, 0, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM support_agent_settings WHERE id = 1
    )`,
    [
      DEFAULT_PROVIDER,
      DEFAULT_MODEL,
      DEFAULT_SUPPORT_AGENT_SYSTEM_PROMPT,
      buildDefaultSupportAgentTrainingContent(),
    ],
  );
}

export async function getSupportAgentSettings() {
  await ensureSupportAgentSettingsRow();
  const [row] = await query(
    `SELECT *
     FROM support_agent_settings
     WHERE id = 1
     LIMIT 1`,
  );
  return shapeSupportAgentSettings(row || null);
}

export async function updateSupportAgentSettings({
  enabled,
  provider,
  model,
  systemPrompt,
  trainingContent,
  adminUserId = null,
}) {
  await ensureSupportAgentSettingsRow();
  const nextEnabled = enabled === undefined ? undefined : (coerceBoolean(enabled) ? 1 : 0);
  const current = await getSupportAgentSettings();

  await query(
    `UPDATE support_agent_settings
     SET enabled = ?,
         provider = ?,
         model = ?,
         system_prompt = ?,
         training_content = ?,
         updated_by_admin_id = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [
      nextEnabled ?? (current.enabled ? 1 : 0),
      normalizeText(provider, current.provider),
      normalizeText(model, current.model),
      normalizeText(systemPrompt, current.systemPrompt),
      normalizeText(trainingContent, current.trainingContent),
      adminUserId,
    ],
  );

  return getSupportAgentSettings();
}

async function callClaude({ systemPrompt, model, userPrompt, maxTokens = 400 }) {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || `Claude request failed with status ${response.status}`);
  }

  const text = parseAnthropicTextContent(payload);
  if (!text) {
    throw new Error('Claude returned an empty reply');
  }
  return text;
}

function buildConversationContext(messages = []) {
  return messages
    .slice(-10)
    .map((message) => {
      const sender =
        message?.sender_type === 'admin'
          ? (message?.is_ai_reply ? 'Support assistant' : 'Support admin')
          : message?.sender_type === 'driver'
            ? 'Driver'
            : 'Passenger';
      return `${sender}: ${String(message?.message || '').trim()}`;
    })
    .filter(Boolean)
    .join('\n');
}

export async function generateSupportAgentReply({
  thread,
  messages = [],
  incomingMessage,
  testMessage = '',
}) {
  const settings = await getSupportAgentSettings();
  if (!settings.hasApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured on the server');
  }

  const normalizedIncomingMessage = normalizeText(incomingMessage || testMessage);
  if (!normalizedIncomingMessage) {
    throw new Error('A support question is required');
  }

  const conversationContext = buildConversationContext(messages);
  const userRole = thread?.userRole || thread?.user_role || 'passenger';
  const threadId = thread?.id || 'test';
  const userId = thread?.userId || thread?.user_id || 'test-user';

  const userPrompt = [
    'Trust Express support knowledge base:',
    settings.trainingContent,
    '',
    'Conversation details:',
    `- Thread ID: ${threadId}`,
    `- User role: ${userRole}`,
    `- User ID: ${userId}`,
    '',
    conversationContext ? `Recent conversation:\n${conversationContext}` : 'Recent conversation:\nNo previous messages.',
    '',
    `Latest user message:\n${normalizedIncomingMessage}`,
    '',
    'Write the best support reply. Use the knowledge base only. If the answer needs a human follow-up, say so clearly and ask for the trip details needed.',
  ].join('\n');

  const text = await callClaude({
    systemPrompt: settings.systemPrompt,
    model: settings.model,
    userPrompt,
  });

  return {
    provider: settings.provider,
    model: settings.model,
    message: text,
  };
}

export async function markSupportAgentTested() {
  await ensureSupportAgentSettingsRow();
  await query(
    `UPDATE support_agent_settings
     SET last_tested_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
  );
}
