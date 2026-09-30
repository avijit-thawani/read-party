import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";

// A reading position as produced by kookit's rendition.getPosition().
// We keep the whole object opaque and round-trip it through goToPosition().
export type ReadPartyPosition = {
  cfi?: string;
  chapterTitle?: string;
  chapterDocIndex?: string | number;
  chapterHref?: string;
  percentage?: string;
  page?: string;
  [key: string]: any;
};

export type ParticipantState = {
  userId: string;
  displayName: string;
  emoji: string;
  position: ReadPartyPosition | null;
  online: boolean;
  lastSeen: number;
  // Sender-clock timestamp of `position`; used to reject out-of-order updates.
  positionAt?: number;
};

// Deprecated alias kept for older call sites.
export type PartnerState = ParticipantState;

export type ReadPartyStatus =
  | "idle"
  | "connecting"
  | "joined"
  | "full"
  | "error";

export type ReadPartySnapshot = {
  status: ReadPartyStatus;
  roomCode: string | null;
  userId: string;
  displayName: string;
  emoji: string;
  bookMd5: string | null;
  bookTitle: string | null;
  // All other readers in the room (online first, then by name).
  participants: ParticipantState[];
  // Deprecated: first other participant (2-person era API).
  partner: ParticipantState | null;
  myPosition: ReadPartyPosition | null;
};

type JoinOptions = {
  roomCode: string;
  bookMd5?: string;
  bookTitle?: string;
  displayName?: string;
  emoji?: string;
};

const UID_KEY = "readparty_uid";
const NAME_KEY = "readparty_name";
const EMOJI_KEY = "readparty_emoji";
export const MAX_ROOM_SIZE = 8;
const PRESENCE_SYNC_TIMEOUT_MS = 2500;
const DB_UPSERT_THROTTLE_MS = 200;
const HEARTBEAT_MS = 3000;
// After this long with no page-flip (or while the tab is hidden) the heartbeat
// goes silent to avoid burning quota on a forgotten/backgrounded session. We
// stay subscribed (still receive others) and resume on the next flip.
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

const randomId = (): string => {
  try {
    if (typeof crypto !== "undefined" && (crypto as any).randomUUID) {
      return (crypto as any).randomUUID();
    }
  } catch (e) {
    /* ignore */
  }
  return "u_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
};

const ADJECTIVES = [
  "Cozy", "Brave", "Lunar", "Velvet", "Misty", "Golden", "Quiet", "Wild",
  "Mellow", "Crimson", "Amber", "Silver", "Dreamy", "Gentle", "Swift",
  "Wandering", "Sunny", "Autumn", "Hazel", "Cosmic",
];
const NOUNS = [
  "Otter", "Fox", "Heron", "Maple", "Comet", "Willow", "Sparrow", "Lynx",
  "Pebble", "Robin", "Cedar", "Finch", "Marlin", "Quill", "Lantern", "Meadow",
  "Ember", "Brook", "Falcon", "Poppy",
];
const friendlyName = (): string => {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return a + " " + n;
};

// Curated avatar set (cozy / bookish / nature). Shown in the picker too.
export const EMOJI_CHOICES = [
  "\u{1F4DA}", "\u{1F98A}", "\u{1F319}", "\u2615", "\u{1F427}", "\u{1F344}",
  "\u{1F525}", "\u{1F30A}", "\u{1F989}", "\u{1F43B}", "\u{1F338}", "\u{1F341}",
  "\u{1F9E1}", "\u2B50", "\u{1F407}", "\u{1F422}", "\u{1F98B}", "\u{1F331}",
  "\u{1F36A}", "\u{1F3A7}", "\u{1F576}\uFE0F", "\u{1F9CA}", "\u{1F308}", "\u{1F996}",
];
const randomEmoji = (): string =>
  EMOJI_CHOICES[Math.floor(Math.random() * EMOJI_CHOICES.length)];

class ReadPartyManager {
  private channel: RealtimeChannel | null = null;
  private status: ReadPartyStatus = "idle";
  private roomCode: string | null = null;
  private bookMd5: string | null = null;
  private bookTitle: string | null = null;
  private userId: string;
  private displayName: string;
  private emoji: string;
  private participants: Map<string, ParticipantState> = new Map();
  private myPosition: ReadPartyPosition | null = null;
  private listeners: Set<(snap: ReadPartySnapshot) => void> = new Set();
  private lastDbUpsertAt = 0;
  private dbUpsertTimer: any = null;
  private heartbeatTimer: any = null;
  private lastActivityAt = Date.now();
  // Solo mode: when nobody else is online we skip broadcast sends and presence
  // re-tracks (realtime messages) and keep only the free, throttled DB upsert.
  // Presence join/sync flips this back on the moment someone shows up.
  private othersOnline = 0;
  private debug = false;
  private metrics = {
    applied: 0,
    published: 0,
    bySource: {} as Record<string, number>,
    lastDeltaMs: null as number | null,
    samples: [] as Array<{
      source: string;
      at: number;
      recv: number;
      deltaMs: number;
      pct?: string;
    }>,
  };

