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
      { labels: { name: { eq: "SXP Escalation" } } },
      { state: { type: { nin: ["completed", "cancelled"] } } },
    ]
  };
  const res = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Authorization": process.env.LINEAR_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { filter } }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(`Linear API error: ${JSON.stringify(json.errors)}`);

  // Store in cache
  _cache.escalations = json.data.issues.nodes;
  _cache.fetchedAt = Date.now();

  return _cache.escalations;
}

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "is","was","are","were","be","been","have","has","had","do","does","did",
  "will","would","could","should","this","that","it","its","we","our","they",
  "their","as","by","from","not","no","so","too","just","can","also","into",
  "after","before","when","how","why","what","which","who","where","then",
  "than","more","most","some","all","both","each","any","other","such",
]);

function tokenize(text) {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Extract company ID from text (e.g. "Company ID: 128288" or "(128288)")
 */
function extractCompanyIds(text) {
  const matches = (text ?? "").match(/\b\d{5,7}\b/g) ?? [];
  return new Set(matches);
}

/**
 * Score an incoming ZD ticket against one Linear escalation issue.
 * Returns a confidence score 0.0–1.0.
 */
function scoreMatch(ticket, issue) {
  let score = 0;

  // 1. Company ID exact match — strongest signal (+0.45)
  const ticketCompanyIds = extractCompanyIds(`${ticket.subject} ${ticket.description} ${ticket.company_id ?? ""}`);
  const issueCompanyIds = extractCompanyIds(`${issue.title} ${issue.description}`);
  const companyOverlap = [...ticketCompanyIds].some(id => issueCompanyIds.has(id));
  if (companyOverlap) score += 0.45;

  // 2. Keyword overlap between ticket and issue title/description (+up to 0.40)
  const ticketTokens = new Set(tokenize(`${ticket.subject} ${ticket.description}`));
  const issueTokens = tokenize(`${issue.title} ${issue.description?.slice(0, 500) ?? ""}`);
  const issueTokenSet = new Set(issueTokens);
  let hits = 0;
  for (const t of ticketTokens) {
    if (issueTokenSet.has(t)) hits++;
  }
  const keywordScore = Math.min(hits / Math.max(issueTokenSet.size, 1), 1) * 0.40;
  score += keywordScore;

  // 3. Priority bump if issue is Urgent/High (+0.05)
  if (issue.priority?.value <= 2) score += 0.05;

  // 4. Bigram boost — 2-word phrase match from title (+0.10 per match, max 0.10)
  const titleWords = tokenize(issue.title);
  for (let i = 0; i < titleWords.length - 1; i++) {
    const bigram = `${titleWords[i]} ${titleWords[i+1]}`;
    if (`${ticket.subject} ${ticket.description}`.toLowerCase().includes(bigram)) {
      score += 0.10;
      break;
    }
  }

  return Math.min(score, 1.0);
}

/**
 * Match an incoming Zendesk ticket against all open SXP escalations.
 * @param {object} ticket — { subject, description, company_id }
 * @returns {Promise<{match: object|null, confidence: number, allMatches: object[]}>}
 */
async function matchEscalation(ticket) {
  const escalations = await getOpenEscalations();
  const scored = escalations.map(issue => ({
    issue,
    confidence: scoreMatch(ticket, issue),
  })).sort((a, b) => b.confidence - a.confidence);

  const best = scored[0];
  return {
    match: best?.confidence >= 0.70 ? best.issue : null,
    confidence: best?.confidence ?? 0,
    allMatches: scored.filter(s => s.confidence >= 0.70),
  };
}

module.exports = { matchEscalation };
