import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  timezone: 'Z',
});

// Simple Query Helper (returns { rows } to stay consistent across routes)
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return { rows };
}

// Atomic Transaction Helper (for Check-In, Dispatch, & Re-Queue)
export async function withTransaction(callback) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Wrap conn.execute so callback can call client.query(sql, params) identically
    const client = {
      query: async (sql, params = []) => {
        const [rows] = await conn.execute(sql, params);
        return { rows };
      },
    };
    const result = await callback(client);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function getSetting(key, fallbackValue = null) {
  try {
    const { rows } = await query(
      'SELECT setting_value FROM teraye_system_settings WHERE setting_key = ? LIMIT 1',
      [key]
    );
    if (rows.length > 0) return rows[0].setting_value;
  } catch {
    // Fallback to .env
  }
  return process.env[key] ?? fallbackValue;
}