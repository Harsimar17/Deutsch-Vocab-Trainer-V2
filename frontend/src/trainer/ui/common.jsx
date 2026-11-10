import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { api } from "../lib/api.js";

// ---------- PRESENTATION ----------
export const CATEGORY_META = {
  der: { label: "der", color: "#3A5A8C" },
  die: { label: "die", color: "#A5354A" },
  das: { label: "das", color: "#3F7A55" },
  adj: { label: "adj.", color: "#8A6A2B" },
  verb: { label: "verb", color: "#6B4A8A" },
  sep: { label: "sep.", color: "#2E7D74" },
  func: { label: "func.", color: "#4A7A8C" },
  phrase: { label: "phrase", color: "#B0722E" },
};
// Category colours are concatenated with hex alpha (`${color}14`), so they
// can't be CSS variables — dark mode swaps in lighter hexes instead.
export const CATEGORY_COLORS = {
  light: { der: "#2F55C8", die: "#D1166F", das: "#0E8A47", adj: "#B5620B", verb: "#7A2BC2", sep: "#0B7F86", func: "#2E6E9E", phrase: "#C23B1E" },
  dark: { der: "#6F95FF", die: "#FF5FB0", das: "#3CCB7A", adj: "#FFB347", verb: "#B98AFF", sep: "#3FD0D6", func: "#6FB6E8", phrase: "#FF7A59" },
};
export function applyCategoryPalette(theme) {
  const pal = CATEGORY_COLORS[theme] || CATEGORY_COLORS.light;
  Object.keys(pal).forEach((k) => { if (CATEGORY_META[k]) CATEGORY_META[k].color = pal[k]; });
}
export const catColor = (cat) => (CATEGORY_META[cat] || {}).color || "var(--ink)";

// Text-to-speech with the browser's German voice.
export function speakGerman(text) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  const clean = String(text || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*\/\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = "de-DE";
    u.rate = 0.9;
    const de = (window.speechSynthesis.getVoices() || []).find((v) => /^de(-|_)/i.test(v.lang));
    if (de) u.voice = de;
    window.speechSynthesis.speak(u);
  } catch (e) { /* speech unsupported */ }
}
if (typeof window !== "undefined" && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();
}

export const monoLabel = { fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--ink-faint)" };
export const counterStyle = { fontFamily: "var(--font-mono)", fontSize: "13px", fontWeight: 500, fontVariantNumeric: "tabular-nums", color: "var(--ink-muted)" };
export const srsCol = { display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" };
export const srsNote = { textAlign: "center", color: "var(--ink-soft)", maxWidth: "min(440px, 92vw)", margin: "0 auto", lineHeight: 1.7 };
export const navBtnStyle = {
  fontFamily: "var(--font-serif)", fontSize: "14px", fontWeight: 600, letterSpacing: "0",
  padding: "11px 20px", borderRadius: "10px", border: "1px solid var(--btn-border)", background: "var(--btn-grad)",
  color: "#FFFFFF", cursor: "pointer", boxShadow: "var(--glow)",
};
export const ghostBtn = { ...navBtnStyle, background: "var(--paper-raised)", color: "var(--ink)", border: "1px solid var(--line)", boxShadow: "var(--shadow-soft)" };
export const miniBtn = {
  fontFamily: "var(--font-serif)", fontSize: "13px", fontWeight: 500,
  padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--line)",
  background: "var(--paper-raised)", color: "var(--ink-soft)", cursor: "pointer", flexShrink: 0,
};
export const smallOutline = (color) => ({
  fontFamily: "var(--font-serif)", fontSize: "13px", fontWeight: 500,
  color, background: "transparent", border: "1px solid " + color, borderRadius: "8px", padding: "6px 12px", cursor: "pointer",
});
export const cardFace = {
  width: "min(440px, 92vw)", background: "var(--card-grad)", border: "1px solid var(--line-card)",
  borderRadius: "16px", boxShadow: "var(--shadow-card)", textAlign: "center",
};
// Colours of a multiple-choice option once the answer is known.
export function optionColors(isCorrect, isPicked, revealed) {
  if (!revealed) return { bg: "var(--paper-raised)", border: "var(--line-card)", color: "var(--ink)", shadow: "var(--shadow-soft)" };
  if (isCorrect) return { bg: "var(--good)", border: "var(--good)", color: "#FFFFFF", shadow: "var(--shadow-soft)" };
  if (isPicked) return { bg: "var(--bad)", border: "var(--bad)", color: "#FFFFFF", shadow: "var(--shadow-soft)" };
  return { bg: "transparent", border: "var(--line-card)", color: "var(--ink-faint)", shadow: "none" };
}

export function SpeakButton({ text, size = 36 }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); speakGerman(text); }}
      aria-label={"Hear " + text + " pronounced"}
      title="Hear pronunciation"
      style={{
        flexShrink: 0, width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center",
        borderRadius: "999px", border: "1px solid var(--line)", background: "var(--paper-raised)", color: "var(--accent)",
        fontSize: Math.round(size * 0.46), lineHeight: 1, cursor: "pointer", boxShadow: "var(--shadow-soft)",
      }}
    >
      🔊
    </button>
  );
}

