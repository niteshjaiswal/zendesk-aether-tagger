// escalation-match/matcher.js
// Fetches open SXP escalation issues from Linear and scores them
// against an incoming Zendesk ticket.
//
// CACHING: The SXP escalation list is cached in module-level memory for
// CACHE_TTL_MS (15 minutes). This means a single Linear API call serves
// all tickets that arrive within the same 15-minute window — no rate limit
// risk regardless of ticket volume.
//
// NOTE FOR BRADY: This cache works if Aether keeps the skill module in memory
// between invocations (warm container). If each run is a cold isolated process,
// the cache won't persist and we'll need a lightweight DB table with a fetched_at
// timestamp instead. Please confirm container lifecycle.

const LINEAR_API = "https://api.linear.app/graphql";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

// Module-level cache — persists across invocations in a warm container
let _cache = {
  escalations: null,
  fetchedAt: null,
};

function isCacheValid() {
  return (
    _cache.escalations !== null &&
    _cache.fetchedAt !== null &&
    Date.now() - _cache.fetchedAt < CACHE_TTL_MS
  );
}

/**
 * Fetch all open (non-Done) SXP Escalation issues from Linear.
 * Returns cached result if fetched within the last 15 minutes.
 * @returns {Promise<object[]>}
 */
async function getOpenEscalations() {
  if (isCacheValid()) {
    return _cache.escalations;
  }
  const query = `
    query OpenEscalations($filter: IssueFilter!) {
      issues(filter: $filter, first: 250) {
        nodes {
          id
          identifier
          title
          description
          url
          priority { value name }
          state { name type }
          labels { nodes { name } }
          team { name }
        }
      }
    }
  `;
  const filter = {
    and: [
      { labels: {
