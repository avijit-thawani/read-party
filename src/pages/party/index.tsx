import React, { useEffect, useMemo, useState } from "react";
import DatabaseService from "../../utils/storage/databaseService";
import { importBookFromUrl } from "../../utils/sync/devImport";
import { uploadHostedBook, importHostedBook } from "../../utils/sync/hostedBooks";
import { generateRoomCode } from "../../utils/sync/roomCode";
import "./index.css";

declare var window: any;

type BookLite = {
  key: string;
  name: string;
  format: string;
  md5: string;
};

// Parse a query param from the hash-router URL (e.g. .../#/party?room=X&md5=Y),
// reading only the segment after the hash so a base-URL query can't confuse it.
const getParam = (name: string): string | null => {
  const href = window.location.href;
  const hash = href.indexOf("#") === -1 ? href : href.substring(href.indexOf("#"));
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return null;
  try {
    return new URLSearchParams(hash.substring(qIndex + 1)).get(name);
  } catch (e) {
    return null;
  }
};

const generateCode = generateRoomCode;

const Party: React.FC = () => {
  const [books, setBooks] = useState<BookLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [roomCode, setRoomCode] = useState<string>("");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const inviteMd5 = useMemo(() => getParam("md5"), []);
  // "share link only" state
  const [hostStatus, setHostStatus] = useState<
    "idle" | "uploading" | "hosted" | "error"
  >("idle");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const room = getParam("room");
    setRoomCode((room || generateCode()).toUpperCase());
    // Dev/E2E helper: seed a book from a served URL without a file picker.
    window.__readpartyImport = importBookFromUrl;
  }, []);

  const loadBooks = async (): Promise<BookLite[]> => {
    const all: any[] = await DatabaseService.getAllRecords("books");
    const lite: BookLite[] = (all || []).map((b) => ({
      key: b.key,
      name: b.name,
      format: b.format,
      md5: b.md5,
    }));
    setBooks(lite);
    return lite;
  };

  useEffect(() => {
    (async () => {
      try {
        const lite = await loadBooks();
        // Preselect via invite md5, else first book.
        if (inviteMd5) {
          const match = lite.find((b) => b.md5 === inviteMd5);
          if (match) setSelectedKey(match.key);
        } else if (lite.length > 0) {
          setSelectedKey(lite[0].key);
        }
      } catch (e) {
        /* ignore */
      } finally {
        setLoading(false);
      }
    })();
  }, [inviteMd5]);

  const selectedBook = books.find((b) => b.key === selectedKey) || null;
  const inviteBookMissing =
    !!inviteMd5 && !books.some((b) => b.md5 === inviteMd5);

  // Host side: upload the selected book so the invite link works on its own.
  useEffect(() => {
    if (!selectedBook || loading) return;
    let cancelled = false;
    setHostStatus("uploading");
    uploadHostedBook(selectedBook)
      .then((ok) => {
        if (!cancelled) setHostStatus(ok ? "hosted" : "error");
      })
      .catch(() => {
        if (!cancelled) setHostStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedBook, loading]);

  // Partner side: if they opened an invite for a book they don't have,
  // fetch + import it automatically from hosted storage.
  useEffect(() => {
    if (loading || !inviteMd5 || !inviteBookMissing || importing) return;
    let cancelled = false;
    setImporting(true);
    setImportError("");
    importHostedBook(inviteMd5)
      .then(async (res) => {
        if (cancelled) return;
        if (res) {
          const lite = await loadBooks();
          const match = lite.find((b) => b.md5 === inviteMd5);
          if (match) setSelectedKey(match.key);
        } else {
          setImportError(
            "Couldn't fetch the shared book. Ask the person who invited you to open it once, then retry."
          );
        }
      })
      .catch(() => {
        if (!cancelled)
          setImportError("Couldn't fetch the shared book. Please retry.");
      })
      .finally(() => {
        // Not gated on `cancelled`: loadBooks() flips inviteBookMissing, which
        // cancels this effect before it settles and would strand the spinner.
        setImporting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loading, inviteMd5, inviteBookMissing, retryToken]);

  const startReading = () => {
    if (!selectedBook || !roomCode) return;
    const ref = selectedBook.format.toLowerCase();
    const origin = window.location.href.split("#")[0];
    const url =
      `${origin}#/${ref}/${selectedBook.key}` +
      `?title=${encodeURIComponent(selectedBook.name)}` +
      `&file=${selectedBook.key}` +
      `&party=${encodeURIComponent(roomCode)}`;
    window.location.href = url;
  };

  // Invitees should land in the room, not on a form: until the reader opens
  // they aren't in the channel and the host sees nobody.
  useEffect(() => {
    if (!inviteMd5 || !getParam("room") || importing) return;
    if (selectedBook && selectedBook.md5 === inviteMd5) startReading();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteMd5, selectedBook, importing]);

  const inviteLink = useMemo(() => {
    if (!roomCode) return "";
    const origin = window.location.href.split("#")[0];
    const md5Part = selectedBook ? `&md5=${selectedBook.md5}` : "";
    return `${origin}#/party?room=${roomCode}${md5Part}`;
  }, [roomCode, selectedBook]);

  const copyInvite = () => {
    try {
      navigator.clipboard.writeText(inviteLink);
    } catch (e) {
      /* ignore */
    }
  };

  return (
    <div className="party-page">
      <div className="party-card">
        <h1 className="party-title">ReadParty</h1>
        <p className="party-subtitle">
          Read the same book together, in sync, from different devices.
        </p>

        <label className="party-label">Room code</label>
        <div className="party-row">
          <input
            className="party-input party-code-input"
            value={roomCode}
            onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
            maxLength={12}
          />
          <button
            className="party-btn party-btn-secondary"
            onClick={() => setRoomCode(generateCode())}
          >
            New code
          </button>
        </div>

        <label className="party-label">Book</label>
        {loading ? (
          <div className="party-empty">Loading your library…</div>
        ) : importing ? (
          <div className="party-empty">Fetching the shared book…</div>
        ) : books.length === 0 ? (
          <div className="party-empty">
            No books yet. Add one in your library, then come back.
            <button
              className="party-btn party-btn-secondary"
              style={{ marginTop: 10 }}
              onClick={() => {
                window.location.href =
                  window.location.href.split("#")[0] + "#/manager/home";
              }}
            >
              Go to library
            </button>
          </div>
        ) : (
          <select
            className="party-input"
            value={selectedKey}
            onChange={(e) => setSelectedKey(e.target.value)}
          >
            {books.map((b) => (
              <option key={b.key} value={b.key}>
                {b.name} ({b.format})
              </option>
            ))}
          </select>
        )}

        {importError && (
          <div className="party-warning">
            {importError}
            <button
              className="party-btn party-btn-secondary"
              style={{ marginTop: 10 }}
              onClick={() => {
                setImportError("");
                setRetryToken((n) => n + 1);
              }}
            >
              Retry
            </button>
          </div>
        )}

        <button
          className="party-btn party-btn-primary"
          onClick={startReading}
          disabled={!selectedBook || !roomCode}
        >
          Start reading together
        </button>

        {inviteLink && (
          <div className="party-invite">
            <label className="party-label">Invite link</label>
            <div className="party-row">
              <input className="party-input" value={inviteLink} readOnly />
              <button
                className="party-btn party-btn-secondary"
                onClick={copyInvite}
              >
                Copy
              </button>
            </div>
            <p className="party-hint">
              {hostStatus === "uploading"
                ? "Preparing the book so your friends can open it automatically…"
                : hostStatus === "hosted"
                ? "Share this link. Friends open it and the book downloads automatically — no manual import."
                : hostStatus === "error"
                ? "Heads up: couldn't upload the book, so your friends may need to import the same file manually."
                : "Share this with friends to join the same room."}
            </p>
          </div>
        )}

        <div
          className="party-back"
          onClick={() => {
            window.location.href =
              window.location.href.split("#")[0] + "#/manager/home";
          }}
        >
          ← Back to library
        </div>
      </div>
    </div>
  );
};

export default Party;
