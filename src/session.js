"use strict";

const session = require("express-session");
const ConnectPgSimple = require("connect-pg-simple");

function createPgSessionStore(pool) {
  const PgStore = ConnectPgSimple(session);
  return new PgStore({
    pool,
    tableName: "user_sessions",
    createTableIfMissing: false,
    pruneSessionInterval: 60 * 15
  });
}

function sessionMiddleware({ store, secret, cookieSecure, maxAge }) {
  return session({
    name: "leadpilot.sid",
    store,
    secret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: Boolean(cookieSecure),
      maxAge
    }
  });
}

module.exports = { createPgSessionStore, sessionMiddleware };
