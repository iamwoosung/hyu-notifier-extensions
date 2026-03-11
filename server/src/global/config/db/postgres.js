const { Pool } = require('pg');
const logger = require('../../modules/logger');

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || process.env.POSTGRES_DB,
  user:     process.env.DB_USER     || process.env.POSTGRES_USER,
  password: process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD,
});

const init = async () => {
  try {
    const client = await pool.connect();
    client.release();
    logger.info('PostgreSQL Connection : success');
    return true;
  } catch (error) {
    logger.error(`PostgreSQL Connection : error ${error.message}`);
    return false;
  }
};

async function query(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result.rows;
  } catch (err) {
    logger.error(err);
    return [];
  }
}

module.exports = { query, init };
