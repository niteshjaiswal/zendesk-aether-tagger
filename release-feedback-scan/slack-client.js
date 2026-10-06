// release-feedback-scan/slack-client.js
// Slack API calls — thread replies, P1 alerts, and P1/P2 confirmation gate.

const SLACK_API = "https://slack.com/api";
const HEADERS = {
  "Authorization": `Bearer ${process.env.SLACK_BOT_TOKEN}`,
  "Content-Type": "application/json",
};

async function slackFetch(endpoint, body) {
  const res = await fetch(`${SLACK_API}/${endpoint}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack API error: ${json.error}`);
  return json;
}

/**
 * Reply in a Slack thread with scan results.
 * @param {string} channel
 * @param {string} thread_ts  — parent message timestamp
 * @param {string} text
 */
async function postSlackReply(channel, thread_ts, text) {
  await slackFetch("chat.postMessage", { channel, thread_ts, text });
}

/**
 * Post a P1 alert to #feedback-releases.
 * @param {string} text
 */
async function postP1Alert(text) {
  const channel = process.env.SLACK_FEEDBACK_CHANNEL ?? "#feedback-releases";
  await slackFetch("chat.postMessage", { channel, text });
}

/**
 * Post a P1/P2 human confirmation gate to #feedback-releases.
 * Shows extracted keywords and asks SE to approve before bulk scan fires.
 *
 * NOTE FOR BRADY: This uses Slack Block Kit interactive buttons. Aether must:
 *   1. Handle the Slack interactivity callback when SE clicks Approve/Cancel
 *   2. Re-invoke release-feedback-scan with confirmed=true on Approve
 *   3. Confirm whether Aether has native support for interactive Slack callbacks
 *      or if this needs a separate webhook endpoint.
 *
 * Until Brady confirms, this sends a plain-text message as a fallback —
 * SE approves by reacting with :white_check_mark: or cancels with :x:.
 *
 * @param {object} opts
 * @param {string} opts.linear_id
 * @param {string} opts.title
 * @param {string[]} opts.keywords
 * @param {string} opts.zdTag
 * @param {string} opts.p_level
 * @param {string} opts.linear_url
 */
async function postConfirmationGate(opts) {
  const { linear_id, title, keywords, zdTag, p_level, linear_url } = opts;
  const channel = process.env.SLACK_FEEDBACK_CHANNEL ?? "#feedback-releases";

  const text = [
    `⚠️ *${p_level?.toUpperCase()} Release Scan — Awaiting Approval*`,
    ``,
    `*Release:* ${title} (${linear_id})`,
    `*Tag to apply:* \`${zdTag}\``,
    `*Linear:* ${linear_url}`,
    ``,
    `*Keywords extracted:*`,
    keywords.map(k => `  • ${k}`).join("\n"),
    ``,
    `React ✅ to approve bulk scan, ❌ to cancel.`,
    `_(Brady: replace with interactive buttons once Aether callback mechanism is confirmed)_`,
  ].join("\n");

  await slackFetch("chat.postMessage", { channel, text });
}

module.exports = { postSlackReply, postP1Alert, postConfirmationGate };
