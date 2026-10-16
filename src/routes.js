"use strict";

const express = require("express");
const { publicDbError } = require("./db");
const { buildListQuery } = require("./leadsQuery");
const {
  validateId,
  validateLeadPayload,
  parseListQuery
} = require("./validate");

function mapLead(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    business: row.business,
    phone: row.phone,
    email: row.email,
    source: row.source,
    status: row.status,
    amount: Number(row.amount) || 0,
    notes: row.notes,
    followup_date: row.followup_date ? String(row.followup_date).slice(0, 10) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    followup_state: row.followup_state || null
  };
}

function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ success: false, error: "Please sign in." });
  }
  return next();
}

function createRoutes(pool) {
  const router = express.Router();

  router.get("/health", (_req, res) => {
    res.json({
      success: true,
      app: "LeadPilot",
      message: "Backend is running!",
      auth: true,
      mode: "session"
    });
  });

  router.get("/stats", requireAuth, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `
        SELECT
          COUNT(*)::int AS total_leads,
          COUNT(*) FILTER (WHERE status = 'New')::int AS new_leads,
          COUNT(*) FILTER (WHERE status = 'Contacted')::int AS contacted_leads,
          COUNT(*) FILTER (WHERE status = 'Interested')::int AS interested_leads,
          COUNT(*) FILTER (WHERE status = 'Won')::int AS won_deals,
          COUNT(*) FILTER (WHERE status = 'Lost')::int AS lost_deals,
          COALESCE(SUM(amount) FILTER (WHERE status = 'Won'), 0)::float8 AS won_revenue,
          COALESCE(SUM(amount) FILTER (WHERE status NOT IN ('Won', 'Lost')), 0)::float8 AS pipeline_value,
          COUNT(*) FILTER (
            WHERE followup_date IS NOT NULL
              AND followup_date < CURRENT_DATE
              AND status NOT IN ('Won', 'Lost')
          )::int AS overdue_followups,
          COUNT(*) FILTER (
            WHERE followup_date = CURRENT_DATE
              AND status NOT IN ('Won', 'Lost')
          )::int AS today_followups
        FROM leads
        WHERE user_id = $1
      `,
        [req.session.userId]
      );

      const sources = await pool.query(
        `
        SELECT COALESCE(source, 'Unspecified') AS source, COUNT(*)::int AS count
        FROM leads
        WHERE user_id = $1
        GROUP BY COALESCE(source, 'Unspecified')
        ORDER BY count DESC, source ASC
      `,
        [req.session.userId]
      );

      const stats = rows[0];
      res.json({
        success: true,
        stats: {
          total_leads: stats.total_leads,
          new_leads: stats.new_leads,
          contacted_leads: stats.contacted_leads,
          interested_leads: stats.interested_leads,
          won_deals: stats.won_deals,
          lost_deals: stats.lost_deals,
          won_revenue: stats.won_revenue,
          pipeline_value: stats.pipeline_value,
          overdue_followups: stats.overdue_followups,
          today_followups: stats.today_followups,
          by_status: {
            New: stats.new_leads,
            Contacted: stats.contacted_leads,
            Interested: stats.interested_leads,
            Won: stats.won_deals,
            Lost: stats.lost_deals
          },
          by_source: sources.rows
        }
      });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.get("/leads", requireAuth, async (req, res) => {
    const parsed = parseListQuery(req.query);
    if (parsed.errors.length) {
      return res.status(400).json({ success: false, errors: parsed.errors });
    }

    try {
      const { text, params } = buildListQuery(parsed.filters, req.session.userId);
      const { rows } = await pool.query(text, params);
      res.json({ success: true, leads: rows.map(mapLead) });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.get("/leads/:id", requireAuth, async (req, res) => {
    const invalid = validateId(req.params.id);
    if (invalid) {
      return res.status(400).json({ success: false, error: invalid });
    }

    try {
      const { rows } = await pool.query(
        `SELECT
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
         WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.session.userId]
      );

      if (!rows[0]) {
        return res.status(404).json({ success: false, error: "Lead not found." });
      }

      res.json({ success: true, lead: mapLead(rows[0]) });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.post("/leads", requireAuth, async (req, res) => {
    const { errors, data } = validateLeadPayload(req.body || {});
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    if (!data.status) data.status = "New";
    if (data.amount === undefined) data.amount = 0;

    try {
      const { rows } = await pool.query(
        `INSERT INTO leads (name, business, phone, email, source, status, amount, notes, followup_date, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING
           id, name, business, phone, email, source, status,
           amount::float8 AS amount, notes, followup_date::text AS followup_date, created_at, updated_at`,
        [
          data.name,
          data.business,
          data.phone || null,
          data.email || null,
          data.source || null,
          data.status,
          data.amount,
          data.notes || null,
          data.followup_date || null,
          req.session.userId
        ]
      );

      res.status(201).json({ success: true, lead: mapLead(rows[0]) });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.put("/leads/:id", requireAuth, async (req, res) => {
    const invalid = validateId(req.params.id);
    if (invalid) {
      return res.status(400).json({ success: false, error: invalid });
    }

    const { errors, data } = validateLeadPayload(req.body || {});
    if (errors.length) {
      return res.status(400).json({ success: false, errors });
    }

    try {
      const { rows } = await pool.query(
        `UPDATE leads
         SET name = $1,
             business = $2,
             phone = $3,
             email = $4,
             source = $5,
             status = $6,
             amount = $7,
             notes = $8,
             followup_date = $9,
             updated_at = NOW()
         WHERE id = $10 AND user_id = $11
         RETURNING
           id, name, business, phone, email, source, status,
           amount::float8 AS amount, notes, followup_date::text AS followup_date, created_at, updated_at`,
        [
          data.name,
          data.business,
          data.phone || null,
          data.email || null,
          data.source || null,
          data.status,
          data.amount,
          data.notes || null,
          data.followup_date || null,
          req.params.id,
          req.session.userId
        ]
      );

      if (!rows[0]) {
        return res.status(404).json({ success: false, error: "Lead not found." });
      }

      res.json({ success: true, lead: mapLead(rows[0]) });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  router.delete("/leads/:id", requireAuth, async (req, res) => {
    const invalid = validateId(req.params.id);
    if (invalid) {
      return res.status(400).json({ success: false, error: invalid });
    }

    try {
      const { rowCount } = await pool.query(
        "DELETE FROM leads WHERE id = $1 AND user_id = $2",
        [req.params.id, req.session.userId]
      );
      if (!rowCount) {
        return res.status(404).json({ success: false, error: "Lead not found." });
      }
      res.json({ success: true });
    } catch (error) {
      const mapped = publicDbError(error);
      res.status(mapped.status).json({ success: false, error: mapped.message });
    }
  });

  return router;
}

module.exports = { createRoutes, mapLead, requireAuth };
