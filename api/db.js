// ================================
// DATABASE CONNECTION
// Vercel Postgres (Neon)
// ================================

const { neon } = require('@neondatabase/serverless');

// Vercel automatically injects POSTGRES_URL
// No need to manually configure
const sql = neon(process.env.POSTGRES_URL);

module.exports = sql;