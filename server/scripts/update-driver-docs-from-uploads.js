import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { getClerkClient } from '../lib/clerk-client.js';

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasArg(name) {
  return process.argv.slice(2).some((value) => value.startsWith(`--${name}=`));
}

function toUploadPath(filename) {
  return `/uploads/${filename}`;
}

async function resolveDriverUserId(email) {
  const clerk = getClerkClient();
  const list = await clerk.users.getUserList({ emailAddress: [email], limit: 10 });
  const user = (list.data || [])[0];
  if (!user) {
    throw new Error(`No Clerk user found for email: ${email}`);
  }
  return user.id;
}

async function run() {
  const email = arg('email', 'tatendamuzenda1@capesso').trim().toLowerCase();
  const userId = arg('user-id', '').trim();
  const uploadsDir = path.resolve(process.cwd(), 'uploads');

  const nationalIdFrontFile = arg('national-id-front', '1772793892403-gmzctyf5.jpg');
  const nationalIdBackFile = arg('national-id-back', '1772793892428-z6qwfqv7.jpg');
  const driverLicenceFile = arg('driver-licence', '1772793892413-ftcesloj.jpg');
  const selfieFile = arg('selfie', '1772793892431-v02lv1b5.jpg');

  const files = [
    nationalIdFrontFile,
    nationalIdBackFile,
    driverLicenceFile,
    selfieFile,
  ];

  for (const file of files) {
    const fullPath = path.join(uploadsDir, file);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Upload file not found: ${fullPath}`);
    }
  }

  const driverUserId = userId || await resolveDriverUserId(email);

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  });

  try {
    await connection.execute(
      `INSERT INTO driver_identity (
         driver_user_id,
         national_id_front_url,
         national_id_back_url,
         driver_licence_url,
         selfie_url,
         profile_status,
         profile_submitted_at
       ) VALUES (?, ?, ?, ?, ?, 'approved', COALESCE(?, CURRENT_TIMESTAMP))
       ON DUPLICATE KEY UPDATE
         national_id_front_url = VALUES(national_id_front_url),
         national_id_back_url = VALUES(national_id_back_url),
         driver_licence_url = VALUES(driver_licence_url),
         selfie_url = VALUES(selfie_url),
         profile_status = 'approved',
         profile_submitted_at = COALESCE(profile_submitted_at, VALUES(profile_submitted_at)),
         updated_at = CURRENT_TIMESTAMP`,
      [
        driverUserId,
        toUploadPath(nationalIdFrontFile),
        toUploadPath(nationalIdBackFile),
        toUploadPath(driverLicenceFile),
        toUploadPath(selfieFile),
        new Date(),
      ]
    );

    const [rows] = await connection.execute(
      `SELECT
         driver_user_id,
         profile_status,
         national_id_front_url,
         national_id_back_url,
         driver_licence_url,
         selfie_url
       FROM driver_identity
       WHERE driver_user_id = ?
       LIMIT 1`,
      [driverUserId]
    );

    console.log(JSON.stringify({
      ok: true,
      email: userId ? null : email,
      driverUserId,
      updatedIdentity: rows[0] || null,
    }, null, 2));
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
