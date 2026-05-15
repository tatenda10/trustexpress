import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import pool, { query } from '../db/connection.js';
import { getClerkClient } from '../lib/clerk-client.js';
import { toAppUser } from '../lib/clerk-user.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.resolve(__dirname, '..');
const EXPORTS_DIR = path.join(SERVER_ROOT, 'exports');

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('') + '_' + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeText(value) {
  const text = String(value ?? '').trim();
  return text || '';
}

function buildRow(record) {
  const firstName = normalizeText(record.first_name);
  const lastName = normalizeText(record.last_name);
  const fullName = normalizeText(record.full_name) || [firstName, lastName].filter(Boolean).join(' ').trim();

  return {
    role: record.role === 'driver' ? 'Driver' : 'Passenger',
    fullName: fullName || normalizeText(record.email) || normalizeText(record.clerk_user_id),
    firstName,
    lastName,
    phoneNumber: normalizeText(record.phone_number),
    email: normalizeText(record.email),
    userId: normalizeText(record.clerk_user_id),
    createdAt: record.created_at ? new Date(record.created_at).toISOString() : '',
  };
}

async function loadRowsFromDatabase() {
  return query(
    `SELECT
       clerk_user_id,
       role,
       first_name,
       last_name,
       email,
       phone_number,
       created_at,
       TRIM(CONCAT_WS(' ', COALESCE(first_name, ''), COALESCE(last_name, ''))) AS full_name
     FROM users
     WHERE role IN ('driver', 'passenger')
     ORDER BY
       CASE WHEN role = 'driver' THEN 0 ELSE 1 END,
       first_name ASC,
       last_name ASC,
       email ASC`
  );
}

async function loadRowsFromClerk() {
  const clerk = getClerkClient();
  const rawRows = [];
  let offset = 0;
  const limit = 100;

  do {
    const page = await clerk.users.getUserList({ limit, offset, orderBy: '-created_at' });
    const users = page.data || [];
    if (users.length === 0) break;

    for (const user of users) {
      const appUser = toAppUser(user);
      if (!['driver', 'passenger'].includes(appUser.role)) continue;

      rawRows.push({
        clerk_user_id: appUser.clerk_user_id,
        role: appUser.role,
        first_name: appUser.first_name,
        last_name: appUser.last_name,
        email: appUser.email,
        phone_number: appUser.phone_number,
        created_at: appUser.created_at,
        full_name: [appUser.first_name, appUser.last_name].filter(Boolean).join(' ').trim(),
      });
    }

    offset += users.length;
    if (users.length < limit) break;
  } while (true);

  rawRows.sort((left, right) => {
    const leftRole = left.role === 'driver' ? 0 : 1;
    const rightRole = right.role === 'driver' ? 0 : 1;
    if (leftRole !== rightRole) return leftRole - rightRole;

    const leftName = `${left.first_name || ''} ${left.last_name || ''} ${left.email || ''}`.toLowerCase();
    const rightName = `${right.first_name || ''} ${right.last_name || ''} ${right.email || ''}`.toLowerCase();
    return leftName.localeCompare(rightName);
  });

  return rawRows;
}

function renderCell(value) {
  return `<Cell ss:StyleID="text"><Data ss:Type="String">${xmlEscape(value)}</Data></Cell>`;
}

function renderWorksheet(name, rows) {
  const headers = ['Role', 'Full Name', 'First Name', 'Last Name', 'Phone Number', 'Email', 'User ID', 'Created At'];
  const headerRow = `<Row>${headers.map((header) => `<Cell ss:StyleID="header"><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`).join('')}</Row>`;
  const bodyRows = rows.map((row) => {
    return `<Row>${[
      row.role,
      row.fullName,
      row.firstName,
      row.lastName,
      row.phoneNumber,
      row.email,
      row.userId,
      row.createdAt,
    ].map(renderCell).join('')}</Row>`;
  }).join('');

  return `
    <Worksheet ss:Name="${xmlEscape(name)}">
      <Table>
        <Column ss:Width="90"/>
        <Column ss:Width="180"/>
        <Column ss:Width="120"/>
        <Column ss:Width="120"/>
        <Column ss:Width="120"/>
        <Column ss:Width="200"/>
        <Column ss:Width="180"/>
        <Column ss:Width="150"/>
        ${headerRow}
        ${bodyRows}
      </Table>
    </Worksheet>`;
}

function buildWorkbook(rows) {
  const drivers = rows.filter((row) => row.role === 'Driver');
  const passengers = rows.filter((row) => row.role === 'Passenger');

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook
  xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:html="http://www.w3.org/TR/REC-html40">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/>
    </Style>
    <Style ss:ID="text">
      <NumberFormat ss:Format="@"/>
    </Style>
  </Styles>
  ${renderWorksheet('All Contacts', rows)}
  ${renderWorksheet('Drivers', drivers)}
  ${renderWorksheet('Passengers', passengers)}
</Workbook>`;
}

async function run() {
  try {
    let rows = await loadRowsFromDatabase();
    let source = 'database';
    if (rows.length === 0) {
      rows = await loadRowsFromClerk();
      source = 'clerk';
    }

    const normalizedRows = rows.map(buildRow);
    const workbook = buildWorkbook(normalizedRows);

    await fs.mkdir(EXPORTS_DIR, { recursive: true });

    const requestedPath = process.argv[2];
    const outputPath = requestedPath
      ? path.resolve(process.cwd(), requestedPath)
      : path.join(EXPORTS_DIR, `user_contacts_${formatTimestamp()}.xls`);

    await fs.writeFile(outputPath, workbook, 'utf8');

    const driverCount = normalizedRows.filter((row) => row.role === 'Driver').length;
    const passengerCount = normalizedRows.filter((row) => row.role === 'Passenger').length;

    console.log(`Excel export created: ${outputPath}`);
    console.log(`Source: ${source}`);
    console.log(`Drivers: ${driverCount}`);
    console.log(`Passengers: ${passengerCount}`);
    console.log(`Total contacts: ${normalizedRows.length}`);
  } finally {
    await pool.end().catch(() => {});
  }
}

run().catch((error) => {
  console.error('Failed to export user contacts to Excel:', error);
  process.exit(1);
});