  constructor() {
    try {
      this.debug = window.localStorage.getItem("readparty_debug") === "1";
    } catch (e) {
      /* ignore */
    }
    // Identity can be pinned via deep-link params (handy for sharing a named
    // session and for deterministic multi-client testing); otherwise it is a
    // stable per-browser id persisted in localStorage.
    this.userId =
      this.urlParam("rpuid") || this.loadOrCreate(UID_KEY, randomId());
    this.displayName =
      this.urlParam("rpname") || this.loadOrCreateName();
    this.emoji =
      this.urlParam("rpemoji") || this.loadOrCreate(EMOJI_KEY, randomEmoji());
  }

  private loadOrCreateName(): string {
    try {
      const existing = window.localStorage.getItem(NAME_KEY);
      // Migrate the old "Reader-xxxx" ids to a friendly adjective-noun name.
      if (existing && !existing.startsWith("Reader-")) return existing;
      const name = friendlyName();
      window.localStorage.setItem(NAME_KEY, name);
      return name;
    } catch (e) {
      return friendlyName();
    }
  }

  private urlParam(name: string): string | null {
    try {
      const href = window.location.href;
      const qIndex = href.indexOf("?");
      if (qIndex === -1) return null;
      return new URLSearchParams(href.substring(qIndex + 1)).get(name);
    } catch (e) {
      return null;
    }
  }

  private loadOrCreate(key: string, fallback: string): string {
    try {
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      window.localStorage.setItem(key, fallback);
    } catch (e) {
      /* localStorage may be unavailable */
    }
    return fallback;
  }

  getUserId(): string {
    return this.userId;
  }

  getDisplayName(): string {
    return this.displayName;
  }

  getEmoji(): string {
    return this.emoji;
  }

  setDisplayName(name: string) {
    if (!name) return;
    this.displayName = name;
    try {
      window.localStorage.setItem(NAME_KEY, name);
    } catch (e) {
      /* ignore */
    }
    this.identityChanged();
  }

  setEmoji(emoji: string) {
    if (!emoji) return;
    this.emoji = emoji;
    try {
      window.localStorage.setItem(EMOJI_KEY, emoji);
    } catch (e) {
      /* ignore */
    }
    this.identityChanged();
  }

  private identityChanged() {
    if (this.channel && this.status === "joined") {
      // Presence track is how others learn the new name/emoji live.
      this.trackPresence();
      this.registerMembershipDb();
    }
    this.emit();
  }

  private participantList(): ParticipantState[] {
    const list = Array.from(this.participants.values());
    list.sort((a, b) => {
      if (a.online !== b.online) return a.online ? -1 : 1;
      return (a.displayName || "").localeCompare(b.displayName || "");
    });
    return list;
  }

  getSnapshot(): ReadPartySnapshot {
    const participants = this.participantList();
    return {
      status: this.status,
      roomCode: this.roomCode,
      userId: this.userId,
      displayName: this.displayName,
      emoji: this.emoji,
      bookMd5: this.bookMd5,
      bookTitle: this.bookTitle,
      participants,
      partner: participants[0] || null,
      myPosition: this.myPosition,
    };
  }

  // Subscribe to any state change. Returns an unsubscribe function.
  subscribe(cb: (snap: ReadPartySnapshot) => void): () => void {
    this.listeners.add(cb);
    cb(this.getSnapshot());
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    const snap = this.getSnapshot();
    this.listeners.forEach((cb) => {
      try {
        cb(snap);
      } catch (e) {
        /* ignore listener errors */
      }
    });
  }

  getParticipants(): ParticipantState[] {
    return this.participantList();
  }

  // Deprecated: 2-person era API. Returns the first other participant.
  getPartner(): ParticipantState | null {
    return this.participantList()[0] || null;
  }

  getRoom(): string | null {
    return this.roomCode;
  }

  getStatus(): ReadPartyStatus {
    return this.status;
  }

