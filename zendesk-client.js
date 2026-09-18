// shared/zendesk-client.js
// All Zendesk REST API calls — imported by both feedback-triage and release-feedback-scan skills.
// When Zendesk MCP lands, only this file changes. All business logic is untouched.

const BASE_URL = process.env.ZENDESK_ENV === "production"
  ? "https://7shifts.zendesk.com/api/v2"
  : "https://7shifts-sandbox.zendesk.com/api/v2";

const AUTH = Buffer.from(
  `${process.env.ZD_EMAIL}/token:${process.env.ZD_API_TOKEN}`
).toString("base64");

const HEADERS = {
  "Authorization": `Basic ${AUTH}`,
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
 * @param {number} lookbackDays — used to build date filter if not already in query
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
 * Apply tags and optionally set the Linear Issue custom field on a ticket.
 * Merges with existing tags — never overwrites the full tag list.
 * @param {string|number} ticketId
 * @param {string[]} tags           — tags to add (e.g. ["rel-schedule-layout-v1"])
 * @param {string} [linearUrl]      — value for the Linear Issue custom field
 * @param {string} [linearFieldId]  — Zendesk custom field ID (set via env var)
 */
async function updateTicket(ticketId, tags, linearUrl, linearFieldId) {
  // Fetch current tags to merge (Zendesk replaces the full list on PUT)
  const ticket = await getTicket(ticketId);
  const mergedTags = Array.from(new Set([...(ticket.tags ?? []), ...tags]));

  const body = { ticket: { tags: mergedTags } };

  if (linearUrl && linearFieldId) {
    body.ticket.custom_fields = [
      { id: linearFieldId, value: linearUrl }
    ];
  }

  await zdFetch(`/tickets/${ticketId}.json`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

/**
 * Add an internal note (not visible to customer) to a ticket.
 * @param {string|number} ticketId
 * @param {string} noteBody  — plain text or basic HTML
 */
async function addInternalNote(ticketId, noteBody) {
  const body = {
    ticket: {
      comment: {
        body: noteBody,
        public: false,
      }
    }
  };

  await zdFetch(`/tickets/${ticketId}.json`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function exponentialBackoff(attempt) {
  // 500ms, 1s, 2s, 4s … capped at 10s
  return Math.min(500 * Math.pow(2, attempt), 10_000);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  getTicket,
  getTicketComments,
  searchTickets,
  updateTicket,
  addInternalNote,
};
