"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildListQuery } = require("../src/leadsQuery");

const USER_ID = "11111111-1111-4111-8111-111111111111";
const BASE_FILTERS = {
  search: "",
  status: "All",
  source: "All",
  followup: "all",
  sort: "created_at",
  order: "desc"
};

test("scopes every list query to the authenticated user", () => {
  const { text, params } = buildListQuery(BASE_FILTERS, USER_ID);
  assert.ok(text.includes("WHERE user_id = $1"));
  assert.deepEqual(params, [USER_ID]);
});

test("builds parameterized search and status filters after the owner param", () => {
  const { text, params } = buildListQuery(
    { ...BASE_FILTERS, search: "rahul%", status: "New" },
    USER_ID
  );
  assert.equal(params[0], USER_ID);
  assert.ok(text.includes("ILIKE $2"));
  assert.ok(text.includes("status = $3"));
  assert.equal(params[1], "%rahul\\%%");
  assert.equal(params[2], "New");
  assert.ok(!/drop table/i.test(text));
  assert.ok(!/truncate/i.test(text));
});

test("overdue follow-up filter keeps the owner as the only parameter", () => {
  const { text, params } = buildListQuery(
    { ...BASE_FILTERS, followup: "overdue", sort: "followup_date", order: "asc" },
    USER_ID
  );
  assert.ok(text.includes("followup_date < CURRENT_DATE"));
  assert.deepEqual(params, [USER_ID]);
  assert.ok(text.includes("ORDER BY followup_date ASC NULLS LAST"));
});

test("source filter is parameterized after the owner", () => {
  const { text, params } = buildListQuery({ ...BASE_FILTERS, source: "Referral" }, USER_ID);
  assert.ok(text.includes("source = $2"));
  assert.deepEqual(params, [USER_ID, "Referral"]);
});

test("refuses to build a query without an authenticated user id", () => {
  assert.throws(() => buildListQuery(BASE_FILTERS, undefined), /authenticated userId/);
  assert.throws(() => buildListQuery(BASE_FILTERS, null), /authenticated userId/);
  assert.throws(() => buildListQuery(BASE_FILTERS, ""), /authenticated userId/);
  assert.throws(() => buildListQuery(BASE_FILTERS, "not-a-uuid"), /authenticated userId/);
});
