// feedback-triage/note-builder.js
// Builds the internal note body added to matched Zendesk tickets.

/**
 * Build the internal note text for a matched ticket.
 * @param {object} issue       — registry entry (linear_id, title, type, linear_url)
 * @param {number} confidence  — classifier confidence score
 * @param {string} [suggestedResponse] — optional AI-generated response from Aether
 * @returns {string} plain text note body
 */
function buildInternalNote(issue, confidence, suggestedResponse) {
  const typeLabel = issue.type === "bug-as-designed"
    ? "Bug-as-Designed"
    : "Release Feedback";

  const confidenceLabel = confidence >= 0.80 ? "High" : "Medium (needs review)";

  const lines = [
    `🤖 Aether — ${typeLabel} Match`,
    ``,
    `Linear Issue: ${issue.title}`,
    `Link:         ${issue.linear_url}`,
    `Confidence:   ${(confidence * 100).toFixed(0)}% (${confidenceLabel})`,
    ``,
  ];

  if (suggestedResponse) {
    lines.push(`Suggested response:`);
    lines.push(suggestedResponse);
    lines.push(``);
  }

  if (issue.type === "bug-as-designed") {
    lines.push(`This behaviour is known and intentional. See Linear issue for full context.`);
  } else {
    lines.push(`This ticket has been linked to a recent release. See Linear for the feedback summary.`);
  }

  lines.push(``);
  lines.push(`Tag applied: ${issue.zd_tag}`);

  return lines.join("\n");
}

module.exports = { buildInternalNote };
