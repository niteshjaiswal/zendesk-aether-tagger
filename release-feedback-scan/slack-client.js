// release-feedback-scan/slack-client.js
// Slack API calls — thread replies and P1 alerts.

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

module.exports = { postSlackReply, postP1Alert };
