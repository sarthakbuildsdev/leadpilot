"use strict";

const http = require("node:http");
const session = require("express-session");
const { createApp } = require("../src/app");

const TEST_SECRET = "test-session-secret-value-at-least-32-chars";

function createTestApp(pool) {
  return createApp({
    pool,
    sessionStore: new session.MemoryStore(),
    sessionSecret: TEST_SECRET,
    cookieSecure: false,
    bcryptRounds: 4,
    disableRateLimit: true
  });
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
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

function createClient() {
  let cookies = "";
  let csrfToken = "";

  function applyCookies(rawSetCookie) {
    if (!rawSetCookie) return;
    const list = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie];
    cookies = list.map((item) => item.split(";")[0]).join("; ");
  }

  function request(port, { method = "GET", path, body, headers = {}, csrf } = {}) {
    return new Promise((resolve, reject) => {
      const upperMethod = String(method).toUpperCase();
      const isRead = ["GET", "HEAD", "OPTIONS"].includes(upperMethod);
      const allHeaders = { ...headers };
      if (body !== undefined) allHeaders["Content-Type"] = "application/json";
      if (!isRead && csrf !== undefined && csrf !== null) allHeaders["x-csrf-token"] = csrf;
      if (cookies) allHeaders.Cookie = cookies;

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: upperMethod,
          headers: allHeaders
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            applyCookies(res.headers["set-cookie"]);
            let json = null;
            try {
              json = JSON.parse(data);
            } catch {
              json = data;
            }
            if (json && typeof json === "object" && typeof json.csrfToken === "string") {
              csrfToken = json.csrfToken;
            }
            resolve({ status: res.statusCode, json, headers: res.headers });
          });
        }
      );
      req.on("error", reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }

  async function csrf(port) {
    const res = await request(port, { path: "/api/auth/csrf" });
    if (!res.json?.token) {
      throw new Error("CSRF token was not issued");
    }
    csrfToken = res.json.token;
    return csrfToken;
  }

  return {
    request,
    csrf,
    getCookies: () => cookies,
    getCsrfToken: () => csrfToken
  };
}

async function signUp(client, port, user) {
  const token = await client.csrf(port);
  const res = await client.request(port, {
    method: "POST",
    path: "/api/auth/register",
    body: user,
    csrf: token
  });
  return { res, csrfToken: res.json?.csrfToken || token };
}

async function signIn(client, port, credentials) {
  const token = await client.csrf(port);
  const res = await client.request(port, {
    method: "POST",
    path: "/api/auth/login",
    body: credentials,
    csrf: token
  });
  return { res, csrfToken: res.json?.csrfToken || token };
}

