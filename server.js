"use strict";

require("dotenv").config();

const { createApp } = require("./src/app");
const { createPool, isAuthError } = require("./src/db");
const { initDb } = require("./src/initDb");
const { loadConfig } = require("./src/config");
const { createPgSessionStore } = require("./src/session");

async function main() {
  const config = loadConfig();

  if (!config.sessionSecret || config.sessionSecret.length < config.minSessionSecretLength) {
    console.error(
      `SESSION_SECRET is missing or shorter than ${config.minSessionSecretLength} characters. Copy the SESSION_SECRET line from .env.example into .env, generate a unique value locally, and restart. Do not paste secrets into chat.`
    );
    process.exit(1);
  }

  const pool = createPool();

  try {
    await initDb(pool);
    const unowned = await pool.query(
      "SELECT COUNT(*)::int AS count FROM leads WHERE user_id IS NULL"
    );
    const count = unowned.rows[0]?.count || 0;
    if (count > 0) {
      console.warn(
        `Warning: ${count} lead(s) have no owner (user_id IS NULL). They stay in PostgreSQL but will not appear for any signed-in account until you assign ownership. LeadPilot will not auto-assign them.`
      );
    }
  } catch (error) {
    if (isAuthError(error)) {
      console.error(
        "PostgreSQL authentication failed. Copy .env.example to .env, set PGPASSWORD to your postgres user password, and restart. Do not put the password in frontend code or commit it to Git."
      );
    } else if (error.code === "3D000") {
      console.error("The 'leadpilot' database was not found. Create it in PostgreSQL, then restart.");
    } else if (error.code === "ECONNREFUSED") {
      console.error(
        `Could not reach PostgreSQL at ${config.pg.host}:${config.pg.port}. Start the PostgreSQL Windows service and try again.`
      );
    } else {
      console.error("Failed to initialize the database:", error.message);
    }
    await pool.end().catch(() => {});
    process.exit(1);
  }

  const sessionStore = createPgSessionStore(pool);
  const app = createApp({
    pool,
    sessionStore,
    sessionSecret: config.sessionSecret,
    cookieSecure: config.cookieSecure,
    sessionMs: config.sessionMs,
    bcryptRounds: config.bcryptRounds
  });
  const server = app.listen(config.port, () => {
    console.log(`LeadPilot running at http://localhost:${config.port}`);
    console.log("Mode: session accounts. Each signed-in user only sees their own leads.");
  });

  const shutdown = async () => {
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
