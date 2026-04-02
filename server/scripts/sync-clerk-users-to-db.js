import 'dotenv/config';
import mysql from 'mysql2/promise';
import { getClerkClient } from '../lib/clerk-client.js';
import { toAppUser } from '../lib/clerk-user.js';

const USER_ID_MAX_LEN = 255;

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function ensureUsersTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      clerk_user_id VARCHAR(${USER_ID_MAX_LEN}) NOT NULL UNIQUE,
      email VARCHAR(255) DEFAULT NULL,
      first_name VARCHAR(120) DEFAULT NULL,
      last_name VARCHAR(120) DEFAULT NULL,
      image_url VARCHAR(512) DEFAULT NULL,
      role ENUM('passenger', 'driver') NOT NULL DEFAULT 'passenger',
      phone_number VARCHAR(20) DEFAULT NULL,
      phone_verified_at TIMESTAMP NULL DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_clerk_user_id (clerk_user_id),
      INDEX idx_role (role)
    )
  `);

  const additiveColumns = [
    ['email', 'ALTER TABLE users ADD COLUMN email VARCHAR(255) DEFAULT NULL AFTER clerk_user_id'],
    ['first_name', 'ALTER TABLE users ADD COLUMN first_name VARCHAR(120) DEFAULT NULL AFTER email'],
    ['last_name', 'ALTER TABLE users ADD COLUMN last_name VARCHAR(120) DEFAULT NULL AFTER first_name'],
    ['image_url', 'ALTER TABLE users ADD COLUMN image_url VARCHAR(512) DEFAULT NULL AFTER last_name'],
    ['phone_number', 'ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) DEFAULT NULL AFTER role'],
    ['phone_verified_at', 'ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMP NULL DEFAULT NULL AFTER phone_number'],
  ];

  for (const [column, sql] of additiveColumns) {
    if (!(await columnExists(connection, 'users', column))) {
      await connection.execute(sql);
    }
  }
}

async function upsertUser(connection, appUser) {
  await connection.execute(
    `INSERT INTO users (
      clerk_user_id,
      email,
      first_name,
      last_name,
      image_url,
      role,
      phone_number,
      phone_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      email = VALUES(email),
      first_name = VALUES(first_name),
      last_name = VALUES(last_name),
      image_url = VALUES(image_url),
      role = VALUES(role),
      phone_number = VALUES(phone_number),
      phone_verified_at = VALUES(phone_verified_at),
      updated_at = CURRENT_TIMESTAMP`,
    [
      appUser.clerk_user_id,
      appUser.email,
      appUser.first_name,
      appUser.last_name,
      appUser.image_url,
      appUser.role,
      appUser.phone_number,
      appUser.phone_verified_at ? new Date(appUser.phone_verified_at) : null,
    ]
  );
}

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  });

  try {
    await ensureUsersTable(connection);

    const clerk = getClerkClient();
    let offset = 0;
    const limit = 100;
    let synced = 0;
    let passengers = 0;
    let drivers = 0;

    do {
      const page = await clerk.users.getUserList({ limit, offset, orderBy: '-created_at' });
      const users = page.data || [];
      if (users.length === 0) break;

      for (const user of users) {
        const appUser = toAppUser(user);
        await upsertUser(connection, appUser);
        synced += 1;
        if (appUser.role === 'driver') drivers += 1;
        else passengers += 1;
      }

      offset += users.length;
      if (users.length < limit) break;
    } while (true);

    console.log(`Clerk sync complete. Synced ${synced} user(s): ${drivers} driver(s), ${passengers} passenger(s).`);
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Failed to sync Clerk users to DB:', error);
  process.exit(1);
});