async function withServer(pool, fn) {
  const app = createTestApp(pool);
  const { server, port } = await listen(app);
  try {
    await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function memoryAuthPool() {
  const crypto = require("node:crypto");
  const users = [];
  const leads = [];
  const queries = [];

  function findOwned(id, userId) {
    return leads.find((lead) => lead.id === id && lead.user_id === userId);
  }

  function paramIndexFor(rawSql, regex) {
    const match = rawSql.match(regex);
    return match ? Number(match[1]) : null;
  }

  return {
    users,
    leads,
    queries,
    seedLead(lead) {
      const row = { id: crypto.randomUUID(), ...lead };
      leads.push(row);
      return row;
    },
    query: async (text, params = []) => {
      queries.push({ text, params });
      if (text.includes("INSERT INTO users")) {
        if (users.some((user) => user.email === params[1])) {
          const error = new Error("duplicate email");
          error.code = "23505";
          throw error;
        }
        const row = {
          id: crypto.randomUUID(),
          name: params[0],
          email: params[1],
          password_hash: params[2],
          created_at: "2026-10-15T00:00:00.000Z"
        };
        users.push(row);
        return { rows: [{ id: row.id, name: row.name, email: row.email, created_at: row.created_at }] };
      }

      if (text.includes("FROM users WHERE email")) {
        return { rows: users.filter((user) => user.email === params[0]) };
      }

      if (text.includes("FROM users WHERE id")) {
        return {
          rows: users
            .filter((user) => user.id === params[0])
            .map((user) => ({
              id: user.id,
              name: user.name,
              email: user.email,
              created_at: user.created_at
            }))
        };
      }

      if (text.includes("INSERT INTO leads")) {
        const row = {
          id: crypto.randomUUID(),
          name: params[0],
          business: params[1],
          phone: params[2],
          email: params[3],
          source: params[4],
          status: params[5],
          amount: params[6],
          notes: params[7],
          followup_date: params[8],
          user_id: params[9],
          created_at: "2026-10-15T00:00:00.000Z",
          updated_at: "2026-10-15T00:00:00.000Z"
        };
        leads.push(row);
        return { rows: [row] };
      }

      if (text.includes("COUNT(*)::int AS total_leads")) {
        const mine = leads.filter((lead) => lead.user_id === params[0]);
        const countStatus = (status) => mine.filter((lead) => lead.status === status).length;
        const today = new Date().toISOString().slice(0, 10);
        const open = mine.filter((lead) => !["Won", "Lost"].includes(lead.status));
        return {
          rows: [
            {
              total_leads: mine.length,
              new_leads: countStatus("New"),
              contacted_leads: countStatus("Contacted"),
              interested_leads: countStatus("Interested"),
              won_deals: countStatus("Won"),
              lost_deals: countStatus("Lost"),
              won_revenue: mine
                .filter((lead) => lead.status === "Won")
                .reduce((sum, lead) => sum + Number(lead.amount || 0), 0),
              pipeline_value: open.reduce((sum, lead) => sum + Number(lead.amount || 0), 0),
              overdue_followups: open.filter(
                (lead) => lead.followup_date && lead.followup_date < today
              ).length,
              today_followups: open.filter((lead) => lead.followup_date === today).length
            }
          ]
        };
      }

      if (text.includes("GROUP BY COALESCE(source")) {
        const mine = leads.filter((lead) => lead.user_id === params[0]);
        const counts = new Map();
        mine.forEach((lead) => {
          const key = lead.source || "Unspecified";
          counts.set(key, (counts.get(key) || 0) + 1);
        });
        const rows = [...counts.entries()]
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
        return { rows };
      }

      if (text.startsWith("UPDATE leads")) {
        const lead = findOwned(params[9], params[10]);
        if (!lead) {
          return { rows: [], rowCount: 0 };
        }
        Object.assign(lead, {
          name: params[0],
          business: params[1],
          phone: params[2],
          email: params[3],
          source: params[4],
          status: params[5],
          amount: params[6],
          notes: params[7],
          followup_date: params[8],
          updated_at: "2026-10-15T00:00:00.000Z"
        });
        return { rows: [lead], rowCount: 1 };
      }

      if (text.startsWith("DELETE FROM leads")) {
        const index = leads.findIndex(
          (lead) => lead.id === params[0] && lead.user_id === params[1]
        );
        if (index === -1) {
          return { rows: [], rowCount: 0 };
        }
        leads.splice(index, 1);
        return { rows: [], rowCount: 1 };
      }

      if (text.includes("FROM leads") && text.includes("WHERE id = $1 AND user_id = $2")) {
        const lead = findOwned(params[0], params[1]);
        return { rows: lead ? [lead] : [] };
      }

      if (text.includes("FROM leads") && text.includes("user_id = $1")) {
        const today = new Date().toISOString().slice(0, 10);
        const isOpen = (lead) => !["Won", "Lost"].includes(lead.status);
        // Only inspect the WHERE clause: the SELECT list always contains a CASE
        // expression with CURRENT_DATE comparisons, which must not be mistaken
        // for the follow-up filter the caller actually asked for.
        const whereClause = text.slice(text.indexOf("FROM leads"));
        let rows = leads.filter((lead) => lead.user_id === params[0]);

        const statusIndex = paramIndexFor(whereClause, /status\s*=\s*\$(\d+)/i);
        if (statusIndex) {
          rows = rows.filter((lead) => lead.status === params[statusIndex - 1]);
        }

        const sourceIndex = paramIndexFor(whereClause, /source\s*=\s*\$(\d+)/i);
        if (sourceIndex) {
          rows = rows.filter((lead) => lead.source === params[sourceIndex - 1]);
        }

        if (/followup_date\s*<\s*CURRENT_DATE/i.test(whereClause)) {
          rows = rows.filter(
            (lead) => lead.followup_date && lead.followup_date < today && isOpen(lead)
          );
        } else if (/followup_date\s*=\s*CURRENT_DATE/i.test(whereClause)) {
          rows = rows.filter((lead) => lead.followup_date === today && isOpen(lead));
        } else if (/followup_date\s*>\s*CURRENT_DATE/i.test(whereClause)) {
          rows = rows.filter(
            (lead) => lead.followup_date && lead.followup_date > today && isOpen(lead)
          );
        } else if (/followup_date\s+IS\s+NULL/i.test(whereClause)) {
          rows = rows.filter((lead) => !lead.followup_date);
        }

        const searchIndex = paramIndexFor(whereClause, /ILIKE\s+\$(\d+)/i);
        if (searchIndex) {
          const needle = String(params[searchIndex - 1])
            .replace(/^%/, "")
            .replace(/%$/, "")
            .replace(/\\([%_\\])/g, "$1")
            .toLowerCase();
          rows = rows.filter((lead) =>
            [lead.name, lead.business, lead.phone, lead.email, lead.notes].some((value) =>
              String(value ?? "").toLowerCase().includes(needle)
            )
          );
        }

        return { rows };
      }

      throw new Error(`Unexpected query: ${text}`);
    }
  };
}

module.exports = {
  TEST_SECRET,
  createTestApp,
  listen,
  mockPool,
  createClient,
  memoryAuthPool,
  signUp,
  signIn,
  withServer
};