export function CatChip({ cat }) {
  const meta = CATEGORY_META[cat];
  if (!meta) return null;
  return (
    <span style={{
      display: "inline-block", fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 600, letterSpacing: "0.14em",
      textTransform: "uppercase", color: meta.color, background: `${meta.color}14`, border: `1px solid ${meta.color}55`,
      borderRadius: "999px", padding: "3px 10px",
    }}>
      {meta.label}
    </span>
  );
}

export function Loading({ text = "Loading…" }) {
  return <p style={{ ...srsNote, fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.1em" }}>{text}</p>;
}

export function DrillError({ message }) {
  return <p style={{ ...srsNote, color: "var(--bad)", fontFamily: "var(--font-mono)", fontSize: "12px" }}>{message}</p>;
}

// Example sentence for a card: the backend serves the saved one, or generates
// it with Gemini (using the key held in this page's memory) and saves it.
// A Gemini example sentence for the card — only asked for when a Gemini key is set.
export function AiSentence({ card, apiKey }) {
  const [state, setState] = useState({ status: apiKey ? "loading" : "idle" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!apiKey) { setState({ status: "idle" }); return undefined; }
    let cancelled = false;
    setState({ status: "loading" });
    api.post("/api/sentences/generate", { de: card.de, en: card.en, cat: card.cat }, apiKey ? { "X-Gemini-Key": apiKey } : {}, { quiet: true })
      .then((d) => { if (!cancelled) setState(d.needsKey ? { status: "idle" } : { status: "done", data: d }); })
      .catch((e) => { if (!cancelled) setState({ status: "error", message: e.message }); });
    return () => { cancelled = true; };
  }, [card.de, apiKey, attempt]);

  if (state.status === "idle") {
    return (
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.08em", color: "var(--ink-faint)", textAlign: "center", maxWidth: "min(420px, 90vw)", lineHeight: 1.6 }}>
        add a Gemini API key in settings ▸ for example sentences
      </div>
    );
  }
  if (state.status === "loading") {
    return <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.1em", color: "var(--ink-faint)" }}>✨ writing a sentence …</div>;
  }
  if (state.status === "error") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--bad)", maxWidth: "min(420px, 90vw)", textAlign: "center", lineHeight: 1.5 }}>
          {state.message}
        </div>
        <button onClick={() => setAttempt((a) => a + 1)} style={{ ...smallOutline("var(--ink-soft)"), borderColor: "var(--line)" }}>retry</button>
      </div>
    );
  }
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", maxWidth: "min(440px, 92vw)",
      padding: "10px 14px", background: "var(--paper-raised)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow-soft)",
    }}>
      <SpeakButton text={state.data.de} size={30} />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "16px", color: "var(--ink)", lineHeight: 1.35 }}>{state.data.de}</div>
        {state.data.en && <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "13px", color: "var(--ink-soft)", marginTop: "3px" }}>{state.data.en}</div>}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-faint)", marginTop: "5px" }}>✨ generated by Gemini</div>
      </div>
    </div>
  );
}

export function Switch({ on, onChange, label }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        display: "inline-flex", alignItems: "center", gap: "10px", background: "transparent", border: "none", padding: "4px", cursor: "pointer",
        fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: on ? "var(--ink)" : "var(--ink-soft)",
      }}
    >
      <span style={{ position: "relative", flexShrink: 0, width: "38px", height: "22px", borderRadius: "999px", background: on ? "#3F7A55" : "var(--line)", transition: "background-color .18s ease" }}>
        <span style={{ position: "absolute", top: "3px", left: on ? "19px" : "3px", width: "16px", height: "16px", borderRadius: "50%", background: "#FCF8EE", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .18s ease" }} />
      </span>
      {label}
    </button>
  );
}

// Multiple-choice options as the backend sent them; colours once answered.
export function OptionList({ options, picked, correctKey, onPick, textKey = "text", align = "left", width = "min(420px, 90vw)" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", width }}>
      {options.map((o) => {
        const c = optionColors(o.key === correctKey, o.key === picked, picked != null);
        const text = o[textKey];
        return (
          <button
            key={o.key}
            onClick={() => onPick(o.key)}
            style={{
              textAlign: align, fontFamily: "var(--font-serif)", fontWeight: align === "center" ? 600 : 500,
              fontSize: String(text).length > 28 ? "14px" : "17px", padding: "14px 18px", borderRadius: "12px",
              border: "1px solid " + c.border, background: c.bg, color: c.color, boxShadow: c.shadow,
              cursor: picked != null ? "default" : "pointer",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

// Sentence with a gap; the gap shows the answer once revealed.
export function GapSentence({ before, gap, after, revealed, accent, minWidth = "84px" }) {
  return (
    <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "21px", lineHeight: 1.7, color: "var(--ink)" }}>
      {before}
      <span style={{
        display: "inline-block", minWidth, margin: "0 4px", padding: "0 8px 2px",
        borderBottom: `2px solid ${revealed ? accent : "var(--ink-faint)"}`, color: revealed ? accent : "transparent", fontWeight: 700,
      }}>
        {revealed ? gap : " "}
      </span>
      {after}
    </div>
  );
}

export function ScoreLine({ score, extra }) {
  return (
    <div style={counterStyle}>
      SCORE {score.right} / {score.total}
      {extra}
    </div>
  );
}
