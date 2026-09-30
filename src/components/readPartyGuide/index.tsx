import React, { useCallback, useEffect, useState } from "react";
import { isElectron } from "react-device-detect";
import DatabaseService from "../../utils/storage/databaseService";
import "./index.css";

declare var window: any;

const STORAGE_KEY = "rp_guide_collapsed";

const goToParty = () => {
  const origin = window.location.href.split("#")[0];
  window.location.href = `${origin}#/party`;
};

const goToJoin = (code: string) => {
  const clean = code.trim().toUpperCase();
  if (!clean) return;
  const origin = window.location.href.split("#")[0];
  window.location.href = `${origin}#/party?room=${encodeURIComponent(clean)}`;
};

// Reuse Koodo's existing hidden file input so the full import pipeline runs.
const triggerImport = () => {
  const input = document.getElementById(
    "import-book-box"
  ) as HTMLInputElement | null;
  if (input) {
    input.click();
  }
};

const ReadPartyGuide: React.FC = () => {
  const [collapsed, setCollapsed] = useState<boolean>(
    () => localStorage.getItem(STORAGE_KEY) === "1"
  );
  const [bookCount, setBookCount] = useState<number>(0);
  const [joinCode, setJoinCode] = useState<string>("");

  const refreshCount = useCallback(async () => {
    try {
      const all: any[] = await DatabaseService.getAllRecords("books");
      setBookCount((all || []).length);
    } catch (e) {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const onFocus = () => refreshCount();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(refreshCount, 3000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refreshCount]);

  const setCollapsedPersist = (value: boolean) => {
    setCollapsed(value);
    localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
  };

  const hasBooks = bookCount > 0;

  if (collapsed) {
    return (
      <button
        className="rp-guide-tab"
        onClick={() => setCollapsedPersist(false)}
        aria-label="Open ReadParty guide"
      >
        <span className="rp-guide-tab-icon">✦</span>
        <span className="rp-guide-tab-text">ReadParty guide</span>
      </button>
    );
  }

  return (
    <aside className="rp-guide">
      <div className="rp-guide-header">
        <div>
          <div className="rp-guide-title">ReadParty</div>
          <div className="rp-guide-subtitle">Read a book together, in sync</div>
        </div>
        <button
          className="rp-guide-close"
          onClick={() => setCollapsedPersist(true)}
          aria-label="Hide guide"
        >
          ✕
        </button>
      </div>

      <ol className="rp-guide-steps">
        <li className={`rp-guide-step ${hasBooks ? "done" : ""}`}>
          <div className="rp-guide-step-num">{hasBooks ? "✓" : "1"}</div>
          <div className="rp-guide-step-body">
            <div className="rp-guide-step-title">Upload a book</div>
            <div className="rp-guide-step-desc">
              Add an EPUB (PDF, MOBI and AZW3 work too). It stays in this
              browser only.
            </div>
            <button className="rp-guide-btn primary" onClick={triggerImport}>
              {hasBooks ? "Upload another book" : "Upload a book"}
            </button>
            {hasBooks && (
              <div className="rp-guide-hint">
                {bookCount} book{bookCount > 1 ? "s" : ""} in your library
              </div>
            )}
          </div>
        </li>

        <li className="rp-guide-step">
          <div className="rp-guide-step-num">2</div>
          <div className="rp-guide-step-body">
            <div className="rp-guide-step-title">Open it &amp; start a party</div>
            <div className="rp-guide-step-desc">
              Pick your book, get a room code, and open the reader together.
            </div>
            <button
              className="rp-guide-btn"
              onClick={goToParty}
              disabled={!hasBooks}
            >
              Start a ReadParty
            </button>
            {!hasBooks && (
              <div className="rp-guide-hint">Upload a book first.</div>
            )}
          </div>
        </li>

        <li className="rp-guide-step">
          <div className="rp-guide-step-num">3</div>
          <div className="rp-guide-step-body">
            <div className="rp-guide-step-title">Share the link</div>
            <div className="rp-guide-step-desc">
              On the party screen, copy the invite link and send it to your
              friends. Anyone who opens it joins the same room — then you all
              see each other's page live.
            </div>
          </div>
        </li>
      </ol>

      <div className="rp-guide-join">
        <div className="rp-guide-join-label">Got a code from a friend?</div>
        <div className="rp-guide-join-row">
          <input
            className="rp-guide-join-input"
            placeholder="CODE"
            value={joinCode}
            maxLength={12}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") goToJoin(joinCode);
            }}
          />
          <button
            className="rp-guide-btn"
            onClick={() => goToJoin(joinCode)}
            disabled={!joinCode.trim()}
          >
            Join room
          </button>
        </div>
      </div>

      <div className="rp-guide-footer">
        Invited friends get the book automatically — just share the link.
      </div>
    </aside>
  );
};

// Only render in real browsers (web mode); the desktop app has its own flow.
const ReadPartyGuideGate: React.FC = () =>
  isElectron ? null : <ReadPartyGuide />;

export default ReadPartyGuideGate;
