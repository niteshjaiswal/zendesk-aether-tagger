// shared/zendesk-client.js
// All Zendesk REST API calls — imported by all three skills.
// When Zendesk MCP lands, only this file changes. All business logic is untouched.
//
// AUTH: Zendesk OAuth Bearer token (ZD_OAUTH_TOKEN env var).
// OAuth tokens may expire — Brady to confirm how Aether handles token refresh.
// If token expiry is not managed by Aether, fall back to API token auth:
//   Authorization: Basic base64(email/token:ZD_API_TOKEN)

const BASE_URL = process.env.ZENDESK_ENV === "production"
  ? "https://7shifts.zendesk.com/api/v2"
  : "https://7shifts-sandbox.zendesk.com/api/v2";

const HEADERS = {
  "Authorization": `Bearer ${process.env.ZD_OAUTH_TOKEN}`,
  "Content-Type": "application/json",
};

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function zdFetch(path, options = {}) {
  const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, { headers: HEADERS, ...options });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Zendesk API error ${res.status} on ${url}: ${body}`);
  }

  return res.json();
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/**
 * Fetch a single ticket by ID.
 * @param {string|number} ticketId
 * @returns {Promise<object>} ticket object
 */
async function getTicket(ticketId) {
  const data = await zdFetch(`/tickets/${ticketId}.json`);
  return data.ticket;
}

/**
 * Fetch all comments on a ticket (for classification context).
 * @param {string|number} ticketId
 * @returns {Promise<object[]>} array of comment objects
 */
async function getTicketComments(ticketId) {
  const data = await zdFetch(`/tickets/${ticketId}/comments.json`);
  return data.comments;
}

/**
 * Paginated ticket search using cursor-based pagination.
 * Safe for large result sets (offset pagination breaks at scale).
 * @param {string} query  — Zendesk search query string
 * @param {number} lookbackDays — used to build date filter
 * @returns {Promise<object[]>} all matching ticket objects
 */
async function searchTickets(query, lookbackDays) {
  const since = new Date();
  since.setDate(since.getDate() - lookbackDays);
  const dateFilter = `created>${since.toISOString().split("T")[0]}`;
  const fullQuery = `type:ticket ${query} ${dateFilter}`;

  let url = `/search.json?query=${encodeURIComponent(fullQuery)}&page[size]=100`;
  let allResults = [];
  let attempt = 0;

  while (url) {
    const res = await zdFetch(url);
    allResults = allResults.concat(res.results ?? []);
    url = res.meta?.has_more ? res.links?.next : null;
    if (url) await sleep(exponentialBackoff(attempt++));
  }

  return allResults;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/**
 * Apply tags to a single ticket using the additive tag endpoint.
 * PUT /api/v2/tickets/{id}/tags is strictly ADDITIVE — never overwrites
 * existing tags. Eliminates the read-modify-write race condition that occurs
 * when feedback-triage and escalation-match both write to the same ticket.
 *
 * @param {string|number} ticketId
 * @param {string[]} tags           — tags to add (e.g. ["rel-schedule-layout-v1"])
 */
async function addTags(ticketId, tags) {
  await zdFetch(`/tickets/${ticketId}/tags.json`, {
    method: "PUT",
    body: JSON.stringify({ tags }),
  });
}

/**
 * Set the Linear Issue custom field on a ticket.
 * Called separately from addTags — field update uses the full ticket endpoint.
 * @param {string|number} ticketId
 * @param {string} linearUrl
 * @param {string} linearFieldId
 */
async function setLinearField(ticketId, linearUrl, linearFieldId) {
  await zdFetch(`/tickets/${ticketId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      ticket: {
        custom_fields: [{ id: linearFieldId, value: linearUrl }],
      }
    }),
  });
}

/**
 * Bulk tag + Linear field update for up to 100 tickets in a single API call.
 * Used by release-feedback-scan bulk scan to avoid per-ticket rate limit risk.
 * PUT /api/v2/tickets/update_many.json — Zendesk processes async (returns job status).
 *
 * NOTE: update_many does not support the tag endpoint, so tags are merged
 * with existing tags manually here. This is safe for bulk scan because
 * release-feedback-scan is the only writer during a bulk scan run —
 * no parallel skill is writing tags at the same time.
 *
 * @param {object[]} tickets        — ticket objects (must have .id and .tags)
 * @param {string[]} tagsToAdd      — tags to apply to all tickets
 * @param {string} [linearUrl]      — Linear Issue field value
 * @param {string} [linearFieldId]  — Zendesk custom field ID
 * @returns {Promise<object>} job status object
 */
async function bulkUpdateTickets(tickets, tagsToAdd, linearUrl, linearFieldId) {
  const updates = tickets.map(ticket => {
    const mergedTags = Array.from(new Set([...(ticket.tags ?? []), ...tagsToAdd]));
    const update = { id: ticket.id, tags: mergedTags };
    if (linearUrl && linearFieldId) {
      update.custom_fields = [{ id: linearFieldId, value: linearUrl }];
    }
    return update;
  });

  // Process in chunks of 100 (Zendesk update_many limit)
  const chunks = chunkArray(updates, 100);
  const jobs = [];

  for (const chunk of chunks) {
    const res = await zdFetch(`/tickets/update_many.json`, {
      method: "PUT",
      body: JSON.stringify({ tickets: chunk }),
    });
    jobs.push(res.job_status);
    if (chunks.length > 1) await sleep(1000); // 1s between chunks
  }

  return jobs;
}

/**
 * Add an internal note (not visible to customer) to a ticket.
 * @param {string|number} ticketId
 * @param {string} noteBody
 */
async function addInternalNote(ticketId, noteBody) {
  await zdFetch(`/tickets/${ticketId}.json`, {
    method: "PUT",
    body: JSON.stringify({
      ticket: {
        comment: { body: noteBody, public: false },
      }
    }),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt) {
  return Math.min(500 * Math.pow(2, attempt), 10_000);
}

function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getTicket,
  getTicketComments,
  searchTickets,
  addTags,
  setLinearField,
  bulkUpdateTickets,
  addInternalNote,
};
