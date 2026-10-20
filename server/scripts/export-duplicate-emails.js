import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { query } from '../db/connection.js'
import pool from '../db/connection.js'
import { buildXlsxBuffer } from '../lib/xlsx-export.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.resolve(__dirname, '..', 'exports')

function formatDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 19).replace('T', ' ')
}

async function main() {
  const rows = await query(
    `SELECT u.clerk_user_id, LOWER(TRIM(u.email)) AS email_key, u.email, u.role,
            u.first_name, u.last_name, u.phone_number, u.phone_verified_at, u.email_verified_at,
            (u.password_hash IS NOT NULL) AS has_password, u.created_at, u.updated_at,
            (SELECT COUNT(*) FROM ride_requests r
              WHERE r.passenger_user_id = u.clerk_user_id AND r.status = 'completed') AS passenger_rides,
            (SELECT COUNT(*) FROM ride_requests r
              WHERE r.driver_user_id = u.clerk_user_id AND r.status = 'completed') AS driver_rides
     FROM users u
     JOIN (
       SELECT LOWER(TRIM(email)) AS email_key
       FROM users
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY LOWER(TRIM(email))
       HAVING COUNT(*) > 1
     ) d ON d.email_key = LOWER(TRIM(u.email))
     ORDER BY email_key, u.role, u.created_at`
  )

  const groups = new Map()
  for (const row of rows) {
    if (!groups.has(row.email_key)) groups.set(row.email_key, [])
    groups.get(row.email_key).push(row)
  }

  const sheetRows = []
  let groupNumber = 0
  let sameRoleGroups = 0
  for (const [, members] of groups) {
    groupNumber += 1
    const roleCounts = members.reduce((acc, m) => ({ ...acc, [m.role]: (acc[m.role] || 0) + 1 }), {})
    const sameRole = Object.values(roleCounts).some((count) => count > 1)
    if (sameRole) sameRoleGroups += 1
    const duplicateType = sameRole ? 'Same role (real duplicate)' : 'Driver + passenger (allowed)'

    for (const m of members) {
      sheetRows.push({
        group: groupNumber,
        email: m.email,
        duplicateType,
        accountsWithEmail: members.length,
        role: m.role,
        userId: m.clerk_user_id,
        firstName: m.first_name || '',
        lastName: m.last_name || '',
        phone: m.phone_number || '',
        phoneVerified: m.phone_verified_at ? 'Yes' : 'No',
        emailVerified: m.email_verified_at ? 'Yes' : 'No',
        hasPassword: Number(m.has_password) ? 'Yes' : 'No',
        rides: m.role === 'driver' ? Number(m.driver_rides) : Number(m.passenger_rides),
        createdAt: formatDate(m.created_at),
        updatedAt: formatDate(m.updated_at),
      })
    }
  }

  const columns = [
    { key: 'group', header: 'Group #', width: 9 },
    { key: 'email', header: 'Email', width: 34 },
    { key: 'duplicateType', header: 'Duplicate type', width: 28 },
    { key: 'accountsWithEmail', header: 'Accounts with this email', width: 12 },
    { key: 'role', header: 'Role', width: 11 },
    { key: 'userId', header: 'User ID', width: 36, text: true },
    { key: 'firstName', header: 'First name', width: 18 },
    { key: 'lastName', header: 'Last name', width: 18 },
    { key: 'phone', header: 'Phone', width: 16, text: true },
    { key: 'phoneVerified', header: 'Phone verified', width: 10 },
    { key: 'emailVerified', header: 'Email verified', width: 10 },
    { key: 'hasPassword', header: 'Has password', width: 10 },
    { key: 'rides', header: 'Completed rides', width: 10 },
    { key: 'createdAt', header: 'Created', width: 20 },
    { key: 'updatedAt', header: 'Last updated', width: 20 },
  ]

  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const fileName = `duplicate-emails-${new Date().toISOString().slice(0, 10)}.xlsx`
  const filePath = path.join(OUTPUT_DIR, fileName)
  await fs.writeFile(filePath, buildXlsxBuffer({ sheetName: 'Duplicate emails', columns, rows: sheetRows }))

  console.log(`Emails used by more than one account: ${groups.size}`)
  console.log(`  same role (real duplicates): ${sameRoleGroups}`)
  console.log(`  driver + passenger only:     ${groups.size - sameRoleGroups}`)
  console.log(`Accounts listed: ${sheetRows.length}`)
  console.log(`Saved: ${filePath}`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
