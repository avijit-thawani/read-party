# ReadParty — context

> **For agents editing this file:** keep it under **200 lines**. It's an orientation doc, not exhaustive docs — prune stale detail rather than appending.
> **Not the source of truth.** This doc may temporarily drift out of date and is meant as a map, not an authority. The real SoT is the **code** and the **database/backend** — always verify claims (constants, file lists, schema) against them before trusting, and update this doc to match when you find drift (while staying within the line cap).

Living doc for the ReadParty feature built on top of Koodo Reader. Start here.

## What this is
**ReadParty** turns Koodo Reader (an open-source EPUB reader) into a "read a book together" app for **multiple people on different devices** — the reading equivalent of Teleparty/Netflix Party. Each person reads on their own screen, sees where the others are in real time, and can tap **Join** to jump to any of them.

## Why
Built for a long-distance couple to have a **synchronous reading date**: same book, two devices (ideally phones/web), a shared sense of "we're on the same page." It should feel light and fun, not like collaborative editing software.

## Core requirements
1. **One book, synced positions, up to `MAX_ROOM_SIZE` (8) readers per room** (constant in `readParty.ts` + a matching cap in the `join_room` RPC); overflow gets "room full".
2. **Minimal diff from Koodo.** Ship as additive files + a handful of tiny edits. Koodo otherwise untouched so we can pull upstream.
3. **Deep-linkable.** The whole flow (book + room) is reachable from one URL, so it's shareable and E2E-testable without clicking through UI.

## How it works (architecture)
The reading position is a **last-write-wins (LWW) register**, not a stream. Think "shared cursor / presence beacon," like a Figma cursor — a warm connection carrying tiny, infrequent state, eventually consistent.

- **Source of truth:** one row per user in Postgres table `positions` (room_code, user_id, position_json, updated_at). The row is the register.
- **Live delivery:** Supabase Realtime **Postgres change-events** push every partner upsert to the other client (reliable, order/join-independent). A **broadcast** message is also sent as a fast-path nudge.
- **Convergence backstop:** every heartbeat (`HEARTBEAT_MS`, 3s) each client re-reads the partner's row from the DB (`pullPartnerFromDb`) so a missed/throttled push self-heals.
- **Ordering guard:** every update carries the writer's clock (`at` / `updated_at`); a newer timestamp can never be overwritten by an older one (kills the "snap back to a lower %" race).
- **Presence:** Supabase Realtime presence tracks online/offline and enforces the room-size cap. **Solo mode:** when presence shows nobody else online, page flips skip the broadcast/presence sends (realtime messages) and keep only the throttled DB upsert; broadcasting resumes on the next presence join.
- **Layout independence:** we sync a *content anchor* (`cfi` / `chapterDocIndex` + `count` + `percentage`), never pixels — so different fonts/screens still land on the same sentence.

```
Reader A --upsert--> [positions row A] --pg change-event--> Reader B
Reader B --upsert--> [positions row B] --pg change-event--> Reader A
both also: broadcast nudge (fast) + 3s DB re-read (guaranteed) + presence (online/cap)
```

