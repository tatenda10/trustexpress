import 'dotenv/config';
import mysql from 'mysql2/promise';

const REQUIRED_TABLES = [
  'captain_reward_settings',
  'captain_reward_tiers',
  'captain_reward_cycles',
  'captain_reward_cycle_drivers',
  'captain_reward_qualifying_rides',
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'trust_express',
  });

  try {
    const [promoColumn] = await connection.query(
      "SHOW COLUMNS FROM driver_wallets LIKE 'promotional_balance'"
    );
    const [tables] = await connection.query('SHOW TABLES LIKE ?', ['captain_reward%']);
    const tableNames = tables.map((row) => Object.values(row)[0]);
    const missingTables = REQUIRED_TABLES.filter((name) => !tableNames.includes(name));

    const [settings] = await connection.query(
      'SELECT id, enabled, cycle_length_days, cycle_weekday, currency FROM captain_reward_settings WHERE id = 1'
    );
    const [tierCount] = await connection.query(
      'SELECT COUNT(*) AS total FROM captain_reward_tiers'
    );
    const [txnType] = await connection.query(
      "SHOW COLUMNS FROM driver_wallet_transactions LIKE 'transaction_type'"
    );
    const enumType = String(txnType[0]?.Type || '');
    const hasCaptainTxnTypes = enumType.includes('captain_promo_credit')
      && enumType.includes('promo_commission_debit');

    const ok = promoColumn.length > 0
      && missingTables.length === 0
      && settings.length > 0
      && Number(tierCount[0]?.total || 0) >= 4
      && hasCaptainTxnTypes;

    console.log(JSON.stringify({
      ok,
      promotionalBalanceColumn: promoColumn[0] || null,
      captainTables: tableNames.sort(),
      missingTables,
      settings: settings[0] || null,
      tierCount: Number(tierCount[0]?.total || 0),
      walletTransactionTypes: enumType,
    }, null, 2));

    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error('Captain rewards verification failed:', error.message);
  process.exit(1);
});
