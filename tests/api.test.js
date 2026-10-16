"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../src/app");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function request(port, { method = "GET", path, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: body ? { "Content-Type": "application/json" } : {}
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let json = null;
          try {
            json = JSON.parse(data);
          } catch {
            json = data;
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function mockPool(handlers) {
  return {
    query: async (text, params = []) => {
      const match = handlers.find((handler) => handler.match(text, params));
      if (!match) {
        throw new Error(`Unexpected query: ${text}`);
      }
      return match.result(text, params);
    }
  };
}

test("GET /api/health reports single-user mode", async () => {
  const app = createApp({ pool: mockPool([]) });
  const { server, port } = await listen(app);
  try {
    const res = await request(port, { path: "/api/health" });
    assert.equal(res.status, 200);
    assert.equal(res.json.success, true);
    assert.equal(res.json.auth, false);
    assert.equal(res.json.mode, "single-user-local");
  } finally {
    server.close();
  }
});

test("POST /api/leads validates before touching the database", async () => {
  let queried = false;
  const app = createApp({
    pool: mockPool([
      {
        match: () => {
          queried = true;
          return true;
        },
        result: () => ({ rows: [] })
      }
    ])
  });
  const { server, port } = await listen(app);
  try {
    const res = await request(port, {
      method: "POST",
      path: "/api/leads",
      body: { name: "", business: "" }
    });
    assert.equal(res.status, 400);
    assert.equal(queried, false);
    assert.ok(res.json.errors.length > 0);
  } finally {
    server.close();
  }
});

test("GET /api/leads/:id rejects invalid ids", async () => {
  const app = createApp({ pool: mockPool([]) });
  const { server, port } = await listen(app);
  try {
    const res = await request(port, { path: "/api/leads/not-a-uuid" });
    assert.equal(res.status, 400);
  } finally {
    server.close();
  }
});

test("GET /api/stats maps database totals", async () => {
  const app = createApp({
    pool: mockPool([
      {
        match: (text) => text.includes("COUNT(*)::int AS total_leads"),
        result: () => ({
          rows: [
            {
              total_leads: 3,
              new_leads: 1,
              contacted_leads: 0,
              interested_leads: 1,
              won_deals: 1,
              lost_deals: 0,
              won_revenue: 50000,
              pipeline_value: 12000,
              overdue_followups: 1,
              today_followups: 0
            }
          ]
        })
      },
      {
        match: (text) => text.includes("GROUP BY COALESCE(source"),
        result: () => ({ rows: [{ source: "Referral", count: 2 }] })
      }
    ])
  });
  const { server, port } = await listen(app);
  try {
    const res = await request(port, { path: "/api/stats" });
    assert.equal(res.status, 200);
    assert.equal(res.json.stats.total_leads, 3);
    assert.equal(res.json.stats.won_revenue, 50000);
    assert.equal(res.json.stats.by_source[0].source, "Referral");
  } finally {
    server.close();
  }
});

test("POST /api/leads inserts with parameters and returns 201", async () => {
  const app = createApp({
    pool: mockPool([
      {
        match: (text) => text.includes("INSERT INTO leads"),
        result: (_text, params) => ({
          rows: [
            {
              id: "3f1c2d8a-7b4e-4a91-9c2d-8e7f6a5b4c3d",
              name: params[0],
              business: params[1],
              phone: params[2],
              email: params[3],
              source: params[4],
              status: params[5],
              amount: params[6],
              notes: params[7],
              followup_date: params[8],
              created_at: "2026-10-15T00:00:00.000Z",
              updated_at: "2026-10-15T00:00:00.000Z"
            }
          ]
        })
      }
    ])
  });
  const { server, port } = await listen(app);
  try {
    const res = await request(port, {
      method: "POST",
      path: "/api/leads",
      body: {
        name: "Neha",
        business: "Neha Studio",
        status: "New",
        amount: 1000
      }
    });
    assert.equal(res.status, 201);
    assert.equal(res.json.lead.name, "Neha");
    assert.equal(res.json.lead.business, "Neha Studio");
  } finally {
    server.close();
  }
});

test("init script is idempotent and does not drop tables", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "initDb.js"), "utf8");
  assert.ok(source.includes("CREATE TABLE IF NOT EXISTS"));
  assert.ok(source.includes("ADD COLUMN IF NOT EXISTS"));
  assert.ok(!/drop table/i.test(source));
  assert.ok(!/truncate/i.test(source));
});