## Current features
- Room create/join, deep-link auto-join (`?party=<code>`), deep-link identity (`?rpuid=&rpname=&rpemoji=`).
- **Multi-user rooms (up to 8)** with Teleparty-style identity: each reader has a nickname + emoji (chosen via the panel's inline editor, or randomly assigned on first run; persisted in localStorage `readparty_name`/`readparty_emoji`; live-propagated via presence).
- **Shared notes & highlights**: anything you highlight/annotate while in a room is pushed to the whole group (scoped to room + book md5) and rendered live in partners' books; members offline at the time catch up on their next join (rows in `room_notes` are the source of truth, tombstoned on delete). Clicking a partner's highlight shows a read-only view with "emoji + name" attribution. Outside a room, Koodo notes behave exactly as before.
- Reader panel: your row (emoji + name + %) plus a participant list with per-person live %, chapter, **Join** button ("✓" when together), offline dimming, and a **Return** button; collapsed pill shows "N reading".
- Book pairing by **MD5** (same file = same book, regardless of local key).
- Room cap with "Room is full" message (presence check client-side + `join_room` RPC count).
- **Room codes are 3 chars** (low scale; shared generator `src/utils/sync/roomCode.ts`, used by the `/party` lobby + the "Read together" menu).
- **Join a room** from the homepage: the guide sidebar has a "Got a code from a friend?" input → navigates to `#/party?room=CODE`. In-reader panel also has "Copy link" (next to Room code) + a prominent "Copy invite link" while waiting for a partner.
- "Read together" action in a book's 3-dot menu (generates a room, opens the reader, copies an invite link).
- `/party` lobby page (pick book + room code, invite link).
- Metrics/logging: `window.__readparty.getMetrics()` and `window.__readparty.setDebug(true)`.

## File map
New (the feature):
- `src/utils/sync/readParty.ts` — the sync singleton (rooms, LWW, presence, metrics).
- `src/utils/sync/supabaseClient.ts` — Supabase client (URL + anon key).
- `src/utils/sync/hostedBooks.ts` — Phase 2: upload/fetch a book by md5 (Supabase Storage + `hosted_books`).
- `src/utils/sync/roomCode.ts` — shared 3-char room-code generator.
- `src/utils/sync/roomNotes.ts` — shared notes/highlights (append-only `room_notes` stream; auto-follows the readParty room lifecycle; offline members catch up from the seed SELECT).
- `src/utils/sync/devImport.ts` — import a book from a served URL (reused by hosted-book fetch + E2E tests).
- `src/containers/readParty/` — the in-reader panel (You/Them, Join, Copy link).
- `src/components/readPartyGuide/` — onboarding sidebar/bottom-sheet on the manager page (mounted in `pages/manager/component.tsx`).
- `src/pages/party/` — the `/party` lobby.

Touched (small — all will conflict when pulling upstream Koodo):
- `src/pages/reader/component.tsx` — mounts `<ReadParty/>` (only when `htmlBook` exists).
- `src/router/index.tsx` — adds `/party` route.
- `src/components/dialogs/actionDialog/component.tsx` — adds "Read together" menu item (opens reader via `window.open` + copies invite; popup blockers can block it).
- `src/containers/header/component.tsx` — `handleOpenLastReadBook` returns early on web so home doesn't get hijacked back into the reader.
- `src/containers/panels/operationPanel/component.tsx` + `src/utils/reader/mouseEvent.ts` — after "finish reading" on web, redirect to `#/manager/home` (browser `window.close()` is a no-op).
- `package.json` — adds `@supabase/supabase-js`.
- `.env` — `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` (note: `supabaseClient.ts` also has a hardcoded fallback of the same values, so `.env` alone won't repoint the project).

## Backend (Supabase)
- Dedicated project **`readparty`** (id `dybkwbhxozwvdxfhdtfz`, region us-west-1, free tier).
- Tables: `rooms`, `room_members` (incl. `emoji`), `positions` (+ `join_room` RPC: upserts name/emoji, caps active members at 8), `room_notes` (shared notes/highlights: unique (room_code, author_id, note_key), jsonb payload = Koodo Note minus bookKey, `deleted` tombstone), and `hosted_books` (Phase 2: md5 pk → title/format/size/storage_path). `positions` and `room_notes` are in the `supabase_realtime` publication.
- RLS is permissive on rooms/members/positions (room code is the shared secret; no login). `hosted_books` blocks anon enumeration: no broad SELECT — single-row reads go via the `get_hosted_book(p_md5)` SECURITY DEFINER RPC; anon insert/update still open.
- Storage: public bucket **`books`** (objects `<md5>.<ext>`, downloaded by exact path via public URL; anon listing removed).
- No Supabase Auth: each browser gets a random `user_id` in localStorage (or via `?rpuid`).

## Run locally
```
cd koodo-reader
yarn                 # first time (or: npx yarn@1.22.22 install --ignore-scripts)
BROWSER=none PORT=3020 yarn start   # CRA dev server (pick a free port; Cursor may grab 3000/3010)
```
Open `http://localhost:<port>/#/party`. Test with **two different browsers** (or normal + incognito): import the same EPUB in each, join the same room code.

## Hosting / deploy status
**LIVE (Phase 1 done):** https://readparty-app.netlify.app/#/party — public URL for cross-device testing (browser storage + manual same-EPUB import per device).

- **Host:** Netlify site `readparty-app` (project id `d5ecfca9-0fa9-4355-87d3-3892e2ec79f1`, team `avi`). Free tier, direct-upload deploys (not git-based).
- **Redeploy flow:** local build + upload (bypasses Netlify CI so the Electron/native-module postinstall never runs):
  ```
  cd koodo-reader
  npx yarn@1.22.22 build                         # -> build/  (inlines REACT_APP_SUPABASE_* from .env)
  netlify deploy --prod --dir=build --no-build    # --no-build is REQUIRED (site's default "yarn build" cmd fails: yarn not on Netlify PATH)
  ```
  Because CRA inlines `REACT_APP_*` at build time, Netlify env vars are irrelevant for this local-build path — the anon key/URL come from `.env` (and hardcoded fallbacks in `supabaseClient.ts`).
- **SPA fallback:** `public/_redirects` (`/* /index.html 200`) ships in the build. Hash-router so not strictly required, but safe.
- **Backend (Supabase):** already provisioned (project `readparty`). The free tier pauses the project after about a week without traffic, which also takes the live site down (it happened in Sep 2026); restore it from the Supabase dashboard. Anon key public by design.
- **Note:** the `isElectron` UA quirk only affects the Cursor in-IDE test browser. Real browsers run web mode fine.

### Productionization roadmap (staged)
- **Phase 1 — DONE:** public Netlify URL, local storage + manual same-EPUB upload, cross-device sync test. Onboarding: hidable right sidebar (`src/components/readPartyGuide/`, mounted in `pages/manager/component.tsx`), default open, web-only. 3 steps (upload a book → start a party → share link); "Upload" reuses Koodo's hidden `#import-book-box` input; step 1 auto-checks off via live book count; collapse state persists in `localStorage["rp_guide_collapsed"]`. On mobile (≤600px) the guide becomes a bottom sheet (collapsed = floating pill, bottom-right) — this is the intended **mobile entry point**, since Koodo's own manager is a non-reflowing desktop layout whose top-right Import controls are off-screen on phones. The guide's Upload + Start-a-party + the `/#/party` page (already responsive) cover the phone flow without needing Koodo's off-screen buttons.
- **Mobile reader fixes** (`pages/reader/component.tsx`, web + `clientWidth<=600`): first-run defaults (only seeded if unset, so user changes stick — all reader settings persist in `localStorage["readerConfig"]`): (1) `fontSize="15"`, (2) `isTouch="yes"` (Hammer.js swipe page-turn), (3) `readerMode="single"` (Koodo's default is the unusable two-page "double" spread on a phone). Layout: (4) left TOC and right settings drawers are mutually exclusive (`handleEnterReader` closes the opposite panel); (5) the grid "options" icon on mobile opens the **right settings drawer** (font size, font family, theme, line spacing, page mode — the `SettingPanel`, previously only reachable via an invisible right-edge tap) **plus the top toolbar** (exit/bookmark/fullscreen); a `.mobile-panel-scrim` tap-outside dismisses the side drawers. Koodo's reader otherwise has no responsive layout.
- **Phase 2 — DONE (share link only):** Supabase Storage bucket `books` (public) + `public.hosted_books` table (md5 pk, title/format/size/storage_path; permissive RLS; storage.objects policies allow anon read/insert/update on bucket). Helper `src/utils/sync/hostedBooks.ts`: `uploadHostedBook(book)` (idempotent by md5, reads bytes via `BookUtil.fetchBook`, uploads to `<md5>.<ext>`, upserts row) and `importHostedBook(md5)` (looks up row → public URL → reuses `importBookFromUrl`). Wired: party page auto-uploads the selected book + auto-downloads/imports a missing invited book (with "Fetching the shared book…" state); `actionDialog` "Read together" and the in-reader ReadParty deep-link both upload. Partner now just opens the link — no manual re-import.
- **Phase 3 — accounts / "friend" to sync library:** Supabase Auth (magic link), `profiles` (nickname+emoji, also unlocks Teleparty avatars), `friendships`/shared library, tighten RLS. ≤10 users month 1 → ignore scaling/cost.

## Known issues / caveats
- **Background-tab throttling:** a hidden/occluded browser tab has its realtime socket throttled; it catches up on focus and within ~5s via the DB re-read. On two real foreground devices this is a non-issue.
- **Cross-device latency numbers** from `getMetrics()` include clock skew between devices (they're exact only on one machine). A clock-independent round-trip ping is a TODO if precise measurement is needed.
- **Tunable timings** in `readParty.ts`: `DB_UPSERT_THROTTLE_MS` (200ms — batches rapid page-flips before writing to the DB), `HEARTBEAT_MS` (3000ms — presence re-assert + guaranteed DB reconcile), `PRESENCE_SYNC_TIMEOUT_MS` (2500ms — fallback for the join-time capacity decision if no presence sync arrives). The `broadcast` fast-path fires on every flip with no throttle (client capped at `eventsPerSecond: 20`), so foreground↔foreground is near-instant; these intervals mainly bound the worst case (background/dropped-push recovery).
- **Idle / lifecycle / quota:** cost scales with **page flips**, not time. The 3s heartbeat goes silent when the tab is `document.hidden` or idle > `IDLE_TIMEOUT_MS` (5 min, no flip) — it stays subscribed (still receives the partner) and resumes on the next flip, so a forgotten/backgrounded tab costs ~0. The heartbeat no longer re-broadcasts an unchanged position (flips push via broadcast + postgres change-events; each active side re-reads the DB every 3s). `readParty.leave()` is called on reader unmount + `pagehide`. Result: ~2 realtime messages per flip → a 2-hour date ≈ ~500 messages, i.e. thousands of hours/month under Supabase's ~2M-messages free tier.
- **Testing needs a real external browser.** The in-IDE/Cursor browser reports an Electron UA, so Koodo takes the desktop path and renders blank (`#root` empty) — you can't test the flow there. Use Chrome/Safari (normal + incognito) at `/#/party`.
- **Code home:** the fork [avijit-thawani/read-party](https://github.com/avijit-thawani/read-party), branch `readparty` (its default branch). In this clone `origin` is still upstream Koodo and the fork is the `fork` remote: push with `git push fork dev:readparty`.
- **Hosting a new book fails (found Sep 2026).** `get_hosted_book` returns `hosted_books` rather than `SETOF hosted_books`, so a missing md5 comes back as a row of NULLs; `getHostedBook` treats that as found and `uploadHostedBook` never uploads. The `books` bucket also has no SELECT policy, which `upload(..., { upsert: true })` needs. Invites therefore only work for books that are already hosted.
- **Security:** RLS on `rooms`/`room_members`/`positions` is fully permissive; the room code is the only secret. Fine for a 2-person app, not private. `hosted_books` (Phase 2) is hardened against enumeration: no broad anon SELECT — single-row lookup goes through the `get_hosted_book(p_md5)` SECURITY DEFINER RPC (client `getHostedBook` prefers the RPC, falls back to direct select if absent). Storage `books` bucket is public (download by exact md5 path) but anon listing SELECT is removed. Uploads capped at 60MB (`hostedBooks.ts`). Still no auth — anon key is public, so writes remain open; tighten in Phase 3.

## Roadmap / later features
- ~~Identity like Teleparty (nickname + emoji) and >2-person rooms.~~ **DONE** — participants map in `readParty.ts`, emoji column on `room_members`, panel editor.
- ~~Hosted EPUB upload so a partner auto-downloads the same file.~~ **DONE (Phase 2)** — see `hostedBooks.ts` + the roadmap section above.
- "Locked together" co-flip mode (both move as one), vs today's presence + Join.
- ~~Shared highlights/notes.~~ **DONE** — `roomNotes.ts` + `room_notes` table; see Current features. Reactions / lightweight in-book chat still open (same append-only pattern).
- Clock-independent round-trip latency ping.
- ~~Suppress Koodo's web promo popups for a cleaner first-run.~~ **DONE** — the first-run "Never lose your data" local-folder promo is suppressed in `src/containers/header/component.tsx` (browser storage is the default; re-auth prompts still fire only for users who opted into local storage).
