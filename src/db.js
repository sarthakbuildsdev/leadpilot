"use strict";

const { Pool } = require("pg");
const { loadConfig } = require("./config");

const AUTH_ERROR_CODES = new Set([
  "28P01", // invalid password
  "28000" // invalid authorization specification
]);

function createPool(overrides = {}) {
  const { pg } = loadConfig();

  const settings = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 15000
  };

  const connectionString = overrides.connectionString ?? pg.connectionString;
  if (connectionString) {
    return new Pool({ ...settings, connectionString });
  }

  return new Pool({
    ...settings,
    host: overrides.host ?? pg.host,
    port: overrides.port ?? pg.port,
    user: overrides.user ?? pg.user,
    password: overrides.password ?? pg.password,
    database: overrides.database ?? pg.database
  });
}

function isAuthError(error) {
  if (AUTH_ERROR_CODES.has(error?.code)) {
    return true;
  }
  // node-postgres also surfaces SCRAM failures as plain messages, for example:
  // "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string".
  return /password|authentication|SASL|SCRAM/i.test(error?.message || "");
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

  if (["ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH"].includes(error?.code)) {
    return {
      status: 503,
      message:
        "PostgreSQL host could not be reached. Check PGHOST / PGPORT (or DATABASE_URL) in your .env file."
    };
  }

  return {
    status: 500,
    message: "A database error occurred. Please try again."
  };
}

module.exports = { createPool, publicDbError, isAuthError };
