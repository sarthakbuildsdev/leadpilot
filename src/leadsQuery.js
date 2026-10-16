"use strict";

const { escapeLike } = require("./validate");

function buildListQuery(filters, userId) {
  const where = ["user_id = $1"];
  const params = [userId];
  let index = 2;

  if (filters.search) {
    where.push(
      `(name ILIKE $${index} ESCAPE '\\' OR business ILIKE $${index} ESCAPE '\\' OR COALESCE(phone, '') ILIKE $${index} ESCAPE '\\' OR COALESCE(email, '') ILIKE $${index} ESCAPE '\\' OR COALESCE(notes, '') ILIKE $${index} ESCAPE '\\')`
    );
    params.push(`%${escapeLike(filters.search)}%`);
    index += 1;
  }

  if (filters.status && filters.status !== "All") {
    where.push(`status = $${index}`);
    params.push(filters.status);
    index += 1;
  }

  if (filters.source && filters.source !== "All") {
    where.push(`source = $${index}`);
    params.push(filters.source);
    index += 1;
  }

  if (filters.followup === "overdue") {
    where.push(`followup_date IS NOT NULL AND followup_date < CURRENT_DATE AND status NOT IN ('Won', 'Lost')`);
  } else if (filters.followup === "today") {
    where.push(`followup_date = CURRENT_DATE AND status NOT IN ('Won', 'Lost')`);
  } else if (filters.followup === "upcoming") {
    where.push(`followup_date IS NOT NULL AND followup_date > CURRENT_DATE AND status NOT IN ('Won', 'Lost')`);
  } else if (filters.followup === "none") {
    where.push(`followup_date IS NULL`);
  }

  const whereSql = `WHERE ${where.join(" AND ")}`;
  const sortColumn = filters.sort || "created_at";
  const order = filters.order === "asc" ? "ASC" : "DESC";
  const nulls = sortColumn === "followup_date" ? " NULLS LAST" : "";

  const text = `
    SELECT
      id, name, business, phone, email, source, status,
      amount::float8 AS amount, notes, followup_date::text AS followup_date, created_at, updated_at,
      CASE
        WHEN followup_date IS NULL THEN NULL
        WHEN status IN ('Won', 'Lost') THEN 'closed'
        WHEN followup_date < CURRENT_DATE THEN 'overdue'
        WHEN followup_date = CURRENT_DATE THEN 'today'
        ELSE 'upcoming'
      END AS followup_state
    FROM leads
    ${whereSql}
    ORDER BY ${sortColumn} ${order}${nulls}, created_at DESC
  `;

  return { text, params };
}

module.exports = { buildListQuery };
