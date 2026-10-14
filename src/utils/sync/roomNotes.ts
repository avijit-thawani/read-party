import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "./supabaseClient";
import readParty from "./readParty";

// Shared notes/highlights for a ReadParty room.
//
// Unlike the reading position (an LWW register), notes are an append-only
// event stream: each row in `room_notes` is one note/highlight, keyed by
// (room_code, author_id, note_key). Postgres is the source of truth, so a
// member who was offline while others annotated simply catches up from the
// seed SELECT on their next join — no special offline logic.
//
// The note payload is Koodo's own Note shape (cfi/range/chapterIndex/...),
// minus the device-local bookKey; the receiving side remaps it onto its own
// bookKey for the same book (matched by md5, like positions).

export type SharedNotePayload = {
  key: string;
  chapter: string;
  chapterIndex: number;
  text: string;
  cfi: string;
  range: string;
  notes: string;
  percentage: string;
  color: string;
  tag: string[];
  date?: { year: number; month: number; day: number };
};

export type RemoteNote = {
  authorId: string;
  authorName: string;
  authorEmoji: string;
  noteKey: string;
  payload: SharedNotePayload;
  deleted: boolean;
  updatedAt: number;
};

// Convergence backstop: a throttled/backgrounded tab can miss realtime
// change-events, so we periodically re-read the room's rows from the DB
// (cheap REST read; notes are tiny and rare).
const NOTES_REPULL_MS = 10 * 1000;

