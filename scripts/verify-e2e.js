"use strict";

/**
 * End-to-end verification against a REAL PostgreSQL server.
 *
 * Starts a throwaway PostgreSQL cluster in the OS temp directory (its own port,
 * its own data directory), runs `node server.js` against it, and exercises the
 * full auth + lead-ownership flow over HTTP. Your own .env and your real
 * `leadpilot` database are never touched, and nothing is dropped or truncated.
 *
 * Usage:
 *   npm install --no-save embedded-postgres   # optional, not a project dependency
 *   node scripts/verify-e2e.js
 */
const { spawn } = require('node:child_process');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
let EmbeddedPostgres;

const REPO_ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(os.tmpdir(), 'leadpilot-verify-pgdata');
const PORT = 3999;
const PG_PORT = 55432;
const SECRET = crypto.randomBytes(48).toString('hex');
// Throwaway credential for the temporary cluster this script creates and deletes.
const PG_PASSWORD = crypto.randomBytes(16).toString('hex');

function log(...args) { console.log(...args); }

function dbClient() {
  const { Client } = require('pg');
  return new Client({ host: '127.0.0.1', port: PG_PORT, user: 'postgres', password: PG_PASSWORD, database: 'leadpilot' });
}

function startServer(extraEnv = {}) {
  return spawn('node', ['server.js'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PGHOST: '127.0.0.1',
      PGPORT: String(PG_PORT),
      PGUSER: 'postgres',
      PGPASSWORD: PG_PASSWORD,
      PGDATABASE: 'leadpilot',
      SESSION_SECRET: SECRET,
      PORT: String(PORT),
      NODE_ENV: 'development',
      ...extraEnv
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function waitForReady(server, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error('server start timeout: ' + out)), timeoutMs);
    const onData = (chunk) => {
      const text = chunk.toString();
      out += text;
      process.stdout.write('[server] ' + text);
      if (out.includes('running at')) {
        clearTimeout(timer);
        resolve(out);
      }
    };
    server.stdout.on('data', onData);
    server.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      out += text;
      process.stdout.write('[server:err] ' + text);
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => {
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
  });
}

function makeClient() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async req(path, { method = 'GET', body, csrf, rawCookie } = {}) {
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (csrf) headers['x-csrf-token'] = csrf;
      const useCookie = rawCookie !== undefined ? rawCookie : cookie;
      if (useCookie) headers.cookie = useCookie;
      const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual'
      });
      const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
      if (setCookie.length) cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { json = text; }
      return { status: res.status, json, location: res.headers.get('location') };
    }
  };
}

function assert(label, condition, detail) {
  if (!condition) {
    log(`FAIL  ${label} ${detail ? '- ' + detail : ''}`);
    throw new Error('assertion failed: ' + label);
  }
  log(`PASS  ${label}`);
}

