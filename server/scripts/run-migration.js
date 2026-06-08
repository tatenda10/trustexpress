import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function splitSqlStatements(sqlText) {
  return sqlText
    .split(/;\s*(?:\r?\n|$)/g)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

async function run() {
  const migrationRelativePath = process.argv[2] || 'sql/migrations/002_add_admin_auth_tables.sql'
  const migrationPath = path.resolve(__dirname, '..', migrationRelativePath)
  const sqlText = await fs.readFile(migrationPath, 'utf8')
  const statements = splitSqlStatements(sqlText)

  if (statements.length === 0) {
    throw new Error(`No SQL statements found in ${migrationRelativePath}`)
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
    multipleStatements: false,
  })

  try {
    for (const statement of statements) {
      await connection.query(statement)
    }
  } finally {
    await connection.end()
  }

  console.log(`Migration applied successfully: ${migrationRelativePath}`)
  console.log(`Executed ${statements.length} SQL statement(s).`)
}

run().catch((error) => {
  console.error('Migration failed:', error.message)
  process.exit(1)
})