class RoomNotesManager {
  private channel: RealtimeChannel | null = null;
  private roomCode: string | null = null;
  private bookMd5: string | null = null;
  private repullTimer: any = null;
  // Keyed by `${authorId}:${noteKey}` — includes my own rows and tombstones,
  // so re-publishes and deletes reconcile correctly.
  private notes: Map<string, RemoteNote> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    // Follow the room lifecycle automatically: whenever readParty joins a
    // room with a book, attach; when it leaves, detach.
    readParty.subscribe((snap) => {
      if (snap.status === "joined" && snap.roomCode && snap.bookMd5) {
        if (snap.roomCode !== this.roomCode || snap.bookMd5 !== this.bookMd5) {
          this.attach(snap.roomCode, snap.bookMd5);
        }
      } else if (this.roomCode) {
        this.detach();
      }
    });
  }

  isActive(): boolean {
    return !!this.roomCode;
  }

  // All live (non-deleted) notes authored by OTHERS, for rendering.
  getRemoteNotes(): RemoteNote[] {
    const me = readParty.getUserId();
    return Array.from(this.notes.values()).filter(
      (n) => !n.deleted && n.authorId !== me
    );
  }

  // Look up a remote (partner-authored) note by its note key — used by the
  // popup to decide whether a clicked highlight is read-only.
  getRemoteNoteByKey(noteKey: string): RemoteNote | null {
    if (!noteKey) return null;
    const me = readParty.getUserId();
    for (const n of this.notes.values()) {
      if (n.noteKey === noteKey && n.authorId !== me && !n.deleted) return n;
    }
    return null;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  private emit() {
    this.listeners.forEach((cb) => {
      try {
        cb();
      } catch (e) {
        /* ignore listener errors */
      }
    });
  }

  private async attach(roomCode: string, bookMd5: string) {
    this.detachChannel();
    this.roomCode = roomCode;
    this.bookMd5 = bookMd5;
    this.notes = new Map();

    const supabase = getSupabase();
    const channel = supabase.channel("readparty-notes:" + roomCode);
    this.channel = channel;
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "room_notes",
        filter: "room_code=eq." + roomCode,
      },
      (payload: any) => {
        this.applyRow(payload.new);
      }
    );
    channel.subscribe();

    await this.pullFromDb();
    this.repullTimer = setInterval(() => {
      this.pullFromDb();
    }, NOTES_REPULL_MS);
  }

  private detach() {
    this.detachChannel();
    if (this.repullTimer) {
      clearInterval(this.repullTimer);
      this.repullTimer = null;
    }
    this.roomCode = null;
    this.bookMd5 = null;
    this.notes = new Map();
    this.emit();
  }

  private detachChannel() {
    if (this.channel) {
      try {
        this.channel.unsubscribe();
      } catch (e) {
        /* ignore */
      }
      this.channel = null;
    }
  }

  // Offline catch-up: everything ever annotated in this room+book.
  private async pullFromDb() {
    if (!this.roomCode || !this.bookMd5) return;
    try {
      const { data } = await getSupabase()
        .from("room_notes")
        .select(
          "author_id, author_name, author_emoji, note_key, payload, deleted, updated_at"
        )
        .eq("room_code", this.roomCode)
        .eq("book_md5", this.bookMd5);
      if (data) {
        data.forEach((row: any) => this.applyRow(row, false));
        this.emit();
      }
    } catch (e) {
      /* non-fatal: change-events still deliver going forward */
    }
  }

  private applyRow(row: any, emit: boolean = true) {
    if (!row || !row.note_key) return;
    // Change-events are filtered by room only; skip rows for other books.
    // (Seed-pull rows omit book_md5 since the query already filtered on it.)
    if (row.book_md5 !== undefined && row.book_md5 !== this.bookMd5) return;
    const key = row.author_id + ":" + row.note_key;
    // Skip no-op updates so listeners (which redraw the book overlay and can
    // disturb an in-progress text selection) only fire on real changes.
    const prev = this.notes.get(key);
    if (
      prev &&
      prev.deleted === !!row.deleted &&
      JSON.stringify(prev.payload) === JSON.stringify(row.payload || {})
    ) {
      return;
    }
    this.notes.set(key, {
      authorId: row.author_id,
      authorName: row.author_name || "Reader",
      authorEmoji: row.author_emoji || "\u{1F4D6}",
      noteKey: row.note_key,
      payload: row.payload || {},
      deleted: !!row.deleted,
      updatedAt: row.updated_at ? Date.parse(row.updated_at) : Date.now(),
    });
    if (emit) this.emit();
  }

  // Publish (create or edit) one of MY notes to the room. `note` is Koodo's
  // Note object; bookKey is stripped since it's device-local.
  async publishNote(note: any) {
    if (!this.roomCode || !this.bookMd5 || !note || !note.key) return;
    const payload: SharedNotePayload = {
      key: note.key,
      chapter: note.chapter,
      chapterIndex: note.chapterIndex,
      text: note.text,
      cfi: note.cfi,
      range: note.range,
      notes: note.notes || "",
      percentage: note.percentage,
      color: note.color,
      tag: note.tag || [],
      date: note.date,
    };
    try {
      await getSupabase()
        .from("room_notes")
        .upsert(
          {
            room_code: this.roomCode,
            book_md5: this.bookMd5,
            author_id: readParty.getUserId(),
            author_name: readParty.getDisplayName(),
            author_emoji: readParty.getEmoji(),
            note_key: note.key,
            payload,
            deleted: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "room_code,author_id,note_key" }
        );
    } catch (e) {
      /* offline: local note still saved; not retried in v1 */
    }
  }

  // Tombstone one of MY notes (kept as a row so late joiners converge).
  async deleteNote(noteKey: string) {
    if (!this.roomCode || !noteKey) return;
    try {
      await getSupabase()
        .from("room_notes")
        .update({ deleted: true, updated_at: new Date().toISOString() })
        .eq("room_code", this.roomCode)
        .eq("author_id", readParty.getUserId())
        .eq("note_key", noteKey);
    } catch (e) {
      /* ignore */
    }
  }
}

const roomNotes = new RoomNotesManager();

// Debug handle alongside window.__readparty
try {
  (window as any).__readpartyNotes = roomNotes;
} catch (e) {
  /* ignore */
}

export default roomNotes;
