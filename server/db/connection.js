import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'trust_express',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

let pool = mysql.createPool(DB_CONFIG);

function isTransientDbError(error) {
  if (!error || typeof error !== 'object') return false;
  return [
    'ECONNRESET',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ECONNREFUSED',
    'ETIMEDOUT',
  ].includes(error.code);
}

function resetPool() {
  try {
    pool.end().catch(() => {});
  } catch {
    // ignore
  }
  pool = mysql.createPool(DB_CONFIG);
  pool.on('connection', (connection) => {
    connection.on('error', (error) => {
      console.error('[db/connection] mysql connection error', error);
    });
  });
}

resetPool();

export async function query(sql, params = []) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    if (isTransientDbError(error)) {
      console.warn('[db/connection] transient MySQL error, resetting pool and retrying', error.code);
      resetPool();
      const [rows] = await pool.execute(sql, params);
      return rows;
    }
    throw error;
  }
}

export async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export default pool;
