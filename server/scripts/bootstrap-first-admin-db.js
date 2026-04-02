import 'dotenv/config'
import mysql from 'mysql2/promise'
import { hashPassword } from '../lib/admin-password.js'

async function run() {
  const fullName = process.env.ADMIN_BOOTSTRAP_NAME
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD

  if (!fullName || !email || !password) {
    throw new Error('Missing ADMIN_BOOTSTRAP_NAME, ADMIN_BOOTSTRAP_EMAIL, or ADMIN_BOOTSTRAP_PASSWORD in .env')
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  })

  try {
    const [existing] = await connection.execute('SELECT id FROM admin_users WHERE email = ? LIMIT 1', [String(email).toLowerCase()])
    if (existing.length > 0) {
      throw new Error('An admin with this email already exists')
    }

    const passwordHash = hashPassword(password)
    const [result] = await connection.execute(
      `INSERT INTO admin_users (full_name, email, password_hash, role)
       VALUES (?, ?, ?, 'super_admin')`,
      [fullName, String(email).toLowerCase(), passwordHash]
    )

    console.log('Admin bootstrap (DB) succeeded.')
    console.log(`Admin ID: ${result.insertId}`)
    console.log(`Email: ${String(email).toLowerCase()}`)
    console.log('Role: super_admin')
  } finally {
    await connection.end()
  }
}

run().catch((error) => {
  console.error(error.message)
  process.exit(1)
})