"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateLeadPayload,
  validateId,
  parseListQuery,
  escapeLike
} = require("../src/validate");

test("rejects empty name and business", () => {
  const result = validateLeadPayload({});
  assert.ok(result.errors.includes("Name is required."));
  assert.ok(result.errors.includes("Business / company is required."));
});

test("accepts a valid lead payload", () => {
  const result = validateLeadPayload({
    name: "Rahul Sharma",
    business: "Rahul Events",
    phone: "9876543210",
    email: "Rahul@Events.com",
    source: "Referral",
    status: "Interested",
    amount: 25000,
    notes: "Call after Diwali",
    followup_date: "2026-10-20"
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.data.email, "rahul@events.com");
  assert.equal(result.data.amount, 25000);
  assert.equal(result.data.followup_date, "2026-10-20");
});

test("rejects invalid status, email, and amount", () => {
  const result = validateLeadPayload({
    name: "A",
    business: "B",
    email: "not-an-email",
    status: "Maybe",
    amount: -5
  });
  assert.ok(result.errors.some((error) => error.includes("email")));
  assert.ok(result.errors.some((error) => error.includes("Status")));
  assert.ok(result.errors.some((error) => error.includes("amount")));
});

test("validateId accepts UUID and rejects junk", () => {
  assert.equal(validateId("3f1c2d8a-7b4e-4a91-9c2d-8e7f6a5b4c3d"), null);
  assert.equal(validateId("nope"), "Invalid lead id.");
});

test("parseListQuery validates filters", () => {
  const ok = parseListQuery({ status: "Won", source: "Website", followup: "overdue", sort: "amount", order: "asc" });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.filters.status, "Won");
  const bad = parseListQuery({ status: "Hot", sort: "secret" });
  assert.ok(bad.errors.length >= 2);
});

test("escapeLike escapes wildcards", () => {
  assert.equal(escapeLike("100%_off"), "100\\%\\_off");
});
