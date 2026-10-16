"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildListQuery } = require("../src/leadsQuery");

test("builds parameterized search and status filters", () => {
  const { text, params } = buildListQuery({
    search: "rahul%",
    status: "New",
    source: "All",
    followup: "all",
    sort: "created_at",
    order: "desc"
  });
  assert.ok(text.includes("ILIKE $1"));
  assert.ok(text.includes("status = $2"));
  assert.equal(params[0], "%rahul\\%%");
  assert.equal(params[1], "New");
  assert.ok(!/drop table/i.test(text));
});

test("overdue follow-up filter does not take user params", () => {
  const { text, params } = buildListQuery({
    search: "",
    status: "All",
    source: "All",
    followup: "overdue",
    sort: "followup_date",
    order: "asc"
  });
  assert.ok(text.includes("followup_date < CURRENT_DATE"));
  assert.deepEqual(params, []);
  assert.ok(text.includes("ORDER BY followup_date ASC NULLS LAST"));
});
