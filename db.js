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
    console.log('Database table "user_times" is ready.');
  } catch (err) {
    console.error('Error initializing database table:', err);
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDB
};