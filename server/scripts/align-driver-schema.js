import 'dotenv/config'
import mysql from 'mysql2/promise'

async function columnExists(connection, table, column) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
     LIMIT 1`,
    [table, column]
  )
  return rows.length > 0
}

async function tableExists(connection, table) {
  const [rows] = await connection.execute(
    `SELECT 1
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
     LIMIT 1`,
    [table]
  )
  return rows.length > 0
}

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  })

  try {
    const actions = []

    // users additions
    if (!(await columnExists(connection, 'users', 'phone_number'))) {
      await connection.execute('ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) DEFAULT NULL')
      actions.push('users.phone_number added')
    }
    if (!(await columnExists(connection, 'users', 'phone_verified_at'))) {
      await connection.execute('ALTER TABLE users ADD COLUMN phone_verified_at TIMESTAMP NULL DEFAULT NULL')
      actions.push('users.phone_verified_at added')
    }

    // driver_profiles additions
    if (!(await columnExists(connection, 'driver_profiles', 'national_id_front_url'))) {
      await connection.execute('ALTER TABLE driver_profiles ADD COLUMN national_id_front_url VARCHAR(512) DEFAULT NULL')
      actions.push('driver_profiles.national_id_front_url added')
    }
    if (!(await columnExists(connection, 'driver_profiles', 'national_id_back_url'))) {
      await connection.execute('ALTER TABLE driver_profiles ADD COLUMN national_id_back_url VARCHAR(512) DEFAULT NULL')
      actions.push('driver_profiles.national_id_back_url added')
    }
    if (!(await columnExists(connection, 'driver_profiles', 'driver_licence_url'))) {
      await connection.execute('ALTER TABLE driver_profiles ADD COLUMN driver_licence_url VARCHAR(512) DEFAULT NULL')
      actions.push('driver_profiles.driver_licence_url added')
    }
    if (!(await columnExists(connection, 'driver_profiles', 'rejection_reason'))) {
      await connection.execute('ALTER TABLE driver_profiles ADD COLUMN rejection_reason VARCHAR(500) DEFAULT NULL')
      actions.push('driver_profiles.rejection_reason added')
    }
    if (!(await columnExists(connection, 'driver_profiles', 'submitted_at'))) {
      await connection.execute('ALTER TABLE driver_profiles ADD COLUMN submitted_at TIMESTAMP NULL DEFAULT NULL')
      actions.push('driver_profiles.submitted_at added')
    }

    // vehicles table
    if (!(await tableExists(connection, 'vehicles'))) {
      await connection.execute(
        `CREATE TABLE vehicles (
          id INT AUTO_INCREMENT PRIMARY KEY,
          user_id INT NOT NULL,
          car_photo_front_url VARCHAR(512) DEFAULT NULL,
          car_photo_rear_url VARCHAR(512) DEFAULT NULL,
          number_plate VARCHAR(32) NOT NULL,
          make VARCHAR(64) NOT NULL,
          model VARCHAR(64) NOT NULL,
          year SMALLINT UNSIGNED NOT NULL,
          color VARCHAR(32) DEFAULT NULL,
          vehicle_registration_url VARCHAR(512) NOT NULL,
          insurance_url VARCHAR(512) NOT NULL,
          status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
          rejection_reason VARCHAR(500) DEFAULT NULL,
          submitted_at TIMESTAMP NULL DEFAULT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY one_vehicle_per_user (user_id),
          INDEX idx_vehicle_status (status),
          CONSTRAINT fk_vehicles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`
      )
      actions.push('vehicles table created')
    }

    if (actions.length === 0) {
      console.log('No schema changes needed. DB already aligned.')
    } else {
      console.log('Applied schema changes:')
      for (const action of actions) console.log(`- ${action}`)
    }
  } finally {
    await connection.end()
  }
}

run().catch((error) => {
  console.error('Schema alignment failed:', error.message)
  process.exit(1)
})