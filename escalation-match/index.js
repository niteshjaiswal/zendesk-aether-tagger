// escalation-match/index.js
// Aether skill entry point — triggered by the same Zendesk webhook as feedback-triage.
// Runs in parallel with feedback-triage to check if a new ticket matches an open
// SXP escalation (a known bug already filed with engineering).
//
// Flow:
//   1. Receive new Zendesk ticket (subject, description, company_id)
//   2. Fetch all open (non-Done) Linear issues with label "SXP Escalation"
//   3. Score ticket against each escalation
//   4. If confidence ≥ 0.70: tag ticket + add internal note
//   5. Log run

const { addTags, setLinearField, addInternalNote } = require("../shared/zendesk-client");
const { matchEscalation } = require("./matcher");
const { buildEscalationNote } = require("./note-builder");

const LINEAR_FIELD_ID = process.env.ZD_LINEAR_FIELD_ID;

/**
 * Confidence routing:
 *   ≥ 0.70 → auto-tag + internal note (known escalation)
 *   < 0.70 → no action (let agent handle normally)
 *
 * Tag format: sxp-esc-[linear-identifier-lowercase-no-dash]
 * e.g. API-4842 → sxp-esc-api4842
 */

/**
 * Main entry point called by Aether.
 * @param {object} input
 * @param {string|number} input.ticket_id      — Zendesk ticket ID
 * @param {string}        input.subject        — ticket subject
 * @param {string}        input.description    — ticket description
 * @param {string}        [input.company_id]   — company/org ID from Zendesk
 * @param {string}        [input.company_name] — company name for logging
 */
async function run(input) {
  const { ticket_id, subject, description, company_id, company_name } = input;

  // 1. Match against open SXP escalations
  // Graceful fallback if Linear API is down — log and exit cleanly, no crash
  let match, confidence, allMatches;
  try {
    ({ match, confidence, allMatches } = await matchEscalation({
      subject,
      description,
      company_id,
    }));
  } catch (err) {
    console.error(`[escalation-match] Linear API unavailable: ${err.message}`);
    return {
      action: "no-action",
      reason: `Linear API error — ${err.message}`,
      tickets_tagged: 0,
    };
  }

  if (!match) {
    return {
      action: "no-action",
      reason: `Best confidence ${Math.round((allMatches[0]?.confidence ?? 0) * 100)}% — below 70% threshold`,
      tickets_tagged: 0,
    };
  }

  // 2. Build tag
  const zdTag = `sxp-esc-${match.identifier.toLowerCase().replace("-", "")}`;

  // 3. Tag ticket + set Linear field + add internal note
  // addTags uses PUT /api/v2/tickets/{id}/tags — strictly additive, no race condition
  // with feedback-triage which may write to the same ticket concurrently.
  await addTags(ticket_id, [zdTag, "sxp-escalation"]);
  await setLinearField(ticket_id, match.url, LINEAR_FIELD_ID);
  await addInternalNote(ticket_id, buildEscalationNote(match, confidence));

  return {
    action: "tagged",
    linear_id: match.identifier,
    linear_url: match.url,
    zd_tag: zdTag,
    confidence,
    all_matches: allMatches.map(m => ({
      id: m.issue.identifier,
      title: m.issue.title,
      confidence: m.confidence,
    })),
  };
}

module.exports = { run };
