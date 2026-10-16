"use strict";

const STATUSES = ["New", "Contacted", "Interested", "Won", "Lost"];
const SOURCES = [
  "Website",
  "Referral",
  "LinkedIn",
  "Instagram",
  "Cold Call",
  "Email",
  "Other"
];
const SORT_FIELDS = {
  created_at: "created_at",
  followup_date: "followup_date",
  amount: "amount",
  name: "name",
  status: "status",
  business: "business"
};
const FOLLOWUP_FILTERS = ["overdue", "today", "upcoming", "none", "all"];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function trimOrNull(value, max) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

function parseDateOnly(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!DATE_RE.test(text)) return undefined;
  const date = new Date(`${text}T00:00:00`);
  if (Number.isNaN(date.getTime())) return undefined;
  const [year, month, day] = text.split("-").map(Number);
  if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
    return undefined;
  }
  return text;
}

function parseAmount(value) {
  if (value === undefined || value === null || value === "") return 0;
  const amount = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000000) return undefined;
  return Math.round(amount * 100) / 100;
}

function validateId(id) {
  if (!id || !UUID_RE.test(String(id))) {
    return "Invalid lead id.";
  }
  return null;
}

function validateLeadPayload(body, { partial = false } = {}) {
  const errors = [];
  const data = {};

  if (!partial || body.name !== undefined) {
    if (!isNonEmptyString(body.name)) {
      errors.push("Name is required.");
    } else if (body.name.trim().length > 80) {
      errors.push("Name must be 80 characters or fewer.");
    } else {
      data.name = body.name.trim();
    }
  }

  if (!partial || body.business !== undefined) {
    if (!isNonEmptyString(body.business)) {
      errors.push("Business / company is required.");
    } else if (body.business.trim().length > 100) {
      errors.push("Business / company must be 100 characters or fewer.");
    } else {
      data.business = body.business.trim();
    }
  }

  if (!partial || body.phone !== undefined) {
    const phone = trimOrNull(body.phone, 20);
    if (phone && !/^[0-9+\-() \s]{7,20}$/.test(phone)) {
      errors.push("Enter a valid phone number (7–20 digits, spaces, +, -, or parentheses).");
    } else {
      data.phone = phone;
    }
  }

  if (!partial || body.email !== undefined) {
    const email = trimOrNull(body.email, 254);
    if (email && !EMAIL_RE.test(email)) {
      errors.push("Enter a valid email address.");
    } else {
      data.email = email ? email.toLowerCase() : null;
    }
  }

  if (!partial || body.source !== undefined) {
    const source = trimOrNull(body.source, 50);
    if (source && !SOURCES.includes(source)) {
      errors.push(`Source must be one of: ${SOURCES.join(", ")}.`);
    } else {
      data.source = source;
    }
  }

  if (!partial || body.status !== undefined) {
    const status = isNonEmptyString(body.status) ? body.status.trim() : "New";
    if (!STATUSES.includes(status)) {
      errors.push(`Status must be one of: ${STATUSES.join(", ")}.`);
    } else {
      data.status = status;
    }
  }

  if (!partial || body.amount !== undefined) {
    const amount = parseAmount(body.amount);
    if (amount === undefined) {
      errors.push("Estimated deal amount must be a number between 0 and 10,00,00,000.");
    } else {
      data.amount = amount;
    }
  }

  if (!partial || body.notes !== undefined) {
    const notes = trimOrNull(body.notes, 4000);
    if (body.notes && String(body.notes).length > 4000) {
      errors.push("Notes must be 4000 characters or fewer.");
    } else {
      data.notes = notes;
    }
  }

  if (!partial || body.followup_date !== undefined) {
    const followup = parseDateOnly(body.followup_date ?? body.followup);
    if (followup === undefined) {
      errors.push("Follow-up date must be a valid date in YYYY-MM-DD format.");
    } else {
      data.followup_date = followup;
    }
  }

  return { errors, data };
}

function escapeLike(value) {
  return String(value).replace(/[%_\\]/g, (char) => `\\${char}`);
}

function parseListQuery(query) {
  const errors = [];
  const filters = {
    search: "",
    status: "All",
    source: "All",
    followup: "all",
    sort: "created_at",
    order: "desc"
  };

  if (query.search) {
    filters.search = String(query.search).trim().slice(0, 120);
  }

  if (query.status && query.status !== "All") {
    if (!STATUSES.includes(query.status)) {
      errors.push(`Status filter must be All or one of: ${STATUSES.join(", ")}.`);
    } else {
      filters.status = query.status;
    }
  }

  if (query.source && query.source !== "All") {
    if (!SOURCES.includes(query.source)) {
      errors.push(`Source filter must be All or one of: ${SOURCES.join(", ")}.`);
    } else {
      filters.source = query.source;
    }
  }

  if (query.followup) {
    const followup = String(query.followup).toLowerCase();
    if (!FOLLOWUP_FILTERS.includes(followup)) {
      errors.push("Follow-up filter must be overdue, today, upcoming, none, or all.");
    } else {
      filters.followup = followup;
    }
  }

  if (query.sort) {
    const sort = SORT_FIELDS[String(query.sort)];
    if (!sort) {
      errors.push(`Sort must be one of: ${Object.keys(SORT_FIELDS).join(", ")}.`);
    } else {
      filters.sort = sort;
    }
  }

  if (query.order) {
    const order = String(query.order).toLowerCase();
    if (order !== "asc" && order !== "desc") {
      errors.push("Order must be asc or desc.");
    } else {
      filters.order = order;
    }
  }

  return { errors, filters };
}

module.exports = {
  STATUSES,
  SOURCES,
  SORT_FIELDS,
  validateId,
  validateLeadPayload,
  parseListQuery,
  escapeLike
};
