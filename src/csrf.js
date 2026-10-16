"use strict";

const crypto = require("crypto");

function createCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = createCsrfToken();
  }
  return req.session.csrfToken;
}

function csrfProtect(req, res, next) {
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return next();
  }

  const sent = req.get("x-csrf-token") || req.body?._csrf;
  if (!safeEqual(sent, req.session?.csrfToken || "")) {
    return res.status(403).json({
      success: false,
      code: "csrf",
      error: "Invalid or missing security token. Refresh the page and try again."
    });
  }

  return next();
}

module.exports = { createCsrfToken, ensureCsrfToken, csrfProtect, safeEqual };
