"use strict";

const express = require("express");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { createRoutes } = require("./routes");
const { createAuthRoutes } = require("./authRoutes");
const { csrfProtect } = require("./csrf");
const { sessionMiddleware } = require("./session");

function requirePageAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.redirect("/login");
  }
  return next();
}

function redirectIfAuthed(req, res, next) {
  if (req.session?.userId) {
    return res.redirect("/");
  }
  return next();
}

function createApp({
  pool,
  sessionStore,
  sessionSecret,
  cookieSecure = false,
  sessionMs = 7 * 24 * 60 * 60 * 1000,
  bcryptRounds = 12,
  disableRateLimit = false
}) {
  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required");
  }
  if (!sessionStore) {
    throw new Error("A PostgreSQL session store is required");
  }

  const app = express();
  const publicDir = path.join(__dirname, "..", "public");

  app.disable("x-powered-by");
  app.set("trust proxy", cookieSecure ? 1 : false);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'"],
          imgSrc: ["'self'", "data:"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"]
        }
      }
    })
  );
  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: true, limit: "100kb" }));
  app.use(
    sessionMiddleware({
      store: sessionStore,
      secret: sessionSecret,
      cookieSecure,
      maxAge: sessionMs
    })
  );
  app.use("/api", csrfProtect);

  const authLimiter = disableRateLimit
    ? (_req, _res, next) => next()
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, error: "Too many attempts. Try again in a few minutes." }
      });

  app.use("/api/auth", createAuthRoutes({ pool, bcryptRounds, loginLimiter: authLimiter }));
  app.use("/api", createRoutes(pool));

  app.get("/login", redirectIfAuthed, (_req, res) => {
    res.sendFile(path.join(publicDir, "login.html"));
  });
  app.get("/signup", redirectIfAuthed, (_req, res) => {
    res.sendFile(path.join(publicDir, "signup.html"));
  });
  app.get(["/", "/index.html"], requirePageAuth, (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.use(express.static(publicDir, { index: false }));

  app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, error: "API endpoint not found." });
  });

  app.use((error, _req, res, _next) => {
    if (error?.type === "entity.parse.failed") {
      return res.status(400).json({ success: false, error: "Invalid JSON body." });
    }
    res.status(500).json({ success: false, error: "Unexpected server error." });
  });

  return app;
}

module.exports = { createApp };
