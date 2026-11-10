import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { API_BASE } from "../lib/api.js";
import { LEVELS, asList, getJson, pick1, str } from "../lib/content.js";
import { DrillError, Loading, SpeakButton, counterStyle, ghostBtn, miniBtn, monoLabel, navBtnStyle, smallOutline, srsCol } from "../ui/common.jsx";
import { UmlautButtons, shuffled } from "./drills.jsx";

// ---------- KONNEKTOREN (pick a connector, see how it works, then join sentences with it) ----------
export const CONNECTORS_URL = API_BASE + "/data/connectors.json";
export let connectorsLoad = null;
export function useConnectors() {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    if (!connectorsLoad) {
      connectorsLoad = getJson(CONNECTORS_URL);
      connectorsLoad.catch(() => { connectorsLoad = null; });
    }
    connectorsLoad.then((l) => { if (live) setList(asList(l)); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  return [list, error];
}

// What each kind of connector does to the word order.
export const CONNECTOR_TYPE = {
  pos0: { label: "Position 0 — word order stays", color: "var(--ink-soft)" },
  pos1: { label: "Position 1 — verb comes next", color: "var(--verb)" },
  end: { label: "Side sentence — verb to the end", color: "var(--good)" },
  zu: { label: "zu + infinitive at the end", color: "var(--good)" },
  pair: { label: "Two-part connector", color: "var(--konj)" },
};
export const CONNECTOR_PICK = "connectorPick"; // last connector chosen, in this browser only

// The connector's own words ("nicht nur … sondern auch" → nicht, nur, sondern, auch), for colouring.
export const connectorWords = (c) => str(c.name).toLowerCase().split(/[\s…]+/).filter(Boolean);

// An example sentence: the connector's words in purple, the [conjugated verb] in gold.
export function ConnectorSentence({ text, words }) {
  const parts = str(text).split(/(\[[^\]]+\])/);
  return (
    <span>
      {parts.map((p, i) => {
        if (/^\[.*\]$/.test(p)) return <strong key={i} style={{ color: "var(--verb)", borderBottom: "2px solid var(--verb)" }}>{p.slice(1, -1)}</strong>;
        return p.split(/(\s+|[,.!?„“])/).map((t, j) => words.includes(t.toLowerCase())
          ? <strong key={i + "-" + j} style={{ color: "var(--konj)" }}>{t}</strong>
          : <React.Fragment key={i + "-" + j}>{t}</React.Fragment>);
      })}
    </span>
  );
}
export const plainSentence = (text) => str(text).replace(/[\[\]]/g, "");

// Answers compare without case, punctuation or umlauts (ae/oe/ue/ss count), so typed and spoken answers both work.
export const answerWords = (s) => str(s).toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/-/g, "").replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);

// Longest common run of words → which words of a and b match.
export function wordMatch(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const inA = new Set(), inB = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { inA.add(i); inB.add(j); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return { score: dp[0][0], inA, inB };
}

// The learner's answer against the accepted ones: ok, or the closest one and what differs.
export function checkConnectorAnswer(input, answers) {
  const mine = answerWords(input);
  if (!mine.length) return null;
  const same = (a) => a.join(" ") === mine.join(" ");
  const options = answers.map((ans) => ({ ans, words: answerWords(ans) }));
  if (options.some((o) => same(o.words))) return { ok: true };
  let best = null;
  for (const o of options) {
    const m = wordMatch(mine, o.words);
    if (!best || m.score > best.m.score) best = { o, m };
  }
  const sorted = (w) => [...w].sort().join(" ");
  return { ok: false, closest: best.o.ans, closestWords: str(best.o.ans).split(/\s+/), mineWords: str(input).trim().split(/\s+/),
    orderOnly: sorted(mine) === sorted(best.o.words), m: best.m };
}

// Speech to text in German with the browser's recogniser (Chrome, Edge, Safari).
export const Recognition = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export function useDictation(onText) {
  const [listening, setListening] = useState(false);
  const rec = useRef(null);
  useEffect(() => () => { if (rec.current) rec.current.abort(); }, []);
  const stop = () => { if (rec.current) rec.current.stop(); };
  const start = () => {
    if (!Recognition || listening) return;
    const r = new Recognition();
    r.lang = "de-DE";
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onText(text);
    };
    r.onend = () => { setListening(false); rec.current = null; };
    r.onerror = () => { setListening(false); };
    rec.current = r;
    setListening(true);
    try { r.start(); } catch (e) { setListening(false); }
  };
  return { supported: !!Recognition, listening, start, stop };
}

