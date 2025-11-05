// db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_times (
        user_id TEXT PRIMARY KEY,
        total_time BIGINT NOT NULL DEFAULT 0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS daily_user_times (
        user_id TEXT PRIMARY KEY,
        daily_time BIGINT NOT NULL DEFAULT 0
      );
    `);
    console.log('Database tables "user_times" and "daily_user_times" are ready.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDB
};