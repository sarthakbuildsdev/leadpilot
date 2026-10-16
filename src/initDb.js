"use strict";

async function initDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(254) NOT NULL,
      name VARCHAR(80) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT users_email_unique UNIQUE (email)
    )
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email))
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expire ON user_sessions (expire)
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(80) NOT NULL,
      business VARCHAR(100) NOT NULL,
      phone VARCHAR(20),
      email VARCHAR(254),
      source VARCHAR(50),
      status VARCHAR(20) NOT NULL DEFAULT 'New',
      amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
      notes TEXT,
      followup_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const columns = [
    ["name", "VARCHAR(80)"],
    ["business", "VARCHAR(100)"],
    ["phone", "VARCHAR(20)"],
    ["email", "VARCHAR(254)"],
    ["source", "VARCHAR(50)"],
    ["status", "VARCHAR(20)"],
    ["amount", "NUMERIC(12, 2)"],
    ["notes", "TEXT"],
    ["followup_date", "DATE"],
    ["created_at", "TIMESTAMPTZ"],
    ["updated_at", "TIMESTAMPTZ"]
  ];

  for (const [column, type] of columns) {
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${column} ${type}`);
  }

  await pool.query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_source ON leads (source)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads (followup_date)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_created ON leads (created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_leads_user_id ON leads (user_id)`);
}

module.exports = { initDb };
