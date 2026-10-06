// release-feedback-scan/index.js
// Aether skill entry point — triggered by:
//   1. Linear native trigger: release project → Done (with p1–p4 label)
//   2. Linear native trigger: bug-as-designed label applied to an issue
//   3. Slack :mag: reaction on a message in #support-releases
//
// What it does:
//   - Deduplicates: skips if this linear_id is already active in the registry
//   - Extracts keywords from Linear issue/project title + description
//   - Bulk scans past Zendesk tickets (lookback window based on p-level)
//   - Tags matched tickets: rel-[slug] or bug-as-designed-lin-[id]
//     (per-ticket errors are caught and logged — scan continues on failure)
//   - Adds internal note with suggested response + Linear link
//   - Creates Feedback Summary issue inside Linear project (releases only)
//   - Writes ZD attachments + customer needs to Linear issue
//   - Posts artifact comment to Linear issue
//   - Writes entry to release_feedback_registry (always — even on partial failure)
//
// HUMAN CONFIRMATION GATE (P1/P2 releases only):
//   Aether pauses after keyword extraction and posts a Slack message to
//   #feedback-releases with the keyword list + Approve / Cancel buttons.
//   Brady to confirm the exact mechanism Aether supports for human-in-the-loop.
//   P3/P4 auto-fire with no gate.

const { searchTickets, updateTicket, addInternalNote } = require("../shared/zendesk-client");
const { addRegistryEntry, logRun, isAlreadyRegistered } = require("../shared/registry-client");
const { buildInternalNote } = require("./note-builder");
const { extractKeywords, buildSlug, lookbackDays } = require("./scanner");
const { createFeedbackSummaryIssue, writeAttachments, postArtifactComment } = require("./linear-client");
const { postSlackReply, postConfirmationGate } = require("./slack-client");

const LINEAR_FIELD_ID = process.env.ZD_LINEAR_FIELD_ID;

/**
 * Main entry point called by Aether.
 * @param {object} input
 * @param {"release"|"bug-as-designed"|"slack"} input.trigger
 * @param {string} input.linear_id       — e.g. "LIN-4821" or project ID
 * @param {string} input.title           — issue/project title
 * @param {string} input.description     — issue/project description
 * @param {string} [input.p_level]       — "p1"|"p2"|"p3"|"p4" (releases only)
 * @param {string} [input.linear_url]    — link back to the Linear issue/project
 * @param {string} [input.slack_channel] — for Slack trigger replies
 * @param {string} [input.slack_ts]      — Slack message timestamp for thread reply
 * @param {boolean} [input.confirmed]    — true if human already approved via confirmation gate
 */
async function run(input) {
  const { trigger, linear_id, title, description, p_level, linear_url, slack_channel, slack_ts, confirmed } = input;

  // 1. Deduplication check — skip if already active in registry
  const alreadyRegistered = await isAlreadyRegistered(linear_id);
  if (alreadyRegistered) {
    return {
      action: "skipped",
      reason: `${linear_id} is already active in the registry — scan already ran.`,
    };
  }

  // 2. Extract keywords
  const keywords = extractKeywords(title, description);
  const slug = buildSlug(title);
  const zdTag = trigger === "bug-as-designed"
    ? `bug-as-designed-lin-${linear_id.toLowerCase().replace("lin-", "")}`
    : `rel-${slug}`;

  // 3. Human confirmation gate for P1/P2 releases (skip if already confirmed)
  // NOTE FOR BRADY: postConfirmationGate sends a Slack message to #feedback-releases
  // with keyword list + Approve/Cancel buttons. Aether re-invokes this skill with
  // confirmed=true when the SE clicks Approve. Confirm the exact human-in-the-loop
  // mechanism Aether supports — this is a placeholder until Brady confirms.
  const needsGate = (trigger === "release" || trigger === "slack") &&
    ["p1", "p2"].includes((p_level ?? "").toLowerCase()) &&
    !confirmed;

  if (needsGate) {
    await postConfirmationGate({
      linear_id,
      title,
      keywords,
      zdTag,
      p_level,
      linear_url,
    });
    return {
      action: "awaiting-confirmation",
      reason: `P1/P2 release — keyword list sent to #feedback-releases for SE approval before bulk scan fires.`,
      keywords,
    };
  }

  // 4. Determine lookback window
  const days = lookbackDays(trigger, p_level);

  // 5. Bulk scan Zendesk
  const query = keywords.map(k => `"${k}"`).join(" OR ");
  const tickets = await searchTickets(query, days);

  let tagged = 0;
  let tagErrors = [];

  // 6. Tag each matched ticket — catch per-ticket errors so scan continues
  for (const ticket of tickets) {
    try {
      const tags = [zdTag];
      if (trigger === "bug-as-designed") tags.push("bug-as-designed");

      await updateTicket(ticket.id, tags, linear_url, LINEAR_FIELD_ID);
      await addInternalNote(ticket.id, buildInternalNote({ title, type: trigger, linear_url, zd_tag: zdTag }, 1.0));
      tagged++;
    } catch (err) {
      tagErrors.push({ ticket_id: ticket.id, error: err.message });
      console.error(`[release-feedback-scan] Failed to tag ticket ${ticket.id}: ${err.message}`);
    }
  }

  // 7. Write to Linear
  let feedbackIssueUrl = linear_url;

  try {
    if (trigger === "release" || trigger === "slack") {
      const feedbackIssue = await createFeedbackSummaryIssue(linear_id, title, tickets);
      feedbackIssueUrl = feedbackIssue.url;
      await writeAttachments(feedbackIssue.id, tickets);
      await postArtifactComment(feedbackIssue.id, tickets, keywords);
    } else if (trigger === "bug-as-designed") {
      await writeAttachments(linear_id, tickets);
      await postArtifactComment(linear_id, tickets, keywords);
    }
  } catch (err) {
    console.error(`[release-feedback-scan] Linear write failed: ${err.message}`);
  }

  // 8. Write to registry — always runs, even if some ticket tags failed
  await addRegistryEntry({
    linear_id,
    title,
    type: trigger === "bug-as-designed" ? "bug-as-designed" : "release",
    keywords,
    zd_tag: zdTag,
    linear_url: feedbackIssueUrl,
    p_level: p_level ?? "p3",
  });

  // 9. Log run — includes partial failure details
  await logRun({
    trigger,
    linear_id,
    tickets_found: tickets.length,
    tickets_tagged: tagged,
    error: tagErrors.length > 0
      ? `${tagErrors.length} ticket(s) failed to tag: ${tagErrors.map(e => e.ticket_id).join(", ")}`
      : null,
  });

  // 10. Slack thread reply (if triggered from Slack)
  if (trigger === "slack" && slack_channel && slack_ts) {
    await postSlackReply(
      slack_channel,
      slack_ts,
      `Scanned ${days} days back. Found ${tagged}/${tickets.length} ticket(s) tagged \`${zdTag}\`. → ${feedbackIssueUrl}${tagErrors.length > 0 ? ` ⚠️ ${tagErrors.length} ticket(s) failed — check run log.` : ""}`
    );
  }

  return {
    tickets_found: tickets.length,
    tickets_tagged: tagged,
    tag_errors: tagErrors,
    zd_tag: zdTag,
    keywords,
    feedback_issue_url: feedbackIssueUrl,
  };
}

module.exports = { run };
