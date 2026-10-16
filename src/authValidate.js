"use strict";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validateRegister(body = {}) {
  const errors = [];
  const data = {};

  if (!isNonEmptyString(body.name)) {
    errors.push("Name is required.");
  } else if (body.name.trim().length > 80) {
    errors.push("Name must be 80 characters or fewer.");
  } else {
    data.name = body.name.trim();
  }

  const email = isNonEmptyString(body.email) ? body.email.trim().toLowerCase() : "";
  if (!email) {
    errors.push("Email is required.");
  } else if (email.length > 254 || !EMAIL_RE.test(email)) {
    errors.push("Enter a valid email address.");
  } else {
    data.email = email;
  }

  if (typeof body.password !== "string" || body.password.length < 8) {
    errors.push("Password must be at least 8 characters.");
  } else if (body.password.length > 72) {
    errors.push("Password must be 72 characters or fewer.");
  } else {
    data.password = body.password;
  }

  return { errors, data };
}

function validateLogin(body = {}) {
  const errors = [];
  const data = {};

  const email = isNonEmptyString(body.email) ? body.email.trim().toLowerCase() : "";
  if (!email || !EMAIL_RE.test(email)) {
    errors.push("Enter a valid email address.");
  } else {
    data.email = email;
  }

  if (typeof body.password !== "string" || !body.password) {
    errors.push("Password is required.");
  } else if (body.password.length > 72) {
    errors.push("Password must be 72 characters or fewer.");
  } else {
    data.password = body.password;
  }

  return { errors, data };
}

module.exports = { validateRegister, validateLogin };
