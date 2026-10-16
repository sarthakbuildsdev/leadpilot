"use strict";

const express = require("express");
const { publicDbError } = require("./db");
const { validateRegister, validateLogin } = require("./authValidate");
const { hashPassword, verifyPassword } = require("./passwords");
const { createCsrfToken, ensureCsrfToken } = require("./csrf");
const { isUuid } = require("./validate");

function publicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    created_at: row.created_at
  };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

function createAuthRoutes({ pool, bcryptRounds, loginLimiter, cookieName = "leadpilot.sid", cookieSecure = false }) {
  const limiter = loginLimiter || ((_req, _res, next) => next());
  const router = express.Router();
  const clearCookieOptions = { httpOnly: true, sameSite: "lax", secure: Boolean(cookieSecure), path: "/" };

  router.get("/csrf", async (req, res) => {
    try {
      const token = ensureCsrfToken(req);
      await saveSession(req);
      res.json({ success: true, token });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({
        success: false,
        error:
          mapped.status === 500
            ? "Could not save your session. Confirm PostgreSQL is running and try again."
            : mapped.message
      });
    }
  });

  router.get("/me", async (req, res) => {
    if (!req.session.userId || !isUuid(req.session.userId)) {
      return res.status(401).json({ success: false, error: "Please sign in." });
    }

    try {
      const { rows } = await pool.query(
        "SELECT id, name, email, created_at FROM users WHERE id = $1",
        [req.session.userId]
      );
      if (!rows[0]) {
        await destroySession(req).catch(() => {});
        res.clearCookie(cookieName, clearCookieOptions);
        return res.status(401).json({ success: false, error: "Please sign in." });
      }
      res.json({ success: true, user: publicUser(rows[0]) });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.post("/register", limiter, async (req, res) => {
    const { errors, data } = validateRegister(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    try {
      const passwordHash = await hashPassword(data.password, bcryptRounds);
      const { rows } = await pool.query(
        `INSERT INTO users (name, email, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, name, email, created_at`,
        [data.name, data.email, passwordHash]
      );

      await regenerateSession(req);
      req.session.userId = rows[0].id;
      req.session.csrfToken = createCsrfToken();
      await saveSession(req);

      res.status(201).json({
        success: true,
        user: publicUser(rows[0]),
        csrfToken: req.session.csrfToken
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          success: false,
          error: "An account with this email already exists."
        });
      }
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.post("/login", limiter, async (req, res) => {
    const { errors, data } = validateLogin(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    try {
      const { rows } = await pool.query(
        "SELECT id, name, email, password_hash, created_at FROM users WHERE email = $1",
        [data.email]
      );
      const user = rows[0];
      const ok = await verifyPassword(data.password, user?.password_hash);
      if (!ok) {
        return res.status(401).json({ success: false, error: "Invalid email or password." });
      }

      await regenerateSession(req);
      req.session.userId = user.id;
      req.session.csrfToken = createCsrfToken();
      await saveSession(req);

      res.json({
        success: true,
        user: publicUser(user),
        csrfToken: req.session.csrfToken
      });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.post("/logout", async (req, res) => {
    // Always clear the cookie, even if the store already dropped the session.
    await destroySession(req).catch(() => {});
    res.clearCookie(cookieName, clearCookieOptions);
    res.json({ success: true });
  });

  return router;
}

module.exports = { createAuthRoutes };
