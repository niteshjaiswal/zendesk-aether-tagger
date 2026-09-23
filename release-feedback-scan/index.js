// release-feedback-scan/note-builder.js
// Builds the internal note added to Zendesk tickets matched by the bulk scan.

/**
 * @param {object} issue  — { title, type, linear_url, zd_tag }
 * @param {number} confidence — 1.0 for bulk scan (keyword match confirmed)
 * @returns {string}
 */
function buildInternalNote(issue, confidence) {
  const typeLabel = issue.type === "bug-as-designed"
    ? "Bug-as-Designed"
    : "Release Feedback";

  return [
    `🤖 Aether — ${typeLabel} Match (Bulk Scan)`,
    ``,
    `Linear Issue: ${issue.title}`,
    `Link:         ${issue.linear_url}`,
    ``,
    issue.type === "bug-as-designed"
      ? `This behaviour is known and intentional. See Linear issue for full context and suggested response.`
      : `This ticket has been linked to a recent release. See the Feedback Summary issue in Linear for context.`,
    ``,
    `Tag applied: ${issue.zd_tag}`,
  ].join("\n");
}

module.exports = { buildInternalNote };
