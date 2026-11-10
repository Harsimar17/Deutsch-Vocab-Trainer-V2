import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { api } from "../lib/api.js";
import { useContent } from "../lib/content.js";
import { DrillError, Loading, SpeakButton, monoLabel, srsCol } from "../ui/common.jsx";

// ---------- MUSTER (sentence patterns, from the backend) ----------
export const CHUNK_ROLE = {
  front: { bd: "#3A5A8C", fg: "var(--ink)", bg: "#3A5A8C14", cap: "Position ①" },
  v2: { bd: "#8A6A2B", fg: "#FCF8EE", bg: "#8A6A2B", cap: "Verb ②" },
  end: { bd: "#3F7A55", fg: "#FCF8EE", bg: "#3F7A55", cap: "Satzende" },
  konj: { bd: "#6B4A8A", fg: "#6B4A8A", bg: "#6B4A8A12", cap: "Konjunktion" },
  subj: { bd: "var(--line)", fg: "var(--ink)", bg: "var(--paper-raised)", cap: "Subjekt" },
  time: { bd: "var(--line)", fg: "var(--ink)", bg: "var(--paper-raised)", cap: "Zeit" },
  place: { bd: "var(--line)", fg: "var(--ink)", bg: "var(--paper-raised)", cap: "Ort" },
  obj: { bd: "var(--line)", fg: "var(--ink)", bg: "var(--paper-raised)", cap: "Objekt" },
  manner: { bd: "var(--line)", fg: "var(--ink)", bg: "var(--paper-raised)", cap: "Art & Weise" },
  mid: { bd: "var(--line)", fg: "var(--ink-soft)", bg: "transparent", cap: "" },
};

export function ChunkRow({ chunks, big }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "center", alignItems: "flex-end" }}>
      {chunks.map((ch, i) => {
        const m = CHUNK_ROLE[ch.role] || CHUNK_ROLE.mid;
        const strong = ch.role === "v2" || ch.role === "end";
        return (
          <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: big ? "16px" : "14px", fontWeight: strong ? 700 : 500, padding: "6px 10px", borderRadius: "8px", lineHeight: 1.15, border: "1px solid " + m.bd, background: m.bg, color: m.fg }}>{ch.text}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "7.5px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ink-faint)", minHeight: "9px", textAlign: "center" }}>{ch.cap != null ? ch.cap : m.cap}</div>
          </div>
        );
      })}
    </div>
  );
}

export const PATTERNS_SEEN = new Set(); // "day|key" already sent from this page

export function PatternStudy({ onChange }) {
  const [content, error] = useContent();
  const patterns = content ? content.patterns : null;
  const [pi, setPi] = useState(0);
  // Looking at a pattern counts toward today's goal — once per pattern and day, so it is sent once.
  useEffect(() => {
    if (!patterns || !patterns[pi]) return;
    const mark = new Date().toDateString() + "|" + patterns[pi].key;
    if (PATTERNS_SEEN.has(mark)) return;
    PATTERNS_SEEN.add(mark);
    api.post("/api/patterns/" + encodeURIComponent(patterns[pi].key) + "/seen", undefined, undefined, { quiet: true }).then(onChange).catch(api.report);
  }, [patterns, pi]);
  if (error) return <DrillError message={error} />;
  if (!patterns) return <Loading />;
  const pat = patterns[pi];
  return (
    <div style={{ ...srsCol, width: "100%", maxWidth: "620px", margin: "0 auto", gap: "18px" }}>
      <div className="tabstrip" style={{ display: "flex", gap: "6px", overflowX: "auto", maxWidth: "100%", padding: "2px", scrollSnapType: "x proximity" }}>
        {patterns.map((p, i) => (
          <button key={p.key} onClick={() => setPi(i)} style={{
            flex: "0 0 auto", whiteSpace: "nowrap", scrollSnapAlign: "center", fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.03em", textTransform: "uppercase",
            padding: "8px 13px", borderRadius: "999px", cursor: "pointer", border: "1px solid " + (i === pi ? "var(--btn-border)" : "var(--line)"),
            background: i === pi ? "var(--btn-grad)" : "transparent", color: i === pi ? "#FCF8EE" : "var(--ink-soft)",
          }}>{p.name}</button>
        ))}
      </div>
      <div style={{ textAlign: "center", maxWidth: "min(480px, 92vw)" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", fontWeight: 600, color: "var(--ink)", marginBottom: "6px" }}>{pat.name}</div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "14px", color: "var(--ink-soft)", lineHeight: 1.6 }}>{pat.rule}</div>
      </div>
      <div style={{ width: "100%", padding: "14px 12px", borderRadius: "12px", background: "var(--paper-raised)", border: "1px dashed var(--line)" }}>
        <div style={{ ...monoLabel, fontSize: "8px", letterSpacing: "0.18em", textAlign: "center", marginBottom: "10px" }}>the shape</div>
        <ChunkRow chunks={pat.skeleton} />
      </div>
      <div style={{ ...monoLabel, fontSize: "8px", letterSpacing: "0.16em" }}>{pat.examples.length} real sentences — same shape every time</div>
      {pat.examples.map((ex, i) => (
        <div key={pat.key + i} style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "9px", paddingBottom: "16px", borderBottom: i < pat.examples.length - 1 ? "1px solid var(--line)" : "none" }}>
          <ChunkRow chunks={ex.chunks} big />
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <SpeakButton text={ex.sentence} size={28} />
            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "13px", color: "var(--ink-soft)", textAlign: "center" }}>{ex.en}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