  // Join (or create) a room. Enforces the room-size cap via presence.
  async join(opts: JoinOptions): Promise<ReadPartyStatus> {
    const code = (opts.roomCode || "").trim();
    if (!code) return "error";

    // Already in this room: just update book metadata.
    if (this.roomCode === code && this.status === "joined") {
      if (opts.bookMd5) this.bookMd5 = opts.bookMd5;
      if (opts.bookTitle) this.bookTitle = opts.bookTitle;
      this.emit();
      return "joined";
    }

    await this.leave();

    if (opts.displayName) this.setDisplayName(opts.displayName);
    if (opts.emoji) this.setEmoji(opts.emoji);
    this.roomCode = code;
    this.bookMd5 = opts.bookMd5 || null;
    this.bookTitle = opts.bookTitle || null;
    this.participants = new Map();
    this.othersOnline = 0;
    this.status = "connecting";
    this.emit();

    const supabase = getSupabase();
    const channel = supabase.channel("readparty:" + code, {
      config: {
        presence: { key: this.userId },
        broadcast: { self: false },
      },
    });
    this.channel = channel;

    channel.on("broadcast", { event: "position" }, ({ payload }) => {
      this.handleIncomingPosition(payload);
    });
    channel.on("presence", { event: "sync" }, () => {
      this.updateParticipantsFromPresence();
    });
    channel.on("presence", { event: "leave" }, () => {
      this.updateParticipantsFromPresence();
    });
    // Authoritative live feed: every upsert to `positions` in this room is
    // pushed here. Reliable and order/join-independent (unlike broadcast).
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "positions",
        filter: "room_code=eq." + code,
      },
      (payload: any) => {
        const row = payload.new;
        if (!row || row.user_id === this.userId) return;
        this.applyParticipantUpdate(
          {
            userId: row.user_id,
            position: row.position_json,
            at: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
          },
          "postgres"
        );
      }
    );

    return new Promise<ReadPartyStatus>((resolve) => {
      let settled = false;
      const finalize = (result: ReadPartyStatus) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      // Decide capacity on the first presence sync (before we track),
      // so an overflow reader never even registers presence.
      const decide = () => {
        if (settled) return;
        const others = this.otherPresenceKeys();
        if (others.length >= MAX_ROOM_SIZE - 1) {
          this.status = "full";
          this.emit();
          try {
            channel.unsubscribe();
          } catch (e) {
            /* ignore */
          }
          this.channel = null;
          this.roomCode = null;
          finalize("full");
        } else {
          this.becomeMember();
          finalize("joined");
        }
      };

      channel.on("presence", { event: "sync" }, decide);

      channel.subscribe((subStatus) => {
        if (subStatus === "CHANNEL_ERROR" || subStatus === "TIMED_OUT") {
          this.status = "error";
          this.emit();
          finalize("error");
        }
      });

      // Fallback: if no presence sync arrived, assume an empty room.
      setTimeout(decide, PRESENCE_SYNC_TIMEOUT_MS);
    });
  }

  private otherPresenceKeys(): string[] {
    if (!this.channel) return [];
    try {
      const state = this.channel.presenceState() as Record<string, any>;
      return Object.keys(state).filter((k) => k !== this.userId);
    } catch (e) {
      return [];
    }
  }

  private becomeMember() {
    this.status = "joined";
    this.lastActivityAt = Date.now();
    this.trackPresence();
    this.updateParticipantsFromPresence();
    this.registerMembershipDb();
    this.pullParticipantsFromDb();
    this.startHeartbeat();
    this.emit();
  }

  private trackPresence() {
    if (!this.channel) return;
    try {
      this.channel.track({
        user_id: this.userId,
        display_name: this.displayName,
        emoji: this.emoji,
        position: this.myPosition,
        book_md5: this.bookMd5,
        online_at: Date.now(),
      });
    } catch (e) {
      /* ignore */
    }
  }

  // Merge a participant update from any source (broadcast, presence,
  // postgres change-event, DB pull). The position is only replaced when the
  // incoming sender-clock timestamp is at least as new as what we already
  // have, so a slow source can never roll someone's progress backwards.
  private applyParticipantUpdate(
    update: {
      userId: string;
      displayName?: string;
      emoji?: string;
      online?: boolean;
      position?: ReadPartyPosition | null;
      at?: number;
    },
    source: string = "unknown"
  ) {
    const prev = this.participants.get(update.userId) || null;
    const at = update.at || 0;
    let position = prev ? prev.position : null;
    let positionAt = prev ? prev.positionAt || 0 : 0;
    if (update.position && at >= positionAt) {
      position = update.position;
      positionAt = at || Date.now();
      this.recordSync(source, at, position);
    }
    this.participants.set(update.userId, {
      userId: update.userId,
      displayName:
        update.displayName || (prev && prev.displayName) || "Reader",
      emoji: update.emoji || (prev && prev.emoji) || "\u{1F4D6}",
      position,
      online:
        update.online !== undefined ? update.online : prev ? prev.online : false,
      lastSeen: at || Date.now(),
      positionAt,
    });
    this.emit();
  }

  private updateParticipantsFromPresence() {
    if (!this.channel) return;
    let state: Record<string, any[]> = {};
    try {
      state = this.channel.presenceState() as Record<string, any[]>;
    } catch (e) {
      return;
    }
    const otherKeys = Object.keys(state).filter((k) => k !== this.userId);
    const wasSolo = this.othersOnline === 0;
    this.othersOnline = otherKeys.length;

    // Mark known participants who dropped out of presence as offline (keep
    // their last position so ahead/behind still renders).
    const onlineSet = new Set(otherKeys);
    let changed = false;
    this.participants.forEach((p, key) => {
      if (!onlineSet.has(key) && p.online) {
        this.participants.set(key, { ...p, online: false });
        changed = true;
      }
    });
    if (changed) this.emit();

    otherKeys.forEach((key) => {
      const metas = state[key] || [];
      const meta = metas[metas.length - 1] || {};
      this.applyParticipantUpdate(
        {
          userId: key,
          displayName: meta.display_name,
          emoji: meta.emoji,
          position: meta.position,
          online: true,
          at: meta.online_at,
        },
        "presence"
      );
    });

    // Waking from solo mode: someone just arrived. Re-assert our presence
    // payload (it may hold a stale position) so they see where we are now.
    if (wasSolo && this.othersOnline > 0 && this.status === "joined") {
      this.trackPresence();
      this.scheduleDbUpsert();
    }
  }

  private handleIncomingPosition(payload: any) {
    if (!payload || payload.user_id === this.userId) return;
    this.applyParticipantUpdate(
      {
        userId: payload.user_id,
        displayName: payload.display_name,
        emoji: payload.emoji,
        position: payload.position,
        online: true,
        at: payload.at,
      },
      "broadcast"
    );
  }

  private recordSync(source: string, at: number, position: ReadPartyPosition) {
    const recv = Date.now();
    const deltaMs = at ? recv - at : 0;
    this.metrics.applied += 1;
    this.metrics.bySource[source] = (this.metrics.bySource[source] || 0) + 1;
    this.metrics.lastDeltaMs = deltaMs;
    this.metrics.samples.push({
      source,
      at,
      recv,
      deltaMs,
      pct: position && (position.percentage as string),
    });
    if (this.metrics.samples.length > 200) this.metrics.samples.shift();
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(
        `[ReadParty] recv via ${source} \u0394${deltaMs}ms pct=${
          position && position.percentage
        }`
      );
    }
  }

  // Latency / sync metrics. deltaMs = receiver_now - writer_at; this is exact
  // when both clients share a clock (two tabs on one machine) and includes
  // clock skew across separate devices.
  getMetrics() {
    const deltas = this.metrics.samples.map((s) => s.deltaMs);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pick = (q: number) =>
      sorted.length ? sorted[Math.floor((sorted.length - 1) * q)] : null;
    const avg = deltas.length
      ? Math.round(deltas.reduce((a, b) => a + b, 0) / deltas.length)
      : null;
    return {
      applied: this.metrics.applied,
      published: this.metrics.published,
      bySource: this.metrics.bySource,
      lastDeltaMs: this.metrics.lastDeltaMs,
      avgDeltaMs: avg,
      p50DeltaMs: pick(0.5),
      p95DeltaMs: pick(0.95),
      recentSamples: this.metrics.samples.slice(-20),
      note: "deltaMs = receiver_now - writer_at (exact on one machine; includes clock skew across devices)",
    };
  }

  setDebug(on: boolean) {
    this.debug = !!on;
    try {
      window.localStorage.setItem("readparty_debug", on ? "1" : "0");
    } catch (e) {
      /* ignore */
    }
  }

  // Publish my current reading position to the room (live + durable).
  publishPosition(position: ReadPartyPosition) {
    this.myPosition = position;
    this.lastActivityAt = Date.now();
    if (!this.channel || this.status !== "joined") {
      this.emit();
      return;
    }
    // Solo mode: nobody is connected to hear a broadcast, so skip the
    // realtime sends entirely; the throttled DB upsert (free REST write)
    // keeps the position durable for anyone who joins later.
    if (this.othersOnline === 0) {
      this.scheduleDbUpsert();
      this.emit();
      return;
    }
    this.metrics.published += 1;
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log(
        `[ReadParty] publish pct=${position && position.percentage} at=${Date.now()}`
      );
    }
    try {
      this.channel.send({
        type: "broadcast",
        event: "position",
        payload: {
          user_id: this.userId,
          display_name: this.displayName,
          emoji: this.emoji,
          position,
          at: Date.now(),
        },
      });
    } catch (e) {
      /* ignore transient send errors */
    }
    this.trackPresence();
    this.scheduleDbUpsert();
    this.emit();
  }

  private scheduleDbUpsert() {
    const now = Date.now();
    const elapsed = now - this.lastDbUpsertAt;
    if (elapsed >= DB_UPSERT_THROTTLE_MS) {
      this.upsertPositionDb();
    } else if (!this.dbUpsertTimer) {
      this.dbUpsertTimer = setTimeout(() => {
        this.dbUpsertTimer = null;
        this.upsertPositionDb();
      }, DB_UPSERT_THROTTLE_MS - elapsed);
    }
  }

  private async upsertPositionDb() {
    if (!this.roomCode || !this.myPosition) return;
    this.lastDbUpsertAt = Date.now();
    const pos = this.myPosition;
    try {
      await getSupabase()
        .from("positions")
        .upsert(
          {
            room_code: this.roomCode,
            user_id: this.userId,
            cfi: pos.cfi || null,
            chapter_title: pos.chapterTitle || null,
            percentage: pos.percentage != null ? String(pos.percentage) : null,
            position_json: pos,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_code,user_id" }
        );
    } catch (e) {
      /* offline / RLS errors are non-fatal for live sync */
    }
  }

  private async registerMembershipDb() {
    if (!this.roomCode) return;
    try {
      await getSupabase().rpc("join_room", {
        p_code: this.roomCode,
        p_user_id: this.userId,
        p_display_name: this.displayName,
        p_book_md5: this.bookMd5,
        p_book_title: this.bookTitle,
        p_emoji: this.emoji,
      });
    } catch (e) {
      /* non-fatal: presence is the source of truth for the cap */
    }
  }

  // Reconcile everyone's position from the authoritative DB rows. Runs on
  // join and on every heartbeat, so all sides converge to the latest position
  // even if a realtime push was missed, throttled, or arrived out of order.
  // Online/offline is left to presence; this only advances positions (guarded
  // by the writer-clock timestamp so they never move backwards).
  private async pullParticipantsFromDb() {
    if (!this.roomCode) return;
    try {
      const { data } = await getSupabase()
        .from("positions")
        .select("user_id, position_json, updated_at")
        .eq("room_code", this.roomCode)
        .neq("user_id", this.userId);
      if (data) {
        data.forEach((row: any) => {
          this.applyParticipantUpdate(
            {
              userId: row.user_id,
              position: row.position_json || null,
              at: row.updated_at ? Date.parse(row.updated_at) : 0,
            },
            "pull"
          );
        });
      }
    } catch (e) {
      /* ignore */
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.roomCode || this.status !== "joined") return;
      // Go silent when the tab is hidden or the reader has been idle: we stay
      // subscribed (so we still RECEIVE others' updates) but stop spending
      // write/realtime quota. A forgotten or backgrounded tab therefore
      // costs ~nothing. We resume automatically on the next flip.
      const hidden = typeof document !== "undefined" && document.hidden;
      const idle = Date.now() - this.lastActivityAt > IDLE_TIMEOUT_MS;
      if (hidden || idle) return;
      // Keep membership fresh (a DB write, not a realtime message).
      getSupabase()
        .from("room_members")
        .update({ last_seen: new Date().toISOString() })
        .eq("room_code", this.roomCode)
        .eq("user_id", this.userId)
        .then(
          () => {},
          () => {}
        );
      // Reconcile everyone from the authoritative DB rows (a read, not a
      // realtime message). Live flips are delivered by broadcast + postgres
      // change-events, so we no longer re-broadcast an unchanged position.
      this.pullParticipantsFromDb();
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async leave() {
    this.stopHeartbeat();
    if (this.dbUpsertTimer) {
      clearTimeout(this.dbUpsertTimer);
      this.dbUpsertTimer = null;
    }
    if (this.channel) {
      try {
        await this.channel.unsubscribe();
      } catch (e) {
        /* ignore */
      }
      this.channel = null;
    }
    this.status = "idle";
    this.roomCode = null;
    this.participants = new Map();
    this.othersOnline = 0;
    this.emit();
  }
}

const readParty = new ReadPartyManager();

export default readParty;