export function ConnectorPractice() {
  const [list, error] = useConnectors();
  const [key, setKey] = useState(() => { try { return localStorage.getItem(CONNECTOR_PICK) || "obwohl"; } catch (e) { return "obwohl"; } });
  const [stage, setStage] = useState("learn"); // "learn" | "practice" | "done"
  const [order, setOrder] = useState([]);
  const [pos, setPos] = useState(0);
  const [val, setVal] = useState("");
  const [result, setResult] = useState(null); // checkConnectorAnswer's verdict, or { ok: true, selfMarked }
  const [revealed, setRevealed] = useState(false);
  const [showEn, setShowEn] = useState(false);
  const [score, setScore] = useState(0); // right the first time
  const [attempts, setAttempts] = useState(0); // checks of this sentence
  const inputRef = useRef(null);
  const dictation = useDictation((t) => { setVal(t); setResult(null); });

  const con = list ? list.find((c) => c.key === key) || list[0] : null;
  const pick = (k) => {
    setKey(k); setStage("learn");
    try { localStorage.setItem(CONNECTOR_PICK, k); } catch (e) { /* storage off */ }
  };
  const begin = () => {
    setOrder(shuffled(con.exercises.map((_, i) => i))); setPos(0); setScore(0); setAttempts(0);
    setVal(""); setResult(null); setRevealed(false); setShowEn(false); setStage("practice");
  };
  const ex = con && stage === "practice" ? con.exercises[order[pos]] : null;
  const done = !!(result && result.ok) || revealed;
  const check = () => {
    if (!ex || done) return;
    dictation.stop();
    const r = checkConnectorAnswer(val, ex.answers);
    if (!r) return;
    setResult(r);
    if (r.ok && attempts === 0) setScore((n) => n + 1);
    setAttempts((n) => n + 1);
  };
  // "mine is right too": the answer counts — first time, if it was the first try.
  const accept = () => { setResult({ ok: true, selfMarked: true }); if (attempts === 1 && !revealed) setScore((n) => n + 1); };
  const next = () => {
    dictation.stop();
    if (pos + 1 >= order.length) { setStage("done"); return; }
    setPos(pos + 1); setVal(""); setResult(null); setRevealed(false); setShowEn(false); setAttempts(0);
  };
  useEffect(() => { if (stage === "practice" && inputRef.current) inputRef.current.focus(); }, [stage, pos]);
  // Enter checks, then moves on — even if focus left the text box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Enter" || e.isComposing || stage !== "practice") return;
      const el = e.target;
      if (el && el !== inputRef.current && /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      e.preventDefault();
      if (done) next(); else check();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error) return <DrillError message={error} />;
  if (!list) return <Loading />;
  const words = connectorWords(con);
  const type = CONNECTOR_TYPE[con.type] || CONNECTOR_TYPE.pos0;
  const panel = { width: "min(480px, 92vw)", padding: "16px", borderRadius: "14px", background: "var(--paper-raised)", border: "1px solid var(--line)", boxSizing: "border-box" };

  const picker = (
    <div style={{ display: "flex", gap: "6px", alignItems: "center", width: "min(480px, 92vw)" }}>
      <select value={con.key} onChange={(e) => pick(e.target.value)} aria-label="connector"
        style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-serif)", fontSize: "16px", padding: "10px 12px", borderRadius: "10px", border: "1px solid var(--line)", background: "var(--paper-raised)", color: "var(--ink)", cursor: "pointer" }}>
        {LEVELS.map((lv) => (
          <optgroup key={lv} label={lv}>
            {list.filter((c) => c.level === lv).map((c) => <option key={c.key} value={c.key}>{c.name} — {c.en}</option>)}
          </optgroup>
        ))}
      </select>
      <button onClick={() => pick(pick1(list.filter((c) => c.key !== con.key)).key)} title="random connector" aria-label="random connector" style={{ ...miniBtn, fontSize: "15px", padding: "8px 11px" }}>🎲</button>
    </div>
  );

  if (stage === "learn") {
    return (
      <div style={{ ...srsCol, gap: "14px" }}>
        {picker}
        <div style={{ ...panel, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
            <span style={{ fontFamily: "var(--font-serif)", fontSize: "30px", fontWeight: 700, color: "var(--konj)" }}>{con.name}</span>
            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "16px", color: "var(--ink-soft)" }}>{con.en}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: "6px", marginTop: "8px", flexWrap: "wrap" }}>
            <span style={{ ...monoLabel, fontSize: "9px", border: "1px solid var(--line)", borderRadius: "999px", padding: "3px 9px" }}>{con.level}</span>
            <span style={{ ...monoLabel, fontSize: "9px", color: type.color, border: "1px solid " + type.color, borderRadius: "999px", padding: "3px 9px" }}>{type.label}</span>
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "14px", color: "var(--ink-soft)", lineHeight: 1.6, marginTop: "12px" }}>{con.rule}</div>
        </div>
        <div style={{ ...monoLabel, fontSize: "8px", letterSpacing: "0.16em" }}>beispiele — <span style={{ color: "var(--konj)" }}>connector</span> · <span style={{ color: "var(--verb)" }}>verb</span></div>
        {asList(con.examples).map((e, i) => (
          <div key={con.key + i} style={{ ...panel, display: "flex", gap: "12px", alignItems: "center" }}>
            <SpeakButton text={plainSentence(e.de)} size={32} />
            <div style={{ textAlign: "left" }}>
              <div style={{ fontFamily: "var(--font-serif)", fontSize: "18px", color: "var(--ink)", lineHeight: 1.4 }}><ConnectorSentence text={e.de} words={words} /></div>
              <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "13px", color: "var(--ink-soft)", marginTop: "3px" }}>{e.en}</div>
            </div>
          </div>
        ))}
        <button onClick={begin} style={navBtnStyle}>übungen — {con.exercises.length} sentences ›</button>
      </div>
    );
  }

  if (stage === "done") {
    return (
      <div style={{ ...srsCol, padding: "28px 0" }}>
        {picker}
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", textAlign: "center", color: "var(--ink)" }}>
          {score} / {order.length} right the first time with <strong style={{ color: "var(--konj)" }}>{con.name}</strong> {score === order.length ? "— perfect" : ""}
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={begin} style={navBtnStyle}>⟲ again</button>
          <button onClick={() => setStage("learn")} style={ghostBtn}>‹ the rule</button>
        </div>
      </div>
    );
  }

  const tone = result ? (result.ok ? "var(--good)" : "var(--bad)") : "var(--line)";
  return (
    <div style={{ ...srsCol, gap: "14px" }}>
      {picker}
      <div style={counterStyle}>{pos + 1} / {order.length} · VERBINDE MIT „{con.name.toUpperCase()}“</div>
      <div style={{ ...panel, textAlign: "center" }}>
        {[ex.a, ex.b].map((s, i) => (
          <div key={i} style={{ fontFamily: "var(--font-serif)", fontSize: "19px", color: "var(--ink)", lineHeight: 1.5 }}>
            <span style={{ ...monoLabel, fontSize: "9px", marginRight: "8px" }}>{i ? "B" : "A"}</span>{s}
          </div>
        ))}
        <button onClick={() => setShowEn((v) => !v)} style={{ ...smallOutline("var(--ink-soft)"), marginTop: "10px" }}>{showEn ? "hide" : "show"} english</button>
        {showEn && <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "14px", color: "var(--ink-soft)", marginTop: "8px" }}>{ex.en}</div>}
      </div>
      <div style={{ display: "flex", gap: "6px", width: "min(480px, 92vw)" }}>
        <textarea ref={inputRef} value={val} rows={2} readOnly={done}
          onChange={(e) => { setVal(e.target.value); if (result && !result.ok) setResult(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); e.stopPropagation(); if (done) next(); else check(); } }}
          placeholder={dictation.supported ? "tippe oder sprich deinen Satz…" : "tippe deinen Satz…"} autoCapitalize="sentences" autoCorrect="off" spellCheck={false}
          style={{ flex: 1, minWidth: 0, padding: "12px 14px", fontFamily: "var(--font-serif)", fontSize: "18px", lineHeight: 1.4, resize: "vertical", border: "1px solid " + tone, borderRadius: "12px", background: "var(--paper-raised)", color: "var(--ink)", outline: "none" }} />
        {dictation.supported && !done && (
          <button onClick={() => (dictation.listening ? dictation.stop() : dictation.start())} aria-label={dictation.listening ? "stop listening" : "speak your answer"} title={dictation.listening ? "stop" : "speak"}
            style={{ flexShrink: 0, width: "52px", borderRadius: "12px", border: "1px solid " + (dictation.listening ? "var(--bad)" : "var(--line)"), background: dictation.listening ? "var(--bad)" : "var(--paper-raised)", color: dictation.listening ? "#FCF8EE" : "var(--ink)", fontSize: "20px", cursor: "pointer", animation: dictation.listening ? "pulse 1.2s ease-in-out infinite" : "none" }}>
            {dictation.listening ? "■" : "🎤"}
          </button>
        )}
      </div>
      {dictation.listening && <div style={{ ...monoLabel, fontSize: "9px", color: "var(--bad)" }}>listening … sprich jetzt 🎙</div>}
      {!done && (
        <React.Fragment>
          <UmlautButtons inputRef={inputRef} setVal={setVal} />
          <button onClick={check} disabled={!val.trim()} style={{ ...navBtnStyle, opacity: val.trim() ? 1 : 0.5 }}>check › <span style={{ opacity: 0.6 }}>⏎</span></button>
        </React.Fragment>
      )}
      {result && result.ok && (
        <div style={{ ...srsCol, gap: "10px" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", letterSpacing: "0.08em", color: "var(--good)" }}>{result.selfMarked ? "✓ Counted" : "✓ Richtig"}</div>
          {ex.answers.length > 1 && (
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "14px", color: "var(--ink-soft)", textAlign: "center" }}>
              also right: {ex.answers.filter((a) => answerWords(a).join(" ") !== answerWords(val).join(" ")).map((a, i) => <div key={i} style={{ color: "var(--ink)" }}>{a}</div>)}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <SpeakButton text={result.selfMarked ? val : ex.answers[0]} />
            <button onClick={next} style={navBtnStyle}>next › <span style={{ opacity: 0.6 }}>⏎</span></button>
          </div>
        </div>
      )}
      {result && !result.ok && (
        <div style={{ ...srsCol, gap: "10px", width: "min(480px, 92vw)" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", letterSpacing: "0.08em", color: result.orderOnly ? "var(--accent)" : "var(--bad)" }}>
            {result.orderOnly ? "≈ Right words, wrong order" : "✗ Noch nicht"}
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "14px", color: "var(--ink-soft)", textAlign: "center", lineHeight: 1.6 }}>{con.rule}</div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "17px", textAlign: "center" }}>
            <span style={{ ...monoLabel, fontSize: "8px", marginRight: "6px" }}>you</span>
            {result.mineWords.map((w, i) => {
              const hit = result.m.inA.has(answerWords(result.mineWords.slice(0, i + 1).join(" ")).length - 1);
              return <span key={i} style={{ color: hit ? "var(--ink)" : "var(--bad)", textDecoration: hit ? "none" : "line-through" }}>{w} </span>;
            })}
          </div>
          {revealed ? (
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "18px", textAlign: "center", fontWeight: 600 }}>
              <span style={{ ...monoLabel, fontSize: "8px", marginRight: "6px" }}>richtig</span>
              {result.closestWords.map((w, i) => {
                const hit = result.m.inB.has(answerWords(result.closestWords.slice(0, i + 1).join(" ")).length - 1);
                return <span key={i} style={{ color: hit ? "var(--ink)" : "var(--good)", borderBottom: hit ? "none" : "2px solid var(--good)" }}>{w} </span>;
              })}
            </div>
          ) : null}
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
            {!revealed && <button onClick={() => { setResult(null); if (inputRef.current) inputRef.current.focus(); }} style={navBtnStyle}>✎ try again</button>}
            {!revealed && <button onClick={() => setRevealed(true)} style={ghostBtn}>show answer</button>}
            {revealed && <SpeakButton text={result.closest} />}
            {revealed && <button onClick={next} style={navBtnStyle}>next › <span style={{ opacity: 0.6 }}>⏎</span></button>}
            <button onClick={accept} style={{ ...smallOutline("var(--ink-soft)"), alignSelf: "center" }}>mine is right too ✓</button>
          </div>
        </div>
      )}
    </div>
  );
}
