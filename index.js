// feedback-triage/index.js
// Aether skill entry point — called on every inbound Zendesk ticket.
//
// Input (from Aether / Zendesk webhook):
// {
//   ticket_id:   "84231",
//   subject:     "Custom sort keeps reverting on schedule",
//   description: "...",
//   company:     "Pennells"
// }
//
// Output:
// {
//   match:              true,
//   linear_id:          "LIN-4821",
//   type:               "bug-as-designed",
//   confidence:         0.91,
//   action:             "auto-tag",
//   zd_tag:             "bug-as-designed-lin-4821",
//   linear_url:         "https://linear.app/7shifts/issue/LIN-4821",
//   suggested_response: "..."
// }

const { getActiveIssues, logRun } = require("../shared/registry-client");
const { updateTicket, addInternalNote } = require("../shared/zendesk-client");
const { classifyTicket, routeByConfidence } = require("./classifier");
const { buildInternalNote } = require("./note-builder");

const LINEAR_FIELD_ID = process.env.ZD_LINEAR_FIELD_ID;

async function run(input) {
  const { ticket_id, subject, description, company } = input;

  // 1. Load active issues from registry
  const activeIssues = await getActiveIssues();

  if (!activeIssues.length) {
    return { match: false, reason: "No active issues in registry" };
  }

  // 2. Keyword pre-filter + confidence scoring
  const { match, issue, confidence } = classifyTicket(
    { subject, description },
    activeIssues
  );

  if (!match) {
    await logRun({
      trigger: "zendesk_webhook",
      linear_id: null,
      tickets_found: 1,
      tickets_tagged: 0,
      confidence,
    });
    return { match: false, confidence };
  }

  const action = routeByConfidence(confidence);

  // 3. Build tags
  const tags = [issue.zd_tag];
  if (action === "needs-review") tags.push("needs-review");
  if (issue.type === "bug-as-designed") tags.push("bug-as-designed");

  // 4. Write to Zendesk
  await updateTicket(ticket_id, tags, issue.linear_url, LINEAR_FIELD_ID);

  if (action === "auto-tag") {
    const note = buildInternalNote(issue, confidence);
    await addInternalNote(ticket_id, note);
  }

  // 5. Log run
  await logRun({
    trigger: "zendesk_webhook",
    linear_id: issue.linear_id,
    tickets_found: 1,
    tickets_tagged: 1,
    confidence,
  });

  return {
    match: true,
    linear_id: issue.linear_id,
    type: issue.type,
    confidence,
    action,
    zd_tag: issue.zd_tag,
    linear_url: issue.linear_url,
  };
}

module.exports = { run };
