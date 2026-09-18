// shared/registry-client.js
// Reads and writes the release_feedback_registry and release_feedback_runs tables.
// Imported by both feedback-triage and release-feedback-scan skills.

const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DB_CONNECTION_STRING });

// ─── Registry reads ───────────────────────────────────────────────────────────

/**
 * Returns all active issues for the current env (sandbox or production).
 * Called by feedback-triage on every inbound ticket.
 */
async function getActiveIssues() {
  const env = process.env.ZENDESK_ENV ?? "sandbox";
  const { rows } = await pool.query(
    `SELECT * FROM release_feedback_registry
     WHERE status = 'active'
     AND expires_at > NOW()
     AND env = $1`,
    [env]
  );
  return rows;
}

// ─── Registry writes ──────────────────────────────────────────────────────────

/**
 * Insert a new release or bug-as-designed entry into the registry.
 * expires_at is auto-calculated based on type and p_level.
 * @param {object} entry
 */
async function addRegistryEntry(entry) {
  const {
    linear_id, title, type, keywords, zd_tag,
    linear_url, p_level,
  } = entry;

  const env = process.env.ZENDESK_ENV ?? "sandbox";
  const expires_at = calculateExpiry(type, p_level);

  await pool.query(
    `INSERT INTO release_feedback_registry
       (linear_id, title, type, keywords, zd_tag, linear_url, p_level, expires_at, env)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [linear_id, title, type, keywords, zd_tag, linear_url, p_level, expires_at, env]
  );
}

/**
 * Mark a registry entry as closed (called by Workflow 2 when Linear issue resolves).
 * @param {string} linear_id
 */
async function closeRegistryEntry(linear_id) {
  await pool.query(
    `UPDATE release_feedback_registry
     SET status = 'closed', closed_at = NOW()
     WHERE linear_id = $1`,
    [linear_id]
  );
}

// ─── Audit writes ─────────────────────────────────────────────────────────────

/**
 * Write a run record to the audit table.
 * @param {object} run
 */
async function logRun(run) {
  const {
    trigger, linear_id, tickets_found, tickets_tagged,
    model_used, confidence, error,
  } = run;

  await pool.query(
    `INSERT INTO release_feedback_runs
       (trigger, linear_id, tickets_found, tickets_tagged, model_used, confidence, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [trigger, linear_id, tickets_found, tickets_tagged, model_used, confidence, error ?? null]
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calculateExpiry(type, p_level) {
  const now = new Date();
  if (type === "bug-as-designed") {
    now.setDate(now.getDate() + 90); // 90-day safety cap
    return now;
  }
  const forwardDays = { p1: 60, p2: 30, p3: 14, p4: 7 };
  const days = forwardDays[(p_level ?? "p3").toLowerCase()] ?? 14;
  now.setDate(now.getDate() + days);
  return now;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getActiveIssues,
  addRegistryEntry,
  closeRegistryEntry,
  logRun,
};
