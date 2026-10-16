"use strict";

function requiredEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}

const MIN_SESSION_SECRET_LENGTH = 32;

function loadConfig() {
  const port = Number(requiredEnv("PORT", "3000"));
  const sessionDays = Number(requiredEnv("SESSION_DAYS", "7"));
  const bcryptRounds = Number(requiredEnv("BCRYPT_ROUNDS", "12"));

  return {
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    nodeEnv: requiredEnv("NODE_ENV", "development"),
    sessionSecret: process.env.SESSION_SECRET || "",
    minSessionSecretLength: MIN_SESSION_SECRET_LENGTH,
    sessionMs: Math.max(1, Number.isFinite(sessionDays) ? sessionDays : 7) * 24 * 60 * 60 * 1000,
    cookieSecure:
      String(process.env.COOKIE_SECURE || "").toLowerCase() === "true" ||
      process.env.NODE_ENV === "production",
    bcryptRounds: Number.isInteger(bcryptRounds) && bcryptRounds >= 4 ? bcryptRounds : 12,
    pg: {
      host: requiredEnv("PGHOST", "localhost"),
      port: Number(requiredEnv("PGPORT", "5432")) || 5432,
      user: requiredEnv("PGUSER", "postgres"),
      password: process.env.PGPASSWORD ?? "",
      database: requiredEnv("PGDATABASE", "leadpilot")
    }
  };
}

module.exports = { loadConfig, MIN_SESSION_SECRET_LENGTH };
