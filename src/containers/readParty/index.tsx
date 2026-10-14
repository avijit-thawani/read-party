import React, { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import readParty, {
  ReadPartySnapshot,
  ReadPartyPosition,
  ParticipantState,
  EMOJI_CHOICES,
  MAX_ROOM_SIZE,
} from "../../utils/sync/readParty";
import { uploadHostedBook } from "../../utils/sync/hostedBooks";
import "./index.css";

declare var window: any;

interface ReadPartyProps {
  htmlBook: any;
  currentBook: any;
}

const getQueryParam = (name: string): string | null => {
  const href = window.location.href;
  const hash =
    href.indexOf("#") === -1 ? href : href.substring(href.indexOf("#"));
  const qIndex = hash.indexOf("?");
  if (qIndex === -1) return null;
  try {
    return new URLSearchParams(hash.substring(qIndex + 1)).get(name);
  } catch (e) {
    return null;
  }
};

const formatPercentage = (pos: ReadPartyPosition | null): string => {
  if (!pos || pos.percentage == null) return "";
  const p = parseFloat(String(pos.percentage));
  if (isNaN(p)) return "";
  return (p * 100).toFixed(1) + "%";
};

const samePosition = (
  a: ReadPartyPosition | null,
  b: ReadPartyPosition | null
): boolean => {
  if (!a || !b) return false;
  if (a.cfi && b.cfi) return a.cfi === b.cfi;
  return (
    String(a.chapterDocIndex) === String(b.chapterDocIndex) &&
    String(a.percentage) === String(b.percentage)
  );
};

const ReadParty: React.FC<ReadPartyProps> = ({ htmlBook, currentBook }) => {
  const [snap, setSnap] = useState<ReadPartySnapshot>(
    readParty.getSnapshot()
  );
  const [collapsed, setCollapsed] = useState(false);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const preJoinPosition = useRef<ReadPartyPosition | null>(null);
  const [canReturn, setCanReturn] = useState(false);

  // Re-render on any sync state change.
  useEffect(() => {
    return readParty.subscribe(setSnap);
  }, []);

  // Leave the room (stop heartbeat + unsubscribe) when the reader closes or the
  // page unloads, so an abandoned session stops spending quota.
  useEffect(() => {
    const onUnload = () => {
      readParty.leave();
    };
    window.addEventListener("pagehide", onUnload);
    return () => {
      window.removeEventListener("pagehide", onUnload);
      readParty.leave();
    };
  }, []);

  // Attach our OWN rendition listeners (mirrors how OperationPanel/ProgressPanel
  // attach independent listeners) and wire deep-link auto-join + debug handle.
  useEffect(() => {
    const rendition = htmlBook && htmlBook.rendition;
    if (!rendition) return;

    const publish = () => {
      try {
        const pos = rendition.getPosition();
        if (pos) readParty.publishPosition(pos);
      } catch (e) {
        /* ignore */
      }
    };

    rendition.on("page-changed", publish);
    rendition.on("rendered", publish);
    const initialTimer = setTimeout(publish, 800);

    // Deep-link auto-join: /#/epub/<key>?...&party=<code>
    const partyCode = getQueryParam("party");
    if (partyCode) {
      readParty.join({
        roomCode: partyCode,
        bookMd5: currentBook && currentBook.md5,
        bookTitle: currentBook && currentBook.name,
      });
      // Ensure this book is hosted so the invite link works on its own,
      // even if the reader was opened directly (Phase 2).
      if (currentBook && currentBook.md5) {
        uploadHostedBook(currentBook);
      }
    }

    // Debug surface for headless E2E testing (no UI clicks needed).
    window.__readparty = {
      getPosition: () => rendition.getPosition(),
      goTo: (pos: ReadPartyPosition | string) =>
        rendition.goToPosition(
          typeof pos === "string" ? pos : JSON.stringify(pos)
        ),
      next: () => rendition.next(),
      prev: () => rendition.prev(),
      publish: (pos?: ReadPartyPosition) =>
        readParty.publishPosition(pos || rendition.getPosition()),
      join: (code: string) =>
        readParty.join({
          roomCode: code,
          bookMd5: currentBook && currentBook.md5,
          bookTitle: currentBook && currentBook.name,
        }),
      leave: () => readParty.leave(),
      getPartner: () => readParty.getPartner(),
      getParticipants: () => readParty.getParticipants(),
      setDisplayName: (name: string) => readParty.setDisplayName(name),
      setEmoji: (emoji: string) => readParty.setEmoji(emoji),
      getRoom: () => readParty.getRoom(),
      getStatus: () => readParty.getStatus(),
      getSnapshot: () => readParty.getSnapshot(),
      getMetrics: () => readParty.getMetrics(),
      setDebug: (on: boolean) => readParty.setDebug(on),
    };

    return () => {
      clearTimeout(initialTimer);
    };
  }, [htmlBook, currentBook]);

  const handleJoinParticipant = async (p: ParticipantState) => {
    if (!p || !p.position || !htmlBook) return;
    try {
      preJoinPosition.current = htmlBook.rendition.getPosition();
      setCanReturn(true);
      await htmlBook.rendition.goToPosition(JSON.stringify(p.position));
      toast.success("Jumped to " + (p.displayName || "them"));
    } catch (e) {
      toast.error("Could not jump there");
    }
  };

  const buildInviteLink = (): string => {
    const roomCode = snap.roomCode;
    if (!roomCode) return "";
    const origin = window.location.href.split("#")[0];
    const md5 = currentBook && currentBook.md5;
    const md5Part = md5 ? `&md5=${md5}` : "";
    return `${origin}#/party?room=${roomCode}${md5Part}`;
  };

  const handleCopyInvite = async () => {
    const link = buildInviteLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Invite link copied");
    } catch (e) {
      try {
        // Fallback for browsers without clipboard API / insecure context.
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        toast.success("Invite link copied");
      } catch (err) {
        toast.error("Couldn't copy link");
      }
    }
  };

  const handleReturn = async () => {
    if (!preJoinPosition.current || !htmlBook) return;
    try {
      await htmlBook.rendition.goToPosition(
        JSON.stringify(preJoinPosition.current)
      );
    } catch (e) {
      /* ignore */
    }
    setCanReturn(false);
    preJoinPosition.current = null;
  };

  const handleStartEditIdentity = () => {
    setNameDraft(snap.displayName);
    setEditingIdentity(true);
  };

  const handleSaveName = () => {
    const name = nameDraft.trim();
    if (name && name !== snap.displayName) {
      readParty.setDisplayName(name);
    }
  };

  // Only render when we're actually in a party (or trying to be).
  if (snap.status === "idle") return null;

  const participants = snap.participants;
  const onlineCount = participants.filter((p) => p.online).length + 1;

  if (collapsed) {
    return (
      <div
        className="readparty-card readparty-collapsed"
        onClick={() => setCollapsed(false)}
      >
        <div className="readparty-pill">
          <span
            className={
              "readparty-dot " +
              (participants.some((p) => p.online) ? "online" : "offline")
            }
          ></span>
          <span>
            ReadParty{onlineCount > 1 ? " \u00b7 " + onlineCount + " reading" : ""}
          </span>
        </div>
      </div>
    );
  }

  const myPct = formatPercentage(snap.myPosition);

  return (
    <div className="readparty-card">
      <div className="readparty-header">
        <div className="readparty-title">
          <span
            className={
              "readparty-dot " +
              (participants.some((p) => p.online) ? "online" : "offline")
            }
          ></span>
          ReadParty
        </div>
        <button
          className="readparty-collapse-toggle"
          onClick={() => setCollapsed(true)}
          title="Collapse"
        >
          –
        </button>
      </div>

      {snap.roomCode && (
        <div className="readparty-room-line">
          <span className="readparty-room">Room {snap.roomCode}</span>
          <button
            className="readparty-copy-link"
            onClick={handleCopyInvite}
            title="Copy invite link"
          >
            Copy link
          </button>
        </div>
      )}

      {snap.status === "connecting" && (
        <div className="readparty-status">Connecting…</div>
      )}

      {snap.status === "full" && (
        <div className="readparty-status readparty-full">
          Room is full ({MAX_ROOM_SIZE} readers max)
        </div>
      )}

      {snap.status === "joined" && (
        <>
          <div className="readparty-row-me">
            <span className="readparty-emoji">{snap.emoji}</span>
            <span className="readparty-name">
              {snap.displayName} <span className="readparty-you-tag">(you)</span>
            </span>
            <span className="readparty-pct">{myPct || "0.0%"}</span>
            <button
              className="readparty-edit-btn"
              onClick={handleStartEditIdentity}
              title="Change your name and emoji"
            >
              &#9998;
            </button>
          </div>

          {editingIdentity && (
            <div className="readparty-identity-editor">
              <input
                className="readparty-name-input"
                value={nameDraft}
                maxLength={24}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSaveName();
                    setEditingIdentity(false);
                  }
                }}
                placeholder="Your name"
              />
              <div className="readparty-emoji-grid">
                {EMOJI_CHOICES.map((em) => (
                  <button
                    key={em}
                    className={
                      "readparty-emoji-choice" +
                      (em === snap.emoji ? " selected" : "")
                    }
                    onClick={() => readParty.setEmoji(em)}
                  >
                    {em}
                  </button>
                ))}
              </div>
              <button
                className="readparty-btn"
                onClick={() => {
                  handleSaveName();
                  setEditingIdentity(false);
                }}
              >
                Done
              </button>
            </div>
          )}

          {participants.length > 0 ? (
            <div className="readparty-participants">
              {participants.map((p) => {
                const pct = formatPercentage(p.position);
                const chapter =
                  p.position && p.position.chapterTitle
                    ? p.position.chapterTitle
                    : "";
                const isTogether = samePosition(snap.myPosition, p.position);
                return (
                  <div
                    key={p.userId}
                    className={
                      "readparty-participant" + (p.online ? "" : " offline")
                    }
                  >
                    <div className="readparty-row-partner">
                      <span className="readparty-emoji">{p.emoji}</span>
                      <span className="readparty-name" title={p.displayName}>
                        {p.displayName}
                      </span>
                      <span className="readparty-pct">
                        {p.online ? pct || "0.0%" : "offline"}
                      </span>
                      <button
                        className="readparty-join-btn"
                        onClick={() => handleJoinParticipant(p)}
                        disabled={!p.position || isTogether}
                        title={
                          isTogether ? "You're together" : "Jump to their page"
                        }
                      >
                        {isTogether ? "\u2713" : "Join"}
                      </button>
                    </div>
                    {chapter && (
                      <div className="readparty-chapter">{chapter}</div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="readparty-waiting">
              <div className="readparty-status">Waiting for others…</div>
              <button
                className="readparty-btn readparty-btn-invite"
                onClick={handleCopyInvite}
              >
                Copy invite link
              </button>
              <div className="readparty-invite-hint">
                Send this so they can join the same room.
              </div>
            </div>
          )}

          {canReturn && (
            <div className="readparty-actions">
              <button
                className="readparty-btn readparty-btn-secondary"
                onClick={handleReturn}
              >
                Return to my page
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ReadParty;
