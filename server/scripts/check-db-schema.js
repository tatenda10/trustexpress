import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import mysql from 'mysql2/promise'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'sql', 'migrations')

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '')
}

function collectExpectations(fileName, sql) {
  const tables = []
  const columns = []
  const clean = stripComments(sql)

  for (const match of clean.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)) {
    tables.push({ table: match[1].toLowerCase(), file: fileName })
  }

  for (const match of clean.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?)(?:;|$)/gi)) {
    const table = match[1].toLowerCase()
    for (const col of match[2].matchAll(/ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s+(?!KEY\b|INDEX\b|UNIQUE\b|CONSTRAINT\b|PRIMARY\b|FOREIGN\b)/gi)) {
      const name = col[1].toLowerCase()
      if (['index', 'key', 'unique', 'constraint', 'primary', 'foreign', 'fulltext', 'spatial'].includes(name)) continue
      columns.push({ table, column: name, file: fileName })
    }
  }

  for (const match of clean.matchAll(/ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN\s+(\w+)/gi)) {
    columns.push({ table: match[1].toLowerCase(), column: match[2].toLowerCase(), file: fileName })
  }

  return { tables, columns }
}

async function run() {
  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const expectedTables = new Map()
  const expectedColumns = new Map()

  for (const file of files) {
    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8')
    const { tables, columns } = collectExpectations(file, sql)
    for (const t of tables) if (!expectedTables.has(t.table)) expectedTables.set(t.table, t.file)
    for (const c of columns) {
      const key = `${c.table}.${c.column}`
      if (!expectedColumns.has(key)) expectedColumns.set(key, c)
    }
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  })

  try {
    const [[dbRow]] = await connection.query('SELECT DATABASE() AS db')
    const [tableRows] = await connection.query(
      'SELECT LOWER(TABLE_NAME) AS t FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()'
    )
    const [columnRows] = await connection.query(
      'SELECT LOWER(TABLE_NAME) AS t, LOWER(COLUMN_NAME) AS c FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()'
    )
    const existingTables = new Set(tableRows.map((r) => r.t))
    const existingColumns = new Set(columnRows.map((r) => `${r.t}.${r.c}`))

    const missingTables = [...expectedTables.entries()].filter(([t]) => !existingTables.has(t))
    const missingColumns = [...expectedColumns.values()].filter(
      (c) => existingTables.has(c.table) && !existingColumns.has(`${c.table}.${c.column}`)
    )

    console.log(`Database: ${dbRow.db} (host ${process.env.DB_HOST || 'localhost'})`)
    console.log(`Tables in DB: ${existingTables.size} | expected from migrations: ${expectedTables.size}`)
    console.log(`\nMissing tables (${missingTables.length}):`)
    for (const [t, file] of missingTables) console.log(`  - ${t}   [${file}]`)
    console.log(`\nMissing columns (${missingColumns.length}):`)
    for (const c of missingColumns) console.log(`  - ${c.table}.${c.column}   [${c.file}]`)

    const latest = [
      'driver_location_keys',
      'auth_sessions',
      'auth_codes',
      'auth_login_attempts',
      'users.password_hash',
      'users.email_verified_at',
      'users.password_updated_at',
      'users.public_metadata',
      'users.private_metadata',
      'users.unsafe_metadata',
      'users.clerk_imported_at',
      'users.last_sign_in_at',
      'driver_availability.location_updated_at',
    ]
    console.log('\nLatest migrations (085-088):')
    for (const item of latest) {
      const ok = item.includes('.') ? existingColumns.has(item) : existingTables.has(item)
      console.log(`  ${ok ? 'OK     ' : 'MISSING'} ${item}`)
    }
  } finally {
    await connection.end()
  }
}

run().catch((error) => {
  console.error('Schema check failed:', error.message)
  process.exit(1)
})
