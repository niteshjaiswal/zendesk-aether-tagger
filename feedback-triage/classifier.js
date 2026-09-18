// feedback-triage/classifier.js
// Keyword matching + confidence scoring against active registry issues.

/**
 * Score a ticket against all active issues and return the best match.
 * @param {object} ticket  — { subject, description }
 * @param {object[]} activeIssues — rows from release_feedback_registry
 * @returns {{ match: boolean, issue: object|null, confidence: number }}
 */
function classifyTicket(ticket, activeIssues) {
  const text = normalize(`${ticket.subject} ${ticket.description}`);

  let bestMatch = null;
  let bestScore = 0;

  for (const issue of activeIssues) {
    const score = scoreAgainstIssue(text, issue.keywords ?? []);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = issue;
    }
  }

  return {
    match: bestScore >= 0.60,
    issue: bestScore >= 0.60 ? bestMatch : null,
    confidence: parseFloat(bestScore.toFixed(3)),
  };
}

/**
 * Score ticket text against a keyword list.
 * Simple term-frequency approach — replace with embeddings later if needed.
 * @param {string} text       — normalized ticket text
 * @param {string[]} keywords — keywords from registry entry
 * @returns {number} score 0–1
 */
function scoreAgainstIssue(text, keywords) {
  if (!keywords.length) return 0;

  let hits = 0;
  for (const kw of keywords) {
    if (text.includes(normalize(kw))) hits++;
  }

  // Weighted: more hits = higher confidence, diminishing returns
  const raw = hits / keywords.length;

  // Boost if multiple keywords hit (signal strength)
  const boost = hits >= 2 ? 0.10 : 0;

  return Math.min(raw + boost, 1.0);
}

/**
 * Route based on confidence threshold.
 * @param {number} confidence
 * @returns {"auto-tag" | "needs-review" | "no-action"}
 */
function routeByConfidence(confidence) {
  if (confidence >= 0.80) return "auto-tag";
  if (confidence >= 0.60) return "needs-review";
  return "no-action";
}

function normalize(str) {
  return (str ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim();
}

module.exports = { classifyTicket, routeByConfidence };
