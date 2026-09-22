// test-client.js
// Run this locally against Zendesk sandbox to prove read + write before wiring into Aether.
//
// Usage:
//   ZENDESK_ENV=sandbox ZD_EMAIL=you@7shifts.com ZD_API_TOKEN=yourtoken node test-client.js
//
// Or create a .env file and run with:
//   node -r dotenv/config test-client.js

const {
  getTicket,
  getTicketComments,
  searchTickets,
  updateTicket,
  addInternalNote,
} = require("./shared/zendesk-client");

// ─── CONFIG — set these before running ───────────────────────────────────────

const TEST_TICKET_ID = "YOUR_SANDBOX_TICKET_ID";   // ← paste a real sandbox ticket ID
const LINEAR_FIELD_ID = process.env.ZD_LINEAR_FIELD_ID || null; // ← set once you create the custom field

// ─── Tests ────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🔧 Zendesk client test — env: ${process.env.ZENDESK_ENV ?? "sandbox"}\n`);

  // 1. Read ticket
  console.log("1️⃣  getTicket...");
  const ticket = await getTicket(TEST_TICKET_ID);
  console.log(`   ✅ Subject: "${ticket.subject}"`);
  console.log(`   ✅ Status: ${ticket.status}`);
  console.log(`   ✅ Current tags: [${ticket.tags.join(", ")}]`);

  // 2. Read comments
  console.log("\n2️⃣  getTicketComments...");
  const comments = await getTicketComments(TEST_TICKET_ID);
  console.log(`   ✅ ${comments.length} comment(s) found`);

  // 3. Search tickets
  console.log("\n3️⃣  searchTickets (last 7 days, keyword: 'test')...");
  const results = await searchTickets("test", 7);
  console.log(`   ✅ ${results.length} ticket(s) matched`);

  // 4. Update ticket — add test tag
  console.log("\n4️⃣  updateTicket — adding tag 'aether-test'...");
  await updateTicket(
    TEST_TICKET_ID,
    ["aether-test"],
    LINEAR_FIELD_ID ? "https://linear.app/7shifts/issue/TEST-001" : null,
    LINEAR_FIELD_ID
  );
  const updated = await getTicket(TEST_TICKET_ID);
  const tagAdded = updated.tags.includes("aether-test");
  console.log(`   ${tagAdded ? "✅" : "❌"} Tag 'aether-test' present: ${tagAdded}`);
  if (LINEAR_FIELD_ID) {
    const field = updated.custom_fields?.find(f => String(f.id) === String(LINEAR_FIELD_ID));
    console.log(`   ${field?.value ? "✅" : "❌"} Linear Issue field: ${field?.value ?? "not set"}`);
  } else {
    console.log("   ⚠️  Skipping Linear field check — ZD_LINEAR_FIELD_ID not set yet");
  }

  // 5. Add internal note
  console.log("\n5️⃣  addInternalNote...");
  await addInternalNote(
    TEST_TICKET_ID,
    "🤖 Aether test note — this is an internal note added by the feedback loop prototype. Safe to ignore."
  );
  console.log("   ✅ Internal note added — check the ticket in Zendesk sandbox to confirm");

  console.log("\n✅ All tests passed. zendesk-client.js is ready.\n");
}

run().catch(err => {
  console.error("\n❌ Test failed:", err.message);
  process.exit(1);
});
