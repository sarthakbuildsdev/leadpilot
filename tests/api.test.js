"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createClient,
  memoryAuthPool,
  mockPool,
  signUp,
  withServer
} = require("./helpers");

const VALID_LEAD_UUID = "3f1c2d8a-7b4e-4a91-9c2d-8e7f6a5b4c3d";
const CREDENTIALS = { name: "Owner", email: "owner@example.com", password: "password123" };

// Only list/stat queries are owner-scoped through "user_id = $1"; UPDATE and
// DELETE pass the owner as a later parameter, so match on "FROM leads" too.
function ownerScopedQueries(pool) {
  return pool.queries.filter(
    (query) => query.text.includes("FROM leads") && query.text.includes("WHERE user_id = $1")
  );
}

test("GET /api/health reports session mode", async () => {
  await withServer(mockPool([]), async (port) => {
    const client = createClient();
    const res = await client.request(port, { path: "/api/health" });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.auth, true);
    assert.equal(res.json.mode, "session");
  });
});

test("lead and stats endpoints require a signed-in session", async () => {
  await withServer(memoryAuthPool(), async (port) => {
    const client = createClient();
    for (const requestPath of ["/api/leads", "/api/stats", `/api/leads/${VALID_LEAD_UUID}`]) {
      const res = await client.request(port, { path: requestPath });
      assert.equal(res.status, 401, `${requestPath} must require authentication`);
      assert.equal(res.json.success, false);
    }
  });
});

test("state-changing API calls without a CSRF token are rejected", async () => {
  await withServer(memoryAuthPool(), async (port) => {
    const client = createClient();
    const res = await client.request(port, {
      method: "POST",
      path: "/api/leads",
      body: { name: "X", business: "Y" }
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "csrf");
  });
});

test("a wrong CSRF token is rejected even for a signed-in user", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);
    const res = await client.request(port, {
      method: "POST",
      path: "/api/leads",
      body: { name: "X", business: "Y" },
      csrf: "0".repeat(64)
    });
    assert.equal(res.status, 403);
    assert.equal(res.json.code, "csrf");
    assert.equal(pool.leads.length, 0);
  });
});

test("POST /api/leads validates before touching the database", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);
    const before = pool.queries.length;

    const res = await client.request(port, {
      method: "POST",
      path: "/api/leads",
      body: { name: "", business: "" },
      csrf: client.getCsrfToken()
    });
    assert.equal(res.status, 400);
    assert.ok(res.json.errors.length > 0);
    assert.equal(pool.queries.length, before, "invalid payloads never reach PostgreSQL");
  });
});

test("GET /api/leads/:id rejects invalid ids", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);
    const res = await client.request(port, { path: "/api/leads/not-a-uuid" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "Invalid lead id.");
  });
});

test("POST /api/leads stores the lead under the signed-in user", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);

    const res = await client.request(port, {
      method: "POST",
      path: "/api/leads",
      body: { name: "Neha", business: "Neha Studio", status: "New", amount: 1000 },
      csrf: client.getCsrfToken()
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.lead.name, "Neha");
    assert.equal(res.json.lead.business, "Neha Studio");
    assert.equal(res.json.lead.amount, 1000);
    assert.equal(pool.leads.length, 1);
    assert.equal(pool.leads[0].user_id, pool.users[0].id);
  });
});

test("GET /api/stats only counts the signed-in user's leads", async () => {
  const pool = memoryAuthPool();
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);
    const userId = pool.users[0].id;

    pool.seedLead({ user_id: userId, name: "A", business: "A Co", status: "New", amount: 1000, source: "Website" });
    pool.seedLead({ user_id: userId, name: "B", business: "B Co", status: "Won", amount: 50000, source: "Referral" });
    pool.seedLead({ user_id: otherUserId, name: "C", business: "C Co", status: "Won", amount: 999999, source: "Referral" });

    const res = await client.request(port, { path: "/api/stats" });
    assert.equal(res.status, 200);
    const stats = res.json.stats;
    assert.equal(stats.total_leads, 2);
    assert.equal(stats.new_leads, 1);
    assert.equal(stats.won_deals, 1);
    assert.equal(stats.won_revenue, 50000);
    assert.equal(stats.pipeline_value, 1000);
    assert.deepEqual(stats.by_source.map((row) => row.source), ["Referral", "Website"]);
    assert.equal(JSON.stringify(stats).includes("999999"), false);

    for (const query of ownerScopedQueries(pool)) {
      assert.equal(query.params[0], userId);
    }
  });
});

test("search, status, source, follow-up filters and sorting stay owner-scoped", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const client = createClient();
    await signUp(client, port, CREDENTIALS);
    const userId = pool.users[0].id;

    pool.seedLead({ user_id: userId, name: "Rahul Sharma", business: "Rahul Events", status: "New", amount: 5000, source: "Referral", followup_date: "2020-01-01" });
    pool.seedLead({ user_id: userId, name: "Priya Nair", business: "Priya Designs", status: "Won", amount: 9000, source: "Website", followup_date: null });

    const byStatus = await client.request(port, { path: "/api/leads?status=Won" });
    assert.equal(byStatus.status, 200);
    assert.deepEqual(byStatus.json.leads.map((lead) => lead.name), ["Priya Nair"]);

    const bySource = await client.request(port, { path: "/api/leads?source=Referral" });
    assert.deepEqual(bySource.json.leads.map((lead) => lead.name), ["Rahul Sharma"]);

    const search = await client.request(port, { path: "/api/leads?search=priya" });
    assert.deepEqual(search.json.leads.map((lead) => lead.name), ["Priya Nair"]);

    const overdue = await client.request(port, { path: "/api/leads?followup=overdue" });
    assert.deepEqual(overdue.json.leads.map((lead) => lead.name), ["Rahul Sharma"]);

    const none = await client.request(port, { path: "/api/leads?followup=none" });
    assert.deepEqual(none.json.leads.map((lead) => lead.name), ["Priya Nair"]);

    await client.request(port, { path: "/api/leads?sort=amount&order=desc" });
    const sorted = pool.queries.filter((query) => query.text.includes("ORDER BY amount DESC"));
    assert.ok(sorted.length >= 1);
    assert.equal(sorted[0].params[0], userId);

    const bad = await client.request(port, { path: "/api/leads?status=Hot" });
    assert.equal(bad.status, 400);

    for (const query of ownerScopedQueries(pool)) {
      assert.equal(query.params[0], userId);
    }
  });
});

