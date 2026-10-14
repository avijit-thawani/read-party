/* Throwaway harness: verify the room_notes shared-notes protocol.
 * A publishes a note -> B gets it live via postgres_changes;
 * C joins late (offline catch-up) -> sees it via seed SELECT;
 * A tombstones -> B sees deleted=true. Run: node scripts/rp-notes-test.js */
const { createClient } = require("@supabase/supabase-js");

const URL = "https://dybkwbhxozwvdxfhdtfz.supabase.co";
const KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR5Ymt3Ymh4b3p3dmR4ZmhkdGZ6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NDk2OTQsImV4cCI6MjA5ODIyNTY5NH0.-XMuK4KskVF3sRP9kfjXqjplLx1CZ1QsvZtHy4rnKPA";
const ROOM = "NQ" + Math.random().toString(36).slice(2, 4).toUpperCase();
const MD5 = "test-md5-notes";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeClient(uid) {
  const sb = createClient(URL, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const events = [];
  const ch = sb.channel("readparty-notes:" + ROOM);
  ch.on(
    "postgres_changes",
    { event: "*", schema: "public", table: "room_notes", filter: "room_code=eq." + ROOM },
    (payload) => events.push(payload.new)
  );
  return new Promise((resolve, reject) => {
    ch.subscribe((s) => {
      if (s === "SUBSCRIBED") resolve({ sb, ch, uid, events });
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") reject(new Error(s));
    });
  });
}

(async () => {
  console.log("room:", ROOM);
  const a = await makeClient("n_u1");
  const b = await makeClient("n_u2");

  // 1. A publishes a highlight
  const payload = {
    key: "1752361000000",
    chapter: "Chapter 1",
    chapterIndex: 0,
    text: "some highlighted sentence",
    cfi: '{"percentage":"0.1"}',
    range: '[{"x":1}]',
    notes: "",
    percentage: "0.1",
    color: "background-#FEF3CD",
    tag: [],
  };
  const { error: upErr } = await a.sb.from("room_notes").upsert(
    {
      room_code: ROOM,
      book_md5: MD5,
      author_id: "n_u1",
      author_name: "Alice",
      author_emoji: "A",
      note_key: payload.key,
      payload,
      deleted: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "room_code,author_id,note_key" }
  );
  console.log("A upsert:", upErr ? "FAIL " + upErr.message : "ok");
  await sleep(2500);
  console.log(
    "B live change-event:",
    b.events.length && b.events[0].note_key === payload.key
      ? "ok (" + b.events[0].payload.text + ")"
      : "FAIL " + JSON.stringify(b.events)
  );

  // 2. late joiner catch-up via seed SELECT
  const c = createClient(URL, KEY, { auth: { persistSession: false } });
  const { data: seed, error: seedErr } = await c
    .from("room_notes")
    .select("author_id, author_name, note_key, payload, deleted, updated_at")
    .eq("room_code", ROOM)
    .eq("book_md5", MD5);
  console.log(
    "C offline catch-up:",
    !seedErr && seed.length === 1 && seed[0].payload.text === payload.text
      ? "ok"
      : "FAIL " + (seedErr ? seedErr.message : JSON.stringify(seed))
  );

  // 3. tombstone delete propagates
  b.events.length = 0;
  const { error: delErr } = await a.sb
    .from("room_notes")
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq("room_code", ROOM)
    .eq("author_id", "n_u1")
    .eq("note_key", payload.key);
  console.log("A tombstone:", delErr ? "FAIL " + delErr.message : "ok");
  await sleep(2500);
  console.log(
    "B sees tombstone:",
    b.events.length && b.events[0].deleted === true ? "ok" : "FAIL " + JSON.stringify(b.events)
  );

  // cleanup (delete allowed? RLS has no delete policy -> use update-only cleanup is fine; try delete anyway)
  await a.sb.from("room_notes").delete().eq("room_code", ROOM);
  await Promise.all([a, b].map((cl) => cl.ch.unsubscribe()));
  console.log("done");
  process.exit(0);
})().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});
