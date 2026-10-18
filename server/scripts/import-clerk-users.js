/**
 * One-time copy of every Clerk user into MySQL.
 *
 *   npm run users:import-clerk
 *   npm run users:import-clerk -- --passwords=./clerk-export.csv
 *
 * --passwords: the CSV from Clerk dashboard > Users > Export. Rows with a bcrypt
 * password_digest get it copied into users.password_hash so people keep their password.
 * Safe to run more than once.
 */
import 'dotenv/config';
import fs from 'fs';
import { query } from '../db/connection.js';
import { getLegacyClerkClient, importClerkUser } from '../lib/clerk-import.js';

const PAGE_SIZE = 500;

function getArg(name) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length).trim() : '';
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);
  const [header = [], ...data] = rows;
  return data.map((values) => Object.fromEntries(header.map((key, index) => [key.trim(), values[index] ?? ''])));
}

async function importUsers(client) {
  let offset = 0;
  let imported = 0;
  let failed = 0;
  for (;;) {
    const page = await client.users.getUserList({ limit: PAGE_SIZE, offset, orderBy: 'created_at' });
    const users = Array.isArray(page) ? page : page?.data || [];
    if (!users.length) break;
    for (const user of users) {
      try {
        await importClerkUser(user);
        imported += 1;
      } catch (error) {
        failed += 1;
        console.error(`[import] ${user.id} failed:`, error?.message || error);
      }
    }
    offset += users.length;
    console.log(`[import] ${imported} imported so far`);
    if (users.length < PAGE_SIZE) break;
  }
  return { imported, failed };
}

async function importPasswords(csvPath) {
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const id = row.id;
    const digest = row.password_digest;
    const hasher = String(row.password_hasher || 'bcrypt').toLowerCase();
    if (!id || !digest || hasher !== 'bcrypt' || !/^\$2[aby]\$/.test(digest)) {
      skipped += 1;
      continue;
    }
    const result = await query(
      `UPDATE users SET password_hash = ?, password_updated_at = COALESCE(password_updated_at, CURRENT_TIMESTAMP)
       WHERE clerk_user_id = ? AND password_hash IS NULL`,
      [digest, id]
    );
    if (result?.affectedRows) updated += 1;
  }
  return { updated, skipped };
}

async function main() {
  const client = getLegacyClerkClient();
  if (!client) throw new Error('CLERK_SECRET_KEY is not set');

  const { imported, failed } = await importUsers(client);
  console.log(`[import] done: ${imported} users imported, ${failed} failed`);

  const csvPath = getArg('passwords');
  if (csvPath) {
    const { updated, skipped } = await importPasswords(csvPath);
    console.log(`[import] passwords: ${updated} copied, ${skipped} rows without a bcrypt password`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error('[import] failed:', error);
  process.exit(1);
});