(async () => {
  try {
    ({ default: EmbeddedPostgres } = await import('embedded-postgres'));
  } catch {
    throw new Error(
      'This script needs the optional package `embedded-postgres`. Install it with:\n  npm install --no-save embedded-postgres'
    );
  }
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false
  });

  await pg.initialise();
  await pg.start();
  await pg.createDatabase('leadpilot');
  log('PG_READY (real PostgreSQL started on port ' + PG_PORT + ')');

  let server = startServer();
  await waitForReady(server);

  const health = await makeClient().req('/api/health');
  assert('health ok', health.status === 200 && health.json.mode === 'session');

  const guest = makeClient();
  const home = await guest.req('/');
  assert('GET / redirects guests to /login', home.status === 302 && home.location === '/login');

  const alice = makeClient();
  const csrf = await alice.req('/api/auth/csrf');
  assert('csrf issued', csrf.status === 200 && typeof csrf.json.token === 'string');

  const registered = await alice.req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Alice', email: 'alice@example.com', password: 'password123' },
    csrf: csrf.json.token
  });
  assert('register creates account (201)', registered.status === 201, JSON.stringify(registered.json));
  const aliceCsrf = registered.json.csrfToken;

  const badCsrf = await alice.req('/api/leads', { method: 'POST', body: { name: 'X', business: 'Y' }, csrf: 'wrong' });
  assert('wrong CSRF rejected with 403', badCsrf.status === 403 && badCsrf.json.code === 'csrf');

  const created = await alice.req('/api/leads', {
    method: 'POST',
    body: { name: 'Alice Lead', business: 'Alice Co', status: 'New', amount: 5000, source: 'Referral', followup_date: '2020-01-01' },
    csrf: aliceCsrf
  });
  assert('lead created (201)', created.status === 201, JSON.stringify(created.json));
  const leadId = created.json.lead.id;

  const list = await alice.req('/api/leads');
  assert('owner sees own lead', list.status === 200 && list.json.leads.length === 1 && list.json.leads[0].id === leadId);

  const stats = await alice.req('/api/stats');
  assert('stats computed for owner', stats.status === 200 && stats.json.stats.total_leads === 1 && stats.json.stats.pipeline_value === 5000);

  const bob = makeClient();
  const bobCsrf = await bob.req('/api/auth/csrf');
  const bobReg = await bob.req('/api/auth/register', {
    method: 'POST',
    body: { name: 'Bob', email: 'bob@example.com', password: 'password123' },
    csrf: bobCsrf.json.token
  });
  assert('second user registered', bobReg.status === 201);

  const bobList = await bob.req('/api/leads');
  assert('other user sees zero leads', bobList.status === 200 && bobList.json.leads.length === 0);
  const bobRead = await bob.req(`/api/leads/${leadId}`);
  assert('other user cannot read the lead (404)', bobRead.status === 404);
  const bobDel = await bob.req(`/api/leads/${leadId}`, { method: 'DELETE', csrf: bobReg.json.csrfToken });
  assert('other user cannot delete the lead (404)', bobDel.status === 404);

  const search = await alice.req('/api/leads?search=alice&status=New&followup=overdue');
  assert('search + filters work for owner', search.status === 200 && search.json.leads.length === 1);

  const me = await alice.req('/api/auth/me');
  assert('/api/auth/me returns the session user', me.status === 200 && me.json.user.email === 'alice@example.com');

  const loggedOut = await alice.req('/api/auth/logout', { method: 'POST', csrf: aliceCsrf });
  assert('logout succeeds', loggedOut.status === 200);
  const afterLogout = await alice.req('/api/auth/me');
  assert('session destroyed after logout', afterLogout.status === 401);

  // Insert a legacy unowned lead directly, then restart to confirm the app never adopts it.
  const client = dbClient();
  await client.connect();
  await client.query("INSERT INTO leads (name, business, status, amount, user_id) VALUES ('Legacy', 'Old Co', 'New', 999, NULL)");
  await client.end();
  log('inserted one unowned (user_id IS NULL) lead directly');

  await stopServer(server);
  server = startServer();
  const restartOutput = await waitForReady(server);
  assert('startup warns about unowned leads and never assigns them', /have no owner/.test(restartOutput));

  const bobAgain = makeClient();
  const bobCsrf2 = await bobAgain.req('/api/auth/csrf');
  await bobAgain.req('/api/auth/login', { method: 'POST', body: { email: 'bob@example.com', password: 'password123' }, csrf: bobCsrf2.json.token });
  const bobList2 = await bobAgain.req('/api/leads');
  assert('unowned lead stays invisible to signed-in users', bobList2.json.leads.length === 0);

  const check = dbClient();
  await check.connect();
  const owned = await check.query('SELECT COUNT(*)::int AS n FROM leads WHERE user_id IS NULL');
  const total = await check.query('SELECT COUNT(*)::int AS n FROM leads');
  const tables = await check.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
  const cols = await check.query("SELECT column_name FROM information_schema.columns WHERE table_name='leads' AND column_name='user_id'");
  await check.end();
  assert('unowned lead still has user_id NULL', owned.rows[0].n === 1);
  assert('no rows were dropped (2 leads total)', total.rows[0].n === 2);
  assert('tables created', ['leads','user_sessions','users'].every((t) => tables.rows.some((r) => r.table_name === t)), JSON.stringify(tables.rows));
  assert('leads.user_id column exists', cols.rows.length === 1);

  await stopServer(server);
  await pg.stop();
  log('ALL VERIFICATION CHECKS PASSED');
  process.exit(0);
})().catch(async (error) => {
  console.error('VERIFICATION ERROR:', error.message);
  try { process.exit(1); } catch {}
});
