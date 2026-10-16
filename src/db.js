"use strict";

const { Pool } = require("pg");
const { loadConfig } = require("./config");

function createPool(overrides = {}) {
  const { pg } = loadConfig();

  return new Pool({
    host: overrides.host ?? pg.host,
    port: overrides.port ?? pg.port,
    user: overrides.user ?? pg.user,
    password: overrides.password ?? pg.password,
    database: overrides.database ?? pg.database,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000
  });
}

function isAuthError(error) {
  return error?.code === "28P01" || /password|authentication/i.test(error?.message || "");
}

function publicDbError(error) {
  if (isAuthError(error)) {
    return {
      status: 503,
      message:
        "Could not connect to PostgreSQL. Set PGPASSWORD in your .env file (copy from .env.example) and confirm the leadpilot database exists."
    };
  }

  if (error?.code === "3D000") {
    return {
      status: 503,
      message: "The PostgreSQL database 'leadpilot' was not found. Create it, then restart the app."
    };
  }

  if (error?.code === "ECONNREFUSED") {
    return {
      status: 503,
      message:
        "PostgreSQL is not reachable on the configured host/port. Start the PostgreSQL service and try again."
    };
  }

  return {
    status: 500,
    message: "A database error occurred. Please try again."
  };
}

module.exports = { createPool, publicDbError, isAuthError };
