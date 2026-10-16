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

  function request(port, { method = "GET", path, body, headers = {}, csrf } = {}) {
    return new Promise((resolve, reject) => {
      const allHeaders = { ...headers };
      if (body !== undefined) allHeaders["Content-Type"] = "application/json";
      if (csrf) allHeaders["x-csrf-token"] = csrf;
      if (cookies) allHeaders.Cookie = cookies;

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: allHeaders
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => {
            data += chunk;
          });
          res.on("end", () => {
            const raw = res.headers["set-cookie"];
            if (raw) {
              cookies = (Array.isArray(raw) ? raw : [raw]).map((item) => item.split(";")[0]).join("; ");
            }
            let json = null;
            try {
              json = JSON.parse(data);
            } catch {
              json = data;
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
    return res.json.token;
  }

  return { request, csrf };
}

function memoryAuthPool() {
  const crypto = require("node:crypto");
  const users = [];
  const leads = [];

  return {
    users,
    leads,
    query: async (text, params = []) => {
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
          user_id: params[9],
          created_at: "2026-10-15T00:00:00.000Z",
          updated_at: "2026-10-15T00:00:00.000Z"
        };
        leads.push(row);
        return { rows: [row] };
      }

      if (text.includes("COUNT(*)::int AS total_leads")) {
        const mine = leads.filter((lead) => lead.user_id === params[0]);
        return {
          rows: [
            {
              total_leads: mine.length,
              new_leads: mine.filter((lead) => lead.status === "New").length,
              contacted_leads: 0,
              interested_leads: 0,
              won_deals: 0,
              lost_deals: 0,
              won_revenue: 0,
              pipeline_value: mine.reduce((sum, lead) => sum + Number(lead.amount || 0), 0),
              overdue_followups: 0,
              today_followups: 0
            }
          ]
        };
      }

      if (text.includes("GROUP BY COALESCE(source")) {
        return { rows: [] };
      }

      if (text.includes("FROM leads") && text.includes("WHERE id = $1 AND user_id = $2")) {
        return {
          rows: leads.filter((lead) => lead.id === params[0] && lead.user_id === params[1])
        };
      }

      if (text.includes("FROM leads") && text.includes("user_id = $1")) {
        return { rows: leads.filter((lead) => lead.user_id === params[0]) };
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
  memoryAuthPool
};