test("leads are private to their owner across list, read, update and delete", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const alice = createClient();
    await signUp(alice, port, { name: "Alice", email: "alice@example.com", password: "password123" });
    const aliceId = pool.users[0].id;

    const created = await alice.request(port, {
      method: "POST",
      path: "/api/leads",
      body: { name: "Alice Lead", business: "Alice Co", status: "New", amount: 100 },
      csrf: alice.getCsrfToken()
    });
    assert.equal(created.status, 201);
    const leadId = created.json.lead.id;

    const bob = createClient();
    await signUp(bob, port, { name: "Bob", email: "bob@example.com", password: "password123" });
    const bobId = pool.users[1].id;

    const bobList = await bob.request(port, { path: "/api/leads" });
    assert.equal(bobList.status, 200);
    assert.deepEqual(bobList.json.leads, []);

    const bobRead = await bob.request(port, { path: `/api/leads/${leadId}` });
    assert.equal(bobRead.status, 404);

    const bobUpdate = await bob.request(port, {
      method: "PUT",
      path: `/api/leads/${leadId}`,
      body: { name: "Hijacked", business: "Hijacked Co" },
      csrf: bob.getCsrfToken()
    });
    assert.equal(bobUpdate.status, 404);

    const bobDelete = await bob.request(port, {
      method: "DELETE",
      path: `/api/leads/${leadId}`,
      csrf: bob.getCsrfToken()
    });
    assert.equal(bobDelete.status, 404);

    const aliceRead = await alice.request(port, { path: `/api/leads/${leadId}` });
    assert.equal(aliceRead.status, 200);
    assert.equal(aliceRead.json.lead.name, "Alice Lead", "Bob's update never landed");

    const aliceList = await alice.request(port, { path: "/api/leads" });
    assert.deepEqual(aliceList.json.leads.map((lead) => lead.id), [leadId]);

    const aliceUpdate = await alice.request(port, {
      method: "PUT",
      path: `/api/leads/${leadId}`,
      body: { name: "Alice Lead", business: "Alice Co", status: "Won", amount: 500 },
      csrf: alice.getCsrfToken()
    });
    assert.equal(aliceUpdate.status, 200);
    assert.equal(aliceUpdate.json.lead.status, "Won");
    assert.equal(aliceUpdate.json.lead.amount, 500);

    const scoped = ownerScopedQueries(pool);
    assert.ok(scoped.length >= 2);
    for (const query of scoped) {
      assert.ok([aliceId, bobId].includes(query.params[0]), "owner param is a real user id");
    }
    assert.ok(scoped.some((query) => query.params[0] === bobId));

    const aliceDelete = await alice.request(port, {
      method: "DELETE",
      path: `/api/leads/${leadId}`,
      csrf: alice.getCsrfToken()
    });
    assert.equal(aliceDelete.status, 200);
    assert.equal(pool.leads.length, 0);
  });
});

test("leads with no owner stay hidden and are never auto-assigned", async () => {
  const pool = memoryAuthPool();
  await withServer(pool, async (port) => {
    const legacy = pool.seedLead({ user_id: null, name: "Legacy Lead", business: "Old Co", status: "New", amount: 4200 });

    const client = createClient();
    await signUp(client, port, { name: "New User", email: "new@example.com", password: "password123" });

    const list = await client.request(port, { path: "/api/leads" });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.leads, []);

    const stats = await client.request(port, { path: "/api/stats" });
    assert.equal(stats.json.stats.total_leads, 0);

    const read = await client.request(port, { path: `/api/leads/${legacy.id}` });
    assert.equal(read.status, 404);

    assert.equal(pool.leads.find((lead) => lead.id === legacy.id).user_id, null);
  });
});

test("init script is idempotent and does not drop tables", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "initDb.js"), "utf8");
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS"));
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS"));
  assert.ok(!/drop table/i.test(source));
  assert.ok(!/truncate/i.test(source));
});

test("requireAuth rejects a session whose user id is not a real UUID", () => {
  const { requireAuth } = require("../src/routes");

  function fakeRes() {
    return {
      code: null,
      payload: null,
      status(code) {
        this.code = code;
        return this;
      },
      json(payload) {
        this.payload = payload;
        return this;
      }
    };
  }

  for (const userId of [undefined, null, "", "not-a-uuid", 42]) {
    const res = fakeRes();
    let called = false;
    requireAuth({ session: { userId } }, res, () => {
      called = true;
    });
    assert.equal(called, false, `userId ${String(userId)} must not pass requireAuth`);
    assert.equal(res.code, 401);
  }

  const res = fakeRes();
  let called = false;
  requireAuth({ session: { userId: "11111111-1111-4111-8111-111111111111" } }, res, () => {
    called = true;
  });
  assert.equal(called, true);
  assert.equal(res.code, null);
});
