"use strict";

require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const secret = process.env.SESSION_SECRET || "";
  console.log(
    JSON.stringify({
      hasSessionSecret: secret.length > 0,
      sessionSecretLength: secret.length,
      hasPgPassword: Boolean(process.env.PGPASSWORD)
    })
  );

  const pool = new Pool({
    host: process.env.PGHOST || "localhost",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "",
    database: process.env.PGDATABASE || "leadpilot",
    connectionTimeoutMillis: 5000
  });

  try {
    const columns = await pool.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'leads'`
    );
    const names = columns.rows.map((row) => row.column_name);
    console.log("LEADS_COLUMNS", names.join(","));

    if (!names.length) {
      console.log("LEADS_COUNT", JSON.stringify({ total: 0, unowned: 0, table: false }));
      return;
    }

    if (names.includes("user_id")) {
      const { rows } = await pool.query(
        "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE user_id IS NULL)::int AS unowned FROM leads"
      );
      console.log("LEADS_COUNT", JSON.stringify({ ...rows[0], table: true, hasUserId: true }));
    } else {
      const { rows } = await pool.query("SELECT COUNT(*)::int AS total FROM leads");
      console.log(
        "LEADS_COUNT",
        JSON.stringify({ total: rows[0].total, unowned: rows[0].total, table: true, hasUserId: false })
      );
    }
  } catch (error) {
    const message = String(error.message || "").replace(/password/gi, "[redacted]");
    console.log("LEADS_COUNT_ERROR", error.code || "", message);
  } finally {
    await pool.end().catch(() => {});
  }
}

main();
