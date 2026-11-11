import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Quiz } from "./practice/drills.jsx";
import { Icon } from "./App.jsx";
import { GlowTile, Reveal } from "../bits/fx.jsx";

// What each exercise is, for the bento grid on wide screens.
const MODE_INFO = {
  study: { icon: "🧠", text: "Spaced repetition: recall, then grade yourself" },
  write: { icon: "✍️", text: "Type the German from the English" },
  build: { icon: "🧩", text: "Sentence patterns, piece by piece" },
  connectors: { icon: "🔗", text: "Join sentences with weil, obwohl, dass…" },
  flash: { icon: "🃏", text: "Flip through the cards" },
  quiz: { icon: "🎯", text: "Pick the right meaning" },
  articles: { icon: "📰", text: "der, die or das?" },
  sep: { icon: "✂️", text: "Which prefix goes where?" },
  cloze: { icon: "🕳️", text: "Fill the gap in a real sentence" },
  mistakes: { icon: "🔁", text: "The words you missed" },
  add: { icon: "➕", text: "Add a word to your list" },
};

// The exercises as a grid of glowing tiles (wide screens; phones keep the tab strip).
export function ModeBento({ mode, setMode, mistakeCount }) {
  return (
    <div className="bento" role="tablist" aria-label="Exercises">
      {TABS.map((t, i) => {
        const info = MODE_INFO[t.id] ?? {};
        const on = mode === t.id;
        const label = t.id === "mistakes" && mistakeCount ? `${t.label} · ${mistakeCount}` : t.label.replace(/^\+ /, "");
        return (
          <Reveal key={t.id} delay={i * 0.03} distance={14} className={"bento-cell" + (t.id === "study" ? " bento-wide" : "")}>
            <GlowTile active={on} className={"bento-tile" + (on ? " on" : "")}>
              <button type="button" role="tab" aria-selected={on} onClick={() => setMode(t.id)} className="bento-button">
                <span className="bento-icon" aria-hidden="true">{info.icon}</span>
                <span className="bento-label">{label}</span>
                <span className="bento-text">{info.text}</span>
              </button>
            </GlowTile>
          </Reveal>
        );
      })}
    </div>
  );
}

// ---------- FRAME ----------
export const TABS = [
  { id: "study", label: "Study" },
  { id: "write", label: "Write" },
  { id: "build", label: "Patterns" },
  { id: "connectors", label: "Connectors" },
  { id: "flash", label: "Cards" },
  { id: "quiz", label: "Quiz" },
  { id: "articles", label: "Articles" },
  { id: "sep", label: "Separable verbs" },
  { id: "cloze", label: "Fill-in" },
  { id: "mistakes", label: "Review" },
  { id: "add", label: "+ Add word" },
];

export function TabBar({ mode, setMode, mistakeCount }) {
  const stripRef = useRef(null);
  useEffect(() => {
    if (!stripRef.current) return;
    const el = stripRef.current.querySelector('[data-on="1"]');
    if (el && el.scrollIntoView) el.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [mode]);
  const tabLabel = (t) => (t.id === "mistakes" && mistakeCount ? `${t.label} ${mistakeCount}` : t.label);
  const pill = (on, isMistakes) => ({
    flex: "0 0 auto", scrollSnapAlign: "center", whiteSpace: "nowrap", fontFamily: "var(--font-serif)", fontSize: "13px", fontWeight: on ? 600 : 500,
    padding: "8px 14px", border: "none", borderRadius: "8px",
    background: on ? "var(--paper-raised)" : "transparent", color: on ? "var(--ink)" : isMistakes && mistakeCount ? "var(--bad)" : "var(--ink-soft)",
    boxShadow: on ? "0 1px 2px rgba(15,23,42,.08), 0 0 0 1px var(--line)" : "none", cursor: "pointer",
  });
  return (
    <div ref={stripRef} className="tabstrip" role="tablist" aria-label="Exercises" style={{
      display: "flex", gap: "2px", alignItems: "center", width: "100%", boxSizing: "border-box", padding: "3px", background: "var(--tint)",
      borderRadius: "11px", overflowX: "auto", scrollSnapType: "x proximity",
    }}>
      {TABS.map((t) => (
        <button key={t.id} role="tab" aria-selected={mode === t.id} data-on={mode === t.id ? "1" : "0"} onClick={() => setMode(t.id)} style={pill(mode === t.id, t.id === "mistakes")}>{tabLabel(t)}</button>
      ))}
    </div>
  );
}

// Talkloop, the speaking-practice app, is part of this app (at /talkloop/). It
// reads this learner's learnt words and keeps its mistake log with the login session kept in this browser.
// It opens as a tab next to Rules, in a frame, so no reload is needed.

// The logged-in user as a round initial; click for their email and "Sign out".
export function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  const email = user.email || "";
  const initial = (email.trim()[0] || "?").toUpperCase();
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="avatar-btn" onClick={() => setOpen((o) => !o)} aria-label={"Account: " + email} aria-expanded={open} title={email}>{initial}</button>
      {open && (
        <div role="menu" className="menu">
          <div className="menu-head"><small>Signed in as</small><div>{email}</div></div>
          <button role="menuitem" className="danger" onClick={() => { setOpen(false); onLogout(); }}><Icon name="logout" />Sign out</button>
        </div>
      )}
    </div>
  );
}

// The Rules page: fixed content, no call. Each group has headlines; under each
// headline come its blocks — `formulas` (rows: the rule, then what it does),
// `cases` (Cases × M / F / N / Plural, like a grammar-book chart) or `table`.
