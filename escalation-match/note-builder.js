// escalation-match/note-builder.js
// Builds the internal note added to Zendesk tickets matched to open SXP escalations.

/**
 * @param {object} issue   — Linear issue object
 * @param {number} confidence
 * @returns {string}
 */
function buildEscalationNote(issue, confidence) {
  const pct = Math.round(confidence * 100);
  const labels = issue.labels?.nodes?.map(l => l.name).filter(l => l !== "SXP Escalation").join(", ") || "—";

  return [
    `🤖 Aether — Known SXP Escalation Match`,
    ``,
    `This ticket appears to be related to an open escalation already filed with engineering.`,
    ``,
    `Linear Issue: ${issue.identifier} · ${issue.title}`,
    `Link:         ${issue.url}`,
    `Status:       ${issue.state?.name}`,
    `Priority:     ${issue.priority?.name ?? "None"}`,
    `Area:         ${labels}`,
    ``,
    `Do NOT re-escalate. Check the Linear issue for status and any available workaround.`,
    `If this is a new account affected by the same bug, add a comment to the Linear issue`,
    `with the company name, ID, and Zendesk ticket number.`,
    ``,
    `Tag applied: sxp-esc-${issue.identifier.toLowerCase().replace("-", "")}`,
    `Confidence:  ${pct}%`,
  ].join("\n");
}

module.exports = { buildEscalationNote };
