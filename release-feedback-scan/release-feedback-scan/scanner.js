// release-feedback-scan/scanner.js
// Keyword extraction, slug generation, and lookback window logic.

/**
 * Extract keywords from a Linear issue/project title and description.
 * Strips stop words, deduplicates, returns meaningful terms.
 * @param {string} title
 * @param {string} description
 * @returns {string[]}
 */
function extractKeywords(title, description) {
  const STOP_WORDS = new Set([
    "a","an","the","and","or","but","in","on","at","to","for","of","with",
    "is","was","are","were","be","been","being","have","has","had","do","does",
    "did","will","would","could","should","may","might","this","that","these",
    "those","it","its","we","our","you","your","they","their","as","by","from",
    "up","about","into","through","during","before","after","above","below",
    "between","out","off","over","under","again","then","once","here","there",
    "when","where","why","how","all","both","each","few","more","most","other",
    "some","such","no","not","only","same","so","than","too","very","just",
    "new","update","fix","bug","issue","feature","release","change","add","remove"
  ]);

  const text = `${title} ${description}`;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));

  // Also extract bigrams (two-word phrases) from title for precision
  const titleWords = title.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
  const bigrams = [];
  for (let i = 0; i < titleWords.length - 1; i++) {
    bigrams.push(`${titleWords[i]} ${titleWords[i + 1]}`);
  }

  return Array.from(new Set([...bigrams, ...words])).slice(0, 15);
}

/**
 * Build a Zendesk tag slug from a release title.
 * "Schedule Layout v1" → "schedule-layout-v1"
 * @param {string} title
 * @returns {string}
 */
function buildSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50);
}

/**
 * Lookback window in days based on trigger type and p-level.
 * @param {"release"|"bug-as-designed"|"slack"} trigger
 * @param {string} [p_level]
 * @returns {number}
 */
function lookbackDays(trigger, p_level) {
  if (trigger === "bug-as-designed") return 60;
  const windows = { p1: 30, p2: 14, p3: 7, p4: 7 };
  return windows[(p_level ?? "p3").toLowerCase()] ?? 7;
}

module.exports = { extractKeywords, buildSlug, lookbackDays };
