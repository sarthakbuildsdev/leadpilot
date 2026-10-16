"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient, memoryAuthPool, mockPool, signIn, signUp, withServer } = require("./helpers");
const { verifyPassword } = require("../src/passwords");

const CREDENTIALS = { name: "Sarthak", email: "sarthak@example.com", password: "password123" };

test("GET /api/health is public and reports session mode", async () => {
  await withServer(mockPool([]), async (port) => {
    const client = createClient();
    const res = await client.request(port, { path: "/api/health" });
    assert.equal(res.status, 200);
    assert.equal(res.json.mode, "session");
  });
});

test("GET /api/auth/csrf issues a token tied to a session cookie", async () => {
  await withServer(memoryAuthPool(), async (port) => {
    const client = createClient();
    const first = await client.request(port, { path: "/api/auth/csrf" });
    assert.equal(first.status, 200);
    assert.equal(typeof first.json.token, "string");
    assert.ok(first.json.token.length >= 32);

    const second = await client.request(port, { path: "/api/auth/csrf" });
    assert.equal(second.json.token, first.json.token, "token is stable within a session");
  });
});

test("registration creates a bcrypt-hashed account and signs the user in", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    const before = await client.request(port, { path: "/api/auth/csrf" });
    const cookieBefore = client.getCookies();
    assert.equal(before.status, 200);

    const created = await client.request(port, {
      method: "POST",
      path: "/api/auth/register",
      body: CREDENTIALS,
      csrf: before.json.token
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.user.email, CREDENTIALS.email);
    assert.equal(created.json.user.password_hash, undefined, "hash is never returned");
    assert.equal(client.getCookies() === cookieBefore, false, "session id is regenerated on signup");

    // Stored secret is a bcrypt hash, not the raw password.
    assert.notEqual(pool.users[0].password_hash, CREDENTIALS.password);
    assert.ok(/^\$2[aby]\$/.test(pool.users[0].password_hash));
    assert.equal(await verifyPassword(CREDENTIALS.password, pool.users[0].password_hash), true);

    const me = await client.request(port, { path: "/api/auth/me" });
    assert.equal(me.status, 200);
    assert.equal(me.json.user.id, created.json.user.id);
  });
});

test("registration rejects bad input and duplicate emails", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);

    const dupe = createClient();
    const dupeRes = await signUp(dupe, port, CREDENTIALS);
    assert.equal(dupeRes.res.status, 409);
    assert.match(dupeRes.res.json.error, /already exists/i);

    const bad = createClient();
    await bad.csrf(port);
    const invalid = await bad.request(port, {
      method: "POST",
      path: "/api/auth/register",
      body: { name: "", email: "not-an-email", password: "short" },
      csrf: bad.getCsrfToken()
    });
    assert.equal(invalid.status, 400);
    assert.ok(invalid.json.errors.length >= 3);
    assert.equal(pool.users.length, 1, "invalid registrations never touch the users table");
  });
});

test("login accepts the correct password and rejects wrong or unknown credentials", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const owner = createClient();
    await signUp(owner, port, CREDENTIALS);

    const good = createClient();
    const ok = await signIn(good, port, { email: CREDENTIALS.email, password: CREDENTIALS.password });
    assert.equal(ok.res.status, 200);
    assert.equal(ok.res.json.user.email, CREDENTIALS.email);
    const me = await good.request(port, { path: "/api/auth/me" });
    assert.equal(me.status, 200);

    const wrong = createClient();
    const bad = await signIn(wrong, port, { email: CREDENTIALS.email, password: "wrong-password" });
    assert.equal(bad.res.status, 401);
    assert.equal(bad.res.json.error, "Invalid email or password.");

    const unknown = createClient();
    const missing = await signIn(unknown, port, { email: "nobody@example.com", password: "password123" });
    assert.equal(missing.res.status, 401);

    // Login is case-insensitive on email, matching the unique LOWER(email) index.
    const mixed = createClient();
    const lower = await signIn(mixed, port, { email: "Sarthak@Example.com", password: CREDENTIALS.password });
    assert.equal(lower.res.status, 200);
  });
});

test("login regenerates the session id so a pre-login cookie cannot be reused", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const owner = createClient();
    await signUp(owner, port, CREDENTIALS);

    const attacker = createClient();
    await attacker.csrf(port);
    const cookieBeforeLogin = attacker.getCookies();

    await signIn(attacker, port, { email: CREDENTIALS.email, password: CREDENTIALS.password });
    assert.notEqual(attacker.getCookies(), cookieBeforeLogin);

    const replay = createClient();
    const me = await replay.request(port, { path: "/api/auth/me", headers: { Cookie: cookieBeforeLogin } });
    assert.equal(me.status, 401, "the pre-login session is not authenticated");
  });
});

test("logout destroys the session and clears the cookie", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);

    const before = await client.request(port, { path: "/api/auth/me" });
    assert.equal(before.status, 200);

    const out = await client.request(port, {
      method: "POST",
      path: "/api/auth/logout",
      csrf: client.getCsrfToken()
    });
    assert.equal(out.status, 200);
    assert.equal(out.json.success, true);
    assert.match(String(out.headers["set-cookie"]), /leadpilot\.sid=;/);

    const after = await client.request(port, { path: "/api/auth/me" });
    assert.equal(after.status, 401);
  });
});

test("auth endpoints reject requests without a valid CSRF token", async () => {
  await withServer(memoryAuthPool(), async (port) => {
    const client = createClient();

    const noToken = await client.request(port, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password }
    });
    assert.equal(noToken.status, 403);
    assert.equal(noToken.json.code, "csrf");

    await client.csrf(port);
    const wrongToken = await client.request(port, {
      method: "POST",
      path: "/api/auth/login",
      body: { email: CREDENTIALS.email, password: CREDENTIALS.password },
      csrf: "0".repeat(64)
    });
    assert.equal(wrongToken.status, 403);
    assert.equal(wrongToken.json.code, "csrf");

    const noRegister = await client.request(port, {
      method: "POST",
      path: "/api/auth/register",
      body: CREDENTIALS
    });
    assert.equal(noRegister.status, 403);
  });
});

test("page routes require a session and auth pages redirect signed-in users", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const guest = createClient();
    const home = await guest.request(port, { path: "/" });
    assert.equal(home.status, 302);
    assert.equal(home.headers.location, "/login");

    const loginPage = await guest.request(port, { path: "/login" });
    assert.equal(loginPage.status, 200);
    assert.match(String(loginPage.json), /Sign in/);

    const client = createClient();
    await signUp(client, port, CREDENTIALS);
    const authedHome = await client.request(port, { path: "/" });
    assert.equal(authedHome.status, 200);

    const authedLogin = await client.request(port, { path: "/login" });
    assert.equal(authedLogin.status, 302);
    assert.equal(authedLogin.headers.location, "/");
  });
});

test("unknown API endpoints return a JSON 404", async () => {
  await withServer(memoryAuthPool(), async (port) => {
    const client = createClient();
    const res = await client.request(port, { path: "/api/does-not-exist" });
    assert.equal(res.status, 404);
    assert.equal(res.json.success, false);
  });
});
