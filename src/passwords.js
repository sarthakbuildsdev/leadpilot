"use strict";

const bcrypt = require("bcrypt");

let dummyHashPromise;

function dummyHash() {
  dummyHashPromise ||= bcrypt.hash("leadpilot-dummy-password", 4);
  return dummyHashPromise;
}

function hashPassword(password, rounds) {
  return bcrypt.hash(password, rounds);
}

async function verifyPassword(password, passwordHash) {
  const hash = passwordHash || (await dummyHash());
  const matches = await bcrypt.compare(password, hash);
  return Boolean(passwordHash) && matches;
}

module.exports = { hashPassword, verifyPassword };
