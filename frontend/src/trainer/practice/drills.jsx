import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { api } from "../lib/api.js";
import { SEP_COMMON, clozeMatch, isNoun, nounForms, pick1, saveAnswer, sepCloze, sepParts, stripArticle, useContent, useDrill, useRound } from "../lib/content.js";
import { AiSentence, CATEGORY_META, CatChip, DrillError, GapSentence, Loading, OptionList, ScoreLine, SpeakButton, cardFace, catColor, counterStyle, ghostBtn, monoLabel, navBtnStyle, smallOutline, speakGerman, srsCol, srsNote } from "../ui/common.jsx";

// ---------- PRACTICE MODES (each renders a backend drill) ----------

export function DrillGate({ drill, children }) {
  if (drill.error) return <DrillError message={drill.error} />;
  if (!drill.view) return <Loading />;
  return children(drill.view, drill.act);
}

export function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Cards run in the page: the deck is the content's cards for the current
// settings. The ✗ / ✓ marks are kept here and saved in one call when the deck
// is done, the tab is left or the page is hidden.
export const FLASH_RESULTS_PER_CALL = 200;
export function saveFlashResults(results, keepalive) {
  const chunks = [];
  for (let i = 0; i < results.length; i += FLASH_RESULTS_PER_CALL) chunks.push(results.slice(i, i + FLASH_RESULTS_PER_CALL));
  return Promise.all(chunks.map((chunk) => api.post("/api/answers/batch", { results: chunk }, undefined, { quiet: true, keepalive })));
}

export function Flashcards({ settings, version, onChange }) {
  const { levels, cats, direction, noRepeat } = settings;
  const [content, error] = useContent(version);
  const [order, setOrder] = useState(null);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const pending = useRef([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const pool = useMemo(() => (content ? content.pool(levels, cats) : null), [content, version, levels.join(), cats.join()]);
  useEffect(() => {
    if (!pool) return;
    setOrder(shuffled(pool)); setIdx(0); setDone(false); setFlipped(false);
  }, [pool]);

  const flush = useCallback((keepalive) => {
    const results = pending.current;
    if (!results.length) return;
    pending.current = [];
    saveFlashResults(results, keepalive)
      .then((rs) => { if (onChangeRef.current) onChangeRef.current(rs[rs.length - 1]); })
      .catch((e) => { if (e.status !== 401) api.report(e); });
  }, []);
  // save on leaving the tab (cleanup), and when the page is hidden or closed
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === "hidden") flush(true); };
    const onPageHide = () => flush(true);
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      flush();
    };
  }, [flush]);

  const total = order ? order.length : 0;
  const move = (to) => { setFlipped(false); setIdx(to); };
  const next = () => {
    if (idx + 1 < total) return move(idx + 1);
    if (noRepeat) { setDone(true); flush(); } else move(0);
  };
  const prev = () => move((idx - 1 + total) % total);
  const reshuffle = () => { setOrder(shuffled(pool)); setDone(false); move(0); };
  const mark = (knew) => { pending.current.push({ key: order[idx].key, knew }); next(); };

  // Enter: first reveals the card, then moves on (like "next ›").
  const nextRef = useRef(next);
  nextRef.current = next;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (!order || done || !order.length) return;
      e.preventDefault();
      if (!flipped) setFlipped(true); else nextRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, done, flipped]);

  if (error) return <DrillError message={error} />;
  if (!order) return <Loading />;
  if (!order.length) return <p style={srsNote}>No cards match this filter — pick at least one category in settings ▸.</p>;
  if (done) {
    return (
      <div style={{ ...srsCol, padding: "40px 0" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>All {total} / {total} cards done</div>
        <button onClick={reshuffle} style={navBtnStyle}>⟲ start over</button>
      </div>
    );
  }
  const c = order[idx];
  const front = direction === "en-de" ? c.en : c.de;
  const back = direction === "en-de" ? c.de : c.en;
  const meta = CATEGORY_META[c.cat] || { color: "var(--accent)" };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
      <div style={counterStyle}>{noRepeat ? `${idx + 1} / ${total} attempted` : `CARD ${idx + 1} / ${total}`}</div>
      <div onClick={() => setFlipped((f) => !f)} style={{ width: "min(440px, 92vw)", height: "280px", cursor: "pointer", perspective: "1400px" }}>
        <div style={{ position: "relative", width: "100%", height: "100%", transition: "transform 0.55s cubic-bezier(.2,.7,.2,1)", transformStyle: "preserve-3d", transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}>
          <div style={{ ...cardFace, position: "absolute", inset: 0, width: "auto", backfaceVisibility: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "18px", padding: "28px" }}>
            <CatChip cat={c.cat} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px" }}>
              {direction === "de-en" && <SpeakButton text={c.de} />}
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: front.length > 28 ? "20px" : front.length > 16 ? "26px" : "34px", lineHeight: 1.25, letterSpacing: "-0.01em", color: "var(--ink)" }}>{front}</div>
            </div>
            <div style={{ ...monoLabel, letterSpacing: "0.16em" }}>tap or ⏎ to reveal</div>
          </div>
          <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: `linear-gradient(165deg, ${meta.color} 0%, ${meta.color}e0 100%)`, borderRadius: "16px", boxShadow: "var(--shadow-card)", display: "flex", alignItems: "center", justifyContent: "center", padding: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px" }}>
              {direction === "en-de" && <SpeakButton text={c.de} />}
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: back.length > 28 ? "19px" : "25px", lineHeight: 1.3, color: "#FCF8EE", textAlign: "center", textShadow: "0 1px 8px rgba(0,0,0,.18)" }}>{back}</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={prev} style={navBtnStyle}>‹ prev</button>
        <button onClick={reshuffle} style={navBtnStyle}>⟲ shuffle</button>
        <button onClick={next} style={navBtnStyle}>next › <span style={{ opacity: 0.6 }}>⏎</span></button>
      </div>
      {flipped && (
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={() => mark(false)} style={{ ...ghostBtn, color: "var(--bad)", border: "1px solid var(--bad)" }}>✗ review this</button>
          <button onClick={() => mark(true)} style={{ ...ghostBtn, color: "var(--good)", border: "1px solid var(--good)" }}>✓ knew it</button>
        </div>
      )}
      {flipped && c.example && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", maxWidth: "min(440px, 92vw)", padding: "10px 14px", background: "var(--paper-raised)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow-soft)" }}>
          <SpeakButton text={c.example} size={30} />
          <div style={{ fontFamily: "var(--font-serif)", fontSize: "15px", color: "var(--ink)", lineHeight: 1.45 }}>{c.example}</div>
        </div>
      )}
    </div>
  );
}

// The Phasentest's Sentences tab, like Duolingo: the English on top, German
// tiles to tap into order — every word and verb of the phase once, then the
// missed ones again; after checking, how the word is used. Picking tiles is
// local; "check" sends the order.
export const tileStyle = (used) => ({
  fontFamily: "var(--font-serif)", fontSize: "17px", padding: "8px 13px", borderRadius: "10px", cursor: used ? "default" : "pointer",
  border: "1px solid var(--line)", borderBottomWidth: "3px", background: used ? "var(--line)" : "var(--paper-raised)",
  color: used ? "transparent" : "var(--ink)", pointerEvents: used ? "none" : "auto",
});

// Where the target word's meaning sits in the English sentence: [start, end], or null.
// Tries each meaning ("complaints, symptoms" → "complaints", "symptoms"), then its stem
// ("complaint…"), always from the start of a word.
export function hintRange(en, meaning) {
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const meanings = String(meaning || "").split(/[,;/]/)
    .map((m) => m.replace(/\([^)]*\)/g, "").replace(/^\s*(to|a|an|the|sich)\s+/i, "").trim()).filter((m) => m.length > 1);
  for (const m of meanings) {
    const r = new RegExp("\\b" + esc(m) + "[a-z'-]*", "i").exec(en);
    if (r) return [r.index, r.index + r[0].length];
  }
  for (const m of meanings) {
    const first = m.split(/\s+/)[0];
    if (first.length < 4) continue;
    const r = new RegExp("\\b" + esc(first.slice(0, Math.max(4, first.length - 2))) + "[a-z'-]*", "i").exec(en);
    if (r) return [r.index, r.index + r[0].length];
  }
  return null;
}

// A word with a hint that shows on hover (and on tap, for phones).
export function HintWord({ hint, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onClick={() => setOpen((o) => !o)}
      style={{ position: "relative", borderBottom: "2px dotted var(--accent)", cursor: "help" }}>
      {children}
      {open && (
        <span role="tooltip" style={{
          position: "absolute", bottom: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)", width: "max-content", maxWidth: "260px",
          background: "var(--ink)", color: "var(--paper)", fontFamily: "var(--font-serif)", fontSize: "14px", fontWeight: 400, lineHeight: 1.3,
          padding: "6px 10px", borderRadius: "8px", boxShadow: "var(--shadow-soft)", zIndex: 5, pointerEvents: "none",
        }}>{hint}</span>
      )}
    </span>
  );
}

export function PhaseSentences({ idx, onChange }) {
  const drill = useDrill("sentences", { phase: idx }, 0, onChange);
  const v = drill.view;
  const [picked, setPicked] = useState([]);
  const itemId = v && v.item ? v.position + "|" + v.item.tiles.join(" ") : null;
  useEffect(() => { setPicked([]); }, [itemId]);
  useEffect(() => { if (v && v.verdict && v.answer) speakGerman(v.answer.de); }, [v && v.verdict]);
  // Enter checks the sentence, and once checked moves on to the next one.
  const keyRef = useRef(null);
  keyRef.current = () => {
    if (!v || !v.item || v.done) return false;
    if (v.verdict) { drill.act("next"); return true; }
    if (picked.length) { drill.act("check", { words: picked.map((i) => v.item.tiles[i]) }); return true; }
    return false;
  };
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (keyRef.current()) e.preventDefault(); // and keep a focused tile or button from being pressed too
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <DrillGate drill={drill}>{(v, act) => {
      const stat = (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", width: "100%" }}>
          <div style={{ ...counterStyle, textAlign: "center" }}>
            {v.retry ? `RETRY · ${v.total} MISSED WORDS` : `ROUND · ${v.total} WORDS`}
            <span style={{ marginLeft: "10px" }}><span style={{ color: "var(--good)" }}>✓ {v.right}</span> · <span style={{ color: "var(--bad)" }}>✗ {v.missed}</span></span>
          </div>
          <div style={{ ...monoLabel, fontSize: "9px" }}>Phase: {v.phaseDone} / {v.words} words written right</div>
          <div style={{ width: "min(520px, 94vw)", height: "4px", borderRadius: "2px", background: "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${v.words ? (v.phaseDone / v.words) * 100 : 0}%`, background: "var(--accent)", transition: "width .3s" }} />
          </div>
        </div>
      );
      const reset = () => { if (window.confirm("Satz-Fortschritt dieser Phase zurücksetzen und von vorn beginnen?")) act("reset"); };
      if (v.empty) {
        return (
          <div style={srsCol}>
            {stat}
            <p style={srsNote}>No sentences for this phase yet.</p>
          </div>
        );
      }
      if (v.allDone) {
        return (
          <div style={{ ...srsCol, padding: "30px 0" }}>
            {stat}
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>All {v.words} words written right — WHAM! spelling champ ✍️</div>
            <p style={{ ...srsNote, fontSize: "14px" }}>Every word and verb of this phase, in a sentence of its own.</p>
            <button onClick={reset} style={navBtnStyle}>⟲ start the phase over</button>
          </div>
        );
      }
      if (v.done) {
        return (
          <div style={{ ...srsCol, padding: "30px 0" }}>
            {stat}
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>{v.right} / {v.total} sentences right {v.missed === 0 ? "— FLAWLESS VICTORY! 🏆" : ""}</div>
            <div style={{ ...srsNote, fontSize: "14px" }}>
              {v.missed === 0 ? (v.retry ? "All the missed words are right now." : "Every word of this round, right first time.")
                : `${v.missed} ${v.missed === 1 ? "word" : "words"} to practise again — each comes back with another sentence where there is one.`}
            </div>
            <div style={{ ...srsNote, fontSize: "13px" }}>
              {v.phaseOpen > 0 ? `${v.phaseOpen} words of this phase still to go — come back any time, your place is saved.` : "That was the last of this phase."}
            </div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
              {v.missed > 0 && <button onClick={() => act("retryMissed")} style={navBtnStyle}>↻ retry {v.missed} missed</button>}
              {v.phaseOpen > 0
                ? <button onClick={() => act("nextRound")} style={v.missed > 0 ? ghostBtn : navBtnStyle}>▶ next round · {Math.min(v.roundWords, v.phaseOpen)} words</button>
                : <button onClick={reset} style={ghostBtn}>⟲ start the phase over</button>}
            </div>
          </div>
        );
      }
      const it = v.item;
      const checked = !!v.verdict;
      const used = new Set(picked);
      const pick = (i) => { if (!checked) setPicked((p) => (p.includes(i) ? p : [...p, i])); };
      const unpick = (i) => { if (!checked) setPicked((p) => p.filter((x) => x !== i)); };
      const ok = v.verdict === "correct";
      const at = it.hint ? it.en.indexOf(it.hint) : -1; // the sentence's own English for the word, else found from the meaning
      const hint = at >= 0 ? [at, at + it.hint.length] : hintRange(it.en, it.meaning);
      const hintText = <><strong>{it.word}</strong> = {it.meaning}</>;
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", width: "100%" }}>
          {stat}
          <div style={{ width: "min(520px, 94vw)", height: "6px", borderRadius: "3px", background: "var(--line)", overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${((v.position - 1) / v.total) * 100}%`, background: "var(--good)", transition: "width .3s" }} />
          </div>
          <div style={monoLabel}>Write this in German · {v.position} / {v.total}</div>
          <div style={{ ...cardFace, width: "min(520px, 94vw)", display: "flex", flexDirection: "column", gap: "14px", padding: "20px" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "21px", color: "var(--ink)", textAlign: "center", lineHeight: 1.35 }}>
              {hint
                ? <>{it.en.slice(0, hint[0])}<HintWord hint={hintText}>{it.en.slice(hint[0], hint[1])}</HintWord>{it.en.slice(hint[1])}</>
                : <HintWord hint={hintText}>{it.en}</HintWord>}
            </div>
            <div style={{ minHeight: checked ? "0" : "108px", borderBottom: "2px solid " + (checked ? (ok ? "var(--good)" : "var(--bad)") : "var(--line)"),
              display: "flex", flexWrap: "wrap", gap: "8px", padding: "8px 0", alignContent: "flex-start" }}>
              {picked.map((i) => <button key={i} onClick={() => unpick(i)} style={tileStyle(false)}>{it.tiles[i]}</button>)}
              {checked && !picked.length && <span style={{ ...monoLabel, alignSelf: "center" }}>—</span>}
            </div>
            {!checked && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
                {it.tiles.map((w, i) => <button key={i} onClick={() => pick(i)} style={tileStyle(used.has(i))}>{w}</button>)}
              </div>
            )}
            {checked && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ ...monoLabel, color: ok ? "var(--good)" : "var(--bad)" }}>{ok ? "✓ correct" : v.verdict === "skipped" ? "skipped — the sentence" : "✗ correct answer"}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <SpeakButton text={v.answer.de} size={30} />
                  <div style={{ fontFamily: "var(--font-serif)", fontSize: "18px", color: "var(--ink)" }}>{v.answer.de}</div>
                </div>
                {v.answer.use && (
                  <div style={{ marginTop: "4px", paddingTop: "8px", borderTop: "1px solid var(--line)" }}>
                    <div style={{ ...monoLabel, fontSize: "9px" }}>How to use {it.word}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "var(--accent)", marginTop: "4px" }}>{v.answer.use}</div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {checked
              ? <button onClick={() => act("next")} style={navBtnStyle}>{v.position < v.total ? "continue ›" : "finish"} ⏎</button>
              : <>
                  <button onClick={() => act("skip")} style={ghostBtn}>skip</button>
                  <button onClick={() => act("check", { words: picked.map((i) => it.tiles[i]) })} disabled={!picked.length}
                    style={{ ...navBtnStyle, opacity: picked.length ? 1 : 0.4 }}>check ⏎</button>
                </>}
          </div>
        </div>
      );
    }}</DrillGate>
  );
}

export function GradeBar({ onGrade }) {
  const btns = [["again", "Again", "var(--bad)", "forgot"], ["good", "Good", "var(--good)", "got it"], ["easy", "Easy", "#3A5A8C", "too easy"]];
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
      {btns.map(([g, label, color, sub]) => (
        <button key={g} onClick={() => onGrade(g)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: "2px", fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 600,
          letterSpacing: "0.06em", textTransform: "uppercase", padding: "10px 20px", borderRadius: "10px", border: "1px solid " + color,
          background: color, color: "#FCF8EE", cursor: "pointer", boxShadow: "0 8px 18px -10px " + color,
        }}>
          {label}
          <span style={{ fontSize: "8px", opacity: 0.85, letterSpacing: "0.08em" }}>{sub}</span>
        </button>
      ))}
    </div>
  );
}

export function StudyMode({ version, onChange, geminiKey }) {
  const drill = useDrill("study", null, version, onChange);
  const v = drill.view;
  const [flipped, setFlipped] = useState(false);
  const cardId = v && v.card ? v.state + "#" + v.card.key + "#" + v.position : null;
  useEffect(() => { setFlipped(false); }, [cardId]);

  return (
    <DrillGate drill={drill}>{(v, act) => {
      if (v.state === "noCategories") return <p style={srsNote}>No categories selected — turn some on in settings ▸.</p>;
      if (v.state === "noTrouble") return <p style={srsNote}>No trouble words yet — nothing missed {v.troubleLapses}+ times. Keep going in <strong>Study</strong> or <strong>Write</strong>. 🎉</p>;
      if (v.state === "caughtUp") {
        return (
          <div style={{ ...srsCol, padding: "36px 0" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", textAlign: "center" }}>All caught up for today</div>
            <p style={srsNote}>Every word that's due has been reviewed, and today's {v.newPerDay} new words are done. Come back tomorrow — or set <strong>focus → everything</strong> in settings ▸ to keep drilling now.</p>
          </div>
        );
      }
      if (v.state === "roundDone") {
        return (
          <div style={{ ...srsCol, padding: "36px 0" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", textAlign: "center" }}>{v.graded} reviewed this round</div>
            <button onClick={() => act("keepGoing")} style={navBtnStyle}>⟲ keep going</button>
          </div>
        );
      }
      if (v.state === "sentenceBreak") {
        return (
          <div style={{ ...srsCol, padding: "10px 0" }}>
            <div style={{ ...monoLabel, letterSpacing: "0.18em" }}>SAY IT OUT LOUD</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "20px", textAlign: "center", maxWidth: "min(440px, 92vw)", lineHeight: 1.5 }}>
              Build your own sentence with <strong>{v.card.de}</strong> — “{v.card.en}”. Say it aloud, then check yourself against one below.
            </div>
            <AiSentence card={v.card} apiKey={geminiKey} />
            <button onClick={() => act("continue")} style={navBtnStyle}>continue ›</button>
          </div>
        );
      }
      const c = v.card;
      const accent = catColor(c.cat);
      return (
        <div style={srsCol}>
          <div style={counterStyle}>{v.position} / {v.total}{v.focus === "all" ? " · all" : v.focus === "trouble" ? " · trouble" : ""}</div>
          <div onClick={() => setFlipped(true)} style={{
            ...cardFace, minHeight: "220px", cursor: flipped ? "default" : "pointer",
            background: flipped ? "linear-gradient(165deg, " + accent + " 0%, " + accent + "e0 100%)" : "var(--card-grad)",
            border: "1px solid " + (flipped ? accent : "var(--line-card)"),
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px", padding: "30px 24px",
          }}>
            <CatChip cat={c.cat} />
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
              {v.direction === "de-en" && <SpeakButton text={c.de} />}
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: v.front.length > 24 ? "22px" : "30px", color: flipped ? "#FCF8EE" : "var(--ink)" }}>{v.front}</div>
            </div>
            {flipped ? (
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", justifyContent: "center" }}>
                {v.direction === "en-de" && <SpeakButton text={c.de} />}
                <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "23px", color: "#FCF8EE", textShadow: "0 1px 8px rgba(0,0,0,.18)" }}>{v.back}</div>
              </div>
            ) : (
              <div style={{ ...monoLabel, letterSpacing: "0.16em" }}>{v.isNew ? "new word · tap to reveal" : "tap to reveal"}</div>
            )}
          </div>
          {flipped ? (
            <React.Fragment>
              <AiSentence card={c} apiKey={geminiKey} />
              <GradeBar onGrade={(g) => act("grade", { grade: g })} />
            </React.Fragment>
          ) : (
            <div style={monoLabel}>recall the answer first, then tap</div>
          )}
        </div>
      );
    }}</DrillGate>
  );
}

export function UmlautButtons({ inputRef, setVal }) {
  return (
    <div style={{ display: "flex", gap: "6px" }}>
      {["ä", "ö", "ü", "ß"].map((ch) => (
        <button key={ch} type="button"
          onMouseDown={(e) => { e.preventDefault(); setVal((x) => x + ch); if (inputRef.current) inputRef.current.focus(); }}
          style={{ fontFamily: "var(--font-serif)", fontSize: "17px", fontWeight: 600, width: "40px", height: "40px", borderRadius: "9px", border: "1px solid var(--line)", background: "var(--paper-raised)", color: "var(--ink)", cursor: "pointer" }}>
          {ch}
        </button>
      ))}
    </div>
  );
}

export function WriteMode({ version, onChange, geminiKey }) {
  const drill = useDrill("write", null, version, onChange);
  const v = drill.view;
  const [val, setVal] = useState("");
  const inputRef = useRef(null);
  const answered = !!(v && v.verdict);
  useEffect(() => { setVal(""); }, [v && v.position, v && v.state]);
  useEffect(() => { if (inputRef.current && !answered) inputRef.current.focus(); }, [v && v.position, answered]);
  const check = () => drill.act("check", { input: val });
  // Enter checks the answer, then moves to the next word — even if focus left the text box.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Enter" || e.isComposing) return;
      const el = e.target;
      if (el && el !== inputRef.current && /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (!v || v.state !== "card") return;
      e.preventDefault();
      if (answered) drill.act("next"); else check();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <DrillGate drill={drill}>{(v, act) => {
      if (v.state === "noCategories") return <p style={srsNote}>No categories selected — turn some on in settings ▸.</p>;
      if (v.state === "nothingDue") return <p style={srsNote}>Nothing due to type right now. Set <strong>focus → everything</strong> in settings ▸ to practise producing any word.</p>;
      if (v.state === "roundDone") {
        return (
          <div style={{ ...srsCol, padding: "36px 0" }}>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", textAlign: "center" }}>{v.typed} typed this round — ZING! fast fingers ⚡</div>
            <button onClick={() => act("keepGoing")} style={navBtnStyle}>⟲ keep going</button>
          </div>
        );
      }
      const ok = v.verdict === "correct";
      const close = v.verdict === "close";
      const tone = ok ? "var(--good)" : close ? "var(--accent)" : "var(--bad)";
      return (
        <div style={srsCol}>
          <div style={counterStyle}>{v.position} / {v.total} · TYPE IT IN GERMAN</div>
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: "10px" }}><CatChip cat={v.cat} /></div>
            <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: (v.en || "").length > 26 ? "20px" : "28px", color: "var(--ink)" }}>{v.en}</div>
            {v.isNoun && !answered && <div style={{ ...monoLabel, fontSize: "9px", letterSpacing: "0.14em", marginTop: "6px" }}>include the article</div>}
          </div>
          <input
            ref={inputRef} value={val} onChange={(e) => setVal(e.target.value)} readOnly={answered}
            placeholder="dein Deutsch…" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            style={{ width: "min(440px, 92vw)", padding: "14px 16px", textAlign: "center", fontFamily: "var(--font-serif)", fontSize: "20px", border: "1px solid " + (answered ? tone : "var(--line)"), borderRadius: "12px", background: "var(--paper-raised)", color: "var(--ink)", outline: "none" }}
          />
          {!answered && (
            <React.Fragment>
              <UmlautButtons inputRef={inputRef} setVal={setVal} />
              <div style={{ ...monoLabel, fontSize: "9px", letterSpacing: "0.1em", marginTop: "-6px" }}>no umlaut key? tap above — or just type ae / oe / ue / ss</div>
              <button onClick={check} style={navBtnStyle}>check › <span style={{ opacity: 0.6 }}>⏎</span></button>
            </React.Fragment>
          )}
          {answered && (
            <div style={{ ...srsCol, gap: "10px" }}>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", letterSpacing: "0.08em", color: tone }}>{ok ? "✓ Richtig" : close ? "≈ Fast — almost" : "✗ Noch nicht"}</div>
              {!ok && <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>{v.forms}</div>}
              {ok && v.spelled && <div style={{ fontFamily: "var(--font-serif)", fontSize: "15px", color: "var(--ink-soft)", textAlign: "center" }}>accepted — the umlaut spelling is <strong style={{ color: "var(--ink)" }}>{v.spelled}</strong></div>}
              {v.hint && <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "14px", color: "var(--ink-soft)", textAlign: "center" }}>{v.hint}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <SpeakButton text={v.card.de} />
                <button onClick={() => act("next")} style={navBtnStyle}>next › <span style={{ opacity: 0.6 }}>⏎</span></button>
              </div>
              <AiSentence card={v.card} apiKey={geminiKey} />
            </div>
          )}
        </div>
      );
    }}</DrillGate>
  );
}

// --- multiple-choice rounds the page runs (questions built here, answers checked and saved by the backend) ---

// Correct answer from source (or the pool); 3 distractors of the same category if there are enough.
export function choiceQuestion(pool, source) {
  const correct = pick1(source && source.length ? source : pool);
  const sameCat = pool.filter((d) => d.cat === correct.cat && d.key !== correct.key);
  const distract = sameCat.length >= 3 ? sameCat : pool.filter((d) => d.key !== correct.key);
  return { correct, options: shuffled(shuffled(distract).slice(0, 3).concat([correct])) };
}
// Next item: without repeats, one not asked yet (or done); otherwise any.
export function nextOf(r, all, make) {
  if (r.noRepeat) {
    const remaining = all.filter((d) => !r.asked.has(d.key));
    if (!remaining.length) { r.done = true; r.picked = null; return; }
    make(remaining);
  } else {
    make(null);
  }
  r.picked = null;
}

export function Quiz({ settings, version, onChange, geminiKey }) {
  const { levels, cats, direction, noRepeat } = settings;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState(null); // {sessions, allTime}: loaded when the past rounds are opened
  const [allTime, setAllTime] = useState(null); // comes with each answer
  const ask = (r, source) => { r.q = choiceQuestion(r.pool, source); if (r.noRepeat) r.asked.add(r.q.correct.key); };
  const reset = (r) => { r.asked.clear(); r.done = false; r.picked = null; ask(r, null); };
  const { round: r, update, error } = useRound((content) => {
    const x = { pool: content.pool(levels, cats), noRepeat, asked: new Set(), q: null, picked: null, right: 0, total: 0, saved: false, done: false };
    if (x.pool.length >= 4) reset(x);
    return x;
  }, [version, levels.join(), cats.join(), noRepeat], version);
  if (error) return <DrillError message={error} />;
  if (!r) return <Loading />;
  if (r.pool.length < 4) return <p style={srsNote}>Pick at least a couple categories in settings ▸ — need a few options to quiz from.</p>;

  const answer = (key) => {
    if (r.picked != null || r.done) return;
    const correctKey = r.q.correct.key;
    update((x) => { x.picked = key; x.right += key === correctKey ? 1 : 0; x.total += 1; x.saved = false; });
    saveAnswer("quiz", correctKey, key, onChange).then((res) => { if (res && res.allTime) setAllTime(res.allTime); });
  };
  const next = () => update((x) => nextOf(x, x.pool, (src) => ask(x, src)));
  const finish = () => {
    if (!r.total) return;
    api.post("/api/quiz-sessions", { right: r.right, total: r.total, cats }).then((h) => {
      setHistory(h); setAllTime(h.allTime);
      update((x) => { x.saved = true; x.right = 0; x.total = 0; });
    }).catch(api.report);
  };
  const openHistory = () => {
    setHistoryOpen((o) => !o);
    if (!history) api.get("/api/quiz-sessions", { quiet: true }).then((h) => { setHistory(h); setAllTime(h.allTime); }).catch(api.report);
  };
  const clearHistory = () => api.del("/api/quiz-sessions").then((h) => { setHistory(h); setAllTime(h.allTime); }).catch(api.report);

  const score = { right: r.right, total: r.total };
  const saveBtn = r.total > 0 && (
    <button onClick={finish} style={{ ...navBtnStyle, background: r.saved ? "var(--good)" : "transparent", border: `1px solid ${r.saved ? "var(--good)" : "var(--ink-muted)"}`, color: r.saved ? "#F6F1E5" : "var(--ink-muted)" }}>
      {r.saved ? "✓ saved" : "finish & save this round"}
    </button>
  );
  if (r.done) {
    return (
      <div style={{ ...srsCol, padding: "40px 0" }}>
        <ScoreLine score={score} />
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>All {r.pool.length} / {r.pool.length} words done</div>
        <div style={{ display: "flex", gap: "10px" }}>{saveBtn}<button onClick={() => update(reset)} style={navBtnStyle}>⟲ start over</button></div>
      </div>
    );
  }
  const card = r.q.correct;
  const picked = r.picked != null;
  const options = r.q.options.map((o) => ({ key: o.key, text: direction === "en-de" ? o.de : o.en }));
  const sessions = history ? history.sessions : [];
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
      <ScoreLine score={score} extra={allTime && allTime.total > 0 && <span style={{ marginLeft: "14px", color: "var(--ink-faint)" }}>· ALL-TIME {allTime.right} / {allTime.total}</span>} />
      {r.noRepeat && <div style={{ ...counterStyle, fontSize: "11px", marginTop: "-10px" }}>{r.asked.size} / {r.pool.length} attempted</div>}
      <div style={{ textAlign: "center" }}>
        <div style={{ marginBottom: "10px" }}><CatChip cat={card.cat} /></div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
          {direction === "de-en" && <SpeakButton text={card.de} />}
          <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "30px", letterSpacing: "-0.01em", color: "var(--ink)" }}>{direction === "en-de" ? card.en : card.de}</div>
          {direction === "en-de" && picked && <SpeakButton text={card.de} />}
          {picked && <button onClick={next} style={navBtnStyle}>next ›</button>}
        </div>
      </div>
      <OptionList options={options} picked={r.picked} correctKey={picked ? card.key : null} onPick={answer} />
      {picked && <AiSentence card={card} apiKey={geminiKey} />}
      {saveBtn}
      <div style={{ width: "min(420px, 90vw)", marginTop: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px" }}>
          <button onClick={openHistory} style={{ ...counterStyle, fontSize: "11px", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
            {historyOpen ? "▾" : "▸"} PAST ROUNDS{history ? ` (${sessions.length})` : ""}
          </button>
          {historyOpen && sessions.length > 0 && (
            <button onClick={() => { if (window.confirm("Clear all saved rounds? This can't be undone.")) clearHistory(); }} style={smallOutline("var(--bad)")}>clear history</button>
          )}
        </div>
        {historyOpen && history && (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "10px" }}>
            {!sessions.length && <div style={{ ...srsNote, fontSize: "13px" }}>No saved rounds yet.</div>}
            {sessions.map((s) => {
              const pct = s.total ? Math.round((s.right / s.total) * 100) : 0;
              const d = s.timestamp ? new Date(s.timestamp) : null;
              const dateStr = d ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--ink-soft)", background: "var(--paper-raised)", border: "1px solid var(--line-card)", borderRadius: "3px", padding: "7px 12px" }}>
                  <span>{dateStr}</span><span>{s.right}/{s.total} ({pct}%)</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export const ARTICLES = ["der", "die", "das"];
export function ArticleQuiz({ settings, version, onChange, geminiKey }) {
  const { levels, cats, noRepeat } = settings;
  const ask = (r, source) => { r.word = pick1(source || r.nouns); if (r.noRepeat) r.asked.add(r.word.key); };
  const reset = (r) => { if (!r.nouns.length) return; r.asked.clear(); r.done = false; r.picked = null; ask(r, null); };
  const { round: r, update, error } = useRound((content) => {
    const x = { nouns: content.pool(levels, cats).filter(isNoun), noRepeat, asked: new Set(), word: null, picked: null, right: 0, total: 0, done: false };
    reset(x);
    return x;
  }, [version, levels.join(), cats.join(), noRepeat], version);
  if (error) return <DrillError message={error} />;
  if (!r) return <Loading />;
  if (!r.nouns.length) return <p style={srsNote}>Select at least one of der / die / das in settings ▸ to practice articles.</p>;
  const score = { right: r.right, total: r.total };
  if (r.done) {
    return (
      <div style={{ ...srsCol, padding: "40px 0" }}>
        <ScoreLine score={score} />
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>All {r.nouns.length} / {r.nouns.length} nouns done — der, die, das: DEFEATED! 🥊</div>
        <button onClick={() => update(reset)} style={navBtnStyle}>⟲ start over</button>
      </div>
    );
  }
  const word = r.word;
  const picked = r.picked != null;
  const answer = (art) => {
    if (picked) return;
    update((x) => { x.picked = art; x.right += art === word.cat ? 1 : 0; x.total += 1; });
    saveAnswer("articles", word.key, art, onChange);
  };
  const next = () => update((x) => nextOf(x, x.nouns, (src) => ask(x, src)));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
      <ScoreLine score={score} />
      {r.noRepeat && <div style={{ ...counterStyle, fontSize: "11px", marginTop: "-10px" }}>{r.asked.size} / {r.nouns.length} attempted</div>}
      <div style={{ textAlign: "center" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
          <SpeakButton text={picked ? word.de : stripArticle(word.de)} />
          <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "34px", letterSpacing: "-0.01em", color: "var(--ink)" }}>{stripArticle(word.de)}</div>
          {picked && <button onClick={next} style={navBtnStyle}>next ›</button>}
        </div>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "15px", color: "var(--ink-soft)", marginTop: "8px" }}>{word.en}</div>
      </div>
      <div style={{ display: "flex", gap: "12px" }}>
        {ARTICLES.map((art) => {
          const meta = CATEGORY_META[art];
          let bg = meta.color + "0d", color = meta.color, shadow = "none", border = meta.color + "66";
          if (picked) {
            if (art === word.cat) { bg = meta.color; color = "#FCF8EE"; shadow = `0 10px 24px -10px ${meta.color}`; border = meta.color; }
            else if (art === r.picked) { bg = "var(--bad)"; color = "#FCF8EE"; border = "var(--bad)"; }
            else { bg = "transparent"; color = "var(--ink-faint)"; }
          }
          return (
            <button key={art} onClick={() => answer(art)} style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "21px", padding: "14px 30px", borderRadius: "12px", border: `1.5px solid ${border}`, background: bg, color, boxShadow: shadow, cursor: picked ? "default" : "pointer" }}>
              {art}
            </button>
          );
        })}
      </div>
      {picked && <AiSentence card={word} apiKey={geminiKey} />}
    </div>
  );
}

export function SeparableVerbs({ settings, version, onChange, geminiKey }) {
  const { levels, cats } = settings;
  const ask = (r, avoidKey) => {
    const src = r.playable.length > 1 && avoidKey ? r.playable.filter((d) => d.key !== avoidKey) : r.playable;
    r.card = pick1(src);
    r.answer = sepParts(r.card).prefix;
    r.cloze = sepCloze(r.card, r.answer);
    r.options = shuffled(shuffled(SEP_COMMON.filter((p) => p !== r.answer)).slice(0, 3).concat([r.answer]));
    r.picked = null;
  };
  const { round: r, update, error } = useRound((content) => {
    const playable = content.pool(levels, cats).filter((d) => {
      if (d.cat !== "sep") return false;
      const prefix = sepParts(d).prefix;
      return !!prefix && sepCloze(d, prefix) != null;
    });
    const x = { playable, card: null, answer: null, cloze: null, options: [], picked: null, right: 0, total: 0 };
    if (playable.length >= 4) ask(x, null);
    return x;
  }, [version, levels.join(), cats.join()], version);
  if (error) return <DrillError message={error} />;
  if (!r) return <Loading />;
  if (r.playable.length < 4) return <p style={srsNote}>Not enough separable verbs in the current selection — turn on the <strong>trenn.</strong> category (and a level or two) in settings ▸.</p>;
  const picked = r.picked != null;
  const accent = CATEGORY_META.sep.color;
  const { inf } = sepParts(r.card);
  const sentence = (r.cloze.before + r.cloze.answer + r.cloze.after).trim();
  const answer = (opt) => {
    if (picked) return;
    update((x) => { x.picked = opt; x.right += opt === x.answer ? 1 : 0; x.total += 1; });
    saveAnswer("sep", r.card.key, opt, onChange);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
      <ScoreLine score={{ right: r.right, total: r.total }} extra={<span style={{ marginLeft: "12px", color: "var(--ink-faint)" }}>· {r.playable.length} verbs</span>} />
      <div style={{ ...cardFace, position: "relative", padding: "26px 22px" }}>
        {picked && <button onClick={() => update((x) => ask(x, x.card.key))} style={{ ...navBtnStyle, position: "absolute", right: "14px", top: "18px", zIndex: 5, padding: "8px 14px", fontSize: "11px", borderRadius: "999px" }}>next ›</button>}
        <div style={{ marginBottom: "14px" }}><CatChip cat="sep" /></div>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "15px", color: "var(--ink-soft)", marginBottom: "12px" }}>{picked ? `${inf} — ${r.card.en}` : r.card.en}</div>
        <GapSentence before={r.cloze.before} gap={r.cloze.answer} after={r.cloze.after} revealed={picked} accent={accent} minWidth="68px" />
        {picked && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginTop: "14px" }}>
            <SpeakButton text={sentence} size={30} />
            <div style={{ ...monoLabel, color: r.picked === r.answer ? "var(--good)" : "var(--bad)" }}>{r.picked === r.answer ? "richtig" : `→ ${r.answer}`}</div>
          </div>
        )}
      </div>
      <div style={monoLabel}>which prefix goes in the gap?</div>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", width: "min(440px, 92vw)" }}>
        {r.options.map((opt) => {
          let bg = accent + "0d", color = accent, border = accent + "66", shadow = "none";
          if (picked) {
            if (opt === r.answer) { bg = accent; color = "#FCF8EE"; border = accent; shadow = `0 10px 24px -10px ${accent}`; }
            else if (opt === r.picked) { bg = "var(--bad)"; color = "#FCF8EE"; border = "var(--bad)"; }
            else { bg = "transparent"; color = "var(--ink-faint)"; border = "var(--line-card)"; }
          }
          return (
            <button key={opt} onClick={() => answer(opt)} style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "19px", padding: "12px 24px", borderRadius: "12px", border: `1.5px solid ${border}`, background: bg, color, boxShadow: shadow, cursor: picked ? "default" : "pointer" }}>
              {opt}
            </button>
          );
        })}
      </div>
      {picked && <AiSentence card={r.card} apiKey={geminiKey} />}
    </div>
  );
}

export function ClozeQuiz({ settings, version, onChange, geminiKey }) {
  const { levels, cats, noRepeat } = settings;
  const ask = (r, source) => {
    const q = choiceQuestion(r.clozePool, source);
    r.correct = q.correct; r.options = q.options; r.hit = clozeMatch(q.correct);
    if (r.noRepeat) r.asked.add(r.correct.key);
  };
  const reset = (r) => { if (r.clozePool.length < 4) return; r.asked.clear(); r.done = false; r.picked = null; ask(r, null); };
  const { round: r, update, error } = useRound((content) => {
    const clozePool = content.pool(levels, cats).filter((d) => isNoun(d) && d.example && clozeMatch(d) != null);
    const x = { clozePool, noRepeat, asked: new Set(), correct: null, hit: null, options: [], picked: null, right: 0, total: 0, done: false };
    reset(x);
    return x;
  }, [version, levels.join(), cats.join(), noRepeat], version);
  if (error) return <DrillError message={error} />;
  if (!r) return <Loading />;
  if (r.clozePool.length < 4) return <p style={srsNote}>Fill-in-the-blank runs on example sentences — select <strong>der / die / das</strong> in settings ▸ (and enough nouns) to play.</p>;
  const score = { right: r.right, total: r.total };
  if (r.done) {
    return (
      <div style={{ ...srsCol, padding: "40px 0" }}>
        <ScoreLine score={score} />
        <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>All {r.clozePool.length} / {r.clozePool.length} sentences done — every gap filled. SPLAT! 🎯</div>
        <button onClick={() => update(reset)} style={navBtnStyle}>⟲ start over</button>
      </div>
    );
  }
  const picked = r.picked != null;
  const card = r.correct;
  const options = r.options.map((o) => ({ key: o.key, label: nounForms(o)[0] || o.de }));
  const sentence = (r.hit.before + r.hit.answer + r.hit.after).trim();
  const answer = (key) => {
    if (picked) return;
    update((x) => { x.picked = key; x.right += key === card.key ? 1 : 0; x.total += 1; });
    saveAnswer("cloze", card.key, key, onChange);
  };
  const next = () => update((x) => nextOf(x, x.clozePool, (src) => ask(x, src)));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
      <ScoreLine score={score} />
      {r.noRepeat && <div style={{ ...counterStyle, fontSize: "11px", marginTop: "-10px" }}>{r.asked.size} / {r.clozePool.length} attempted</div>}
      <div style={{ ...cardFace, position: "relative", padding: "26px 22px" }}>
        {picked && <button onClick={next} style={{ ...navBtnStyle, position: "absolute", right: "14px", top: "18px", zIndex: 5, padding: "8px 14px", fontSize: "11px", borderRadius: "999px" }}>next ›</button>}
        <div style={{ marginBottom: "16px" }}><CatChip cat={card.cat} /></div>
        <GapSentence before={r.hit.before} gap={r.hit.answer} after={r.hit.after} revealed={picked} accent={catColor(card.cat)} />
        {picked && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", marginTop: "14px" }}>
            <SpeakButton text={sentence} size={30} />
            <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "14px", color: "var(--ink-soft)" }}>{card.de} · {card.en}</div>
          </div>
        )}
      </div>
      <OptionList options={options} picked={r.picked} correctKey={picked ? card.key : null} onPick={answer} textKey="label" align="center" width="min(440px, 92vw)" />
      {picked && <AiSentence card={card} apiKey={geminiKey} />}
    </div>
  );
}

export function MistakesReview({ version, onChange, geminiKey }) {
  const drill = useDrill("review", null, version, onChange);
  return (
    <DrillGate drill={drill}>{(v, act) => {
      if (v.total === 0 && (v.done || !v.card)) {
        return (
          <p style={srsNote}>
            Nothing to review yet. Words you miss in <strong>Quiz</strong>, <strong>Articles</strong>, <strong>Fill-in</strong> or <strong>Trennbare Verben</strong> — or flag with <strong>✗&nbsp;review&nbsp;this</strong> on a card — collect here and stay until <em>you</em> take them off. Revise them as often as you like.
          </p>
        );
      }
      if (v.done) {
        return (
          <div style={{ ...srsCol, padding: "32px 0" }}>
            <div style={counterStyle}>THIS ROUND {v.gotRight} / {v.answered} right</div>
            <div style={{ fontFamily: "var(--font-serif)", fontSize: "22px", color: "var(--ink)", textAlign: "center" }}>{`${v.total} word${v.total === 1 ? "" : "s"} on the list`}</div>
            <div style={{ ...monoLabel, letterSpacing: "0.08em", textTransform: "none", textAlign: "center", maxWidth: "min(420px, 90vw)", lineHeight: 1.6 }}>words stay here until you take them off — revise as long as you like</div>
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
              {v.missedThisRound > 0 && <button onClick={() => act("redoMissed")} style={navBtnStyle}>↻ redo the {v.missedThisRound} I missed</button>}
              <button onClick={() => act("reviewAll")} style={navBtnStyle}>⟲ review all {v.total}</button>
            </div>
          </div>
        );
      }
      const picked = v.picked != null;
      return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "18px" }}>
          <div style={counterStyle}>REVIEW {v.position} / {v.queueSize}<span style={{ marginLeft: "14px", color: "var(--ink-faint)" }}>· {v.total} on list</span></div>
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: "10px" }}><CatChip cat={v.card.cat} /></div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
              {v.direction === "de-en" && <SpeakButton text={v.card.de} />}
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "30px", letterSpacing: "-0.01em", color: "var(--ink)" }}>{v.prompt}</div>
              {v.direction === "en-de" && picked && <SpeakButton text={v.card.de} />}
              {picked && <button onClick={() => act("next")} style={navBtnStyle}>next ›</button>}
            </div>
            <div style={{ ...monoLabel, marginTop: "10px" }}>{v.wrong ? `missed ${v.wrong}×` : "flagged"}{v.right ? `  ·  got it ${v.right}×` : ""}</div>
          </div>
          <OptionList options={v.options} picked={v.picked} correctKey={v.correctKey} onPick={(key) => act("answer", { key })} />
          {picked && <AiSentence card={v.card} apiKey={geminiKey} />}
          {picked && <button onClick={() => act("remove")} style={{ ...ghostBtn, color: "var(--good)", border: "1px solid var(--good)" }}>✓ I know this — take it off the list</button>}
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center", marginTop: "6px" }}>
            <button onClick={() => act("reshuffle")} style={{ ...smallOutline("var(--ink-soft)"), borderColor: "var(--line)" }}>⟲ reshuffle round</button>
            <button onClick={() => { if (window.confirm(`Clear all ${v.total} words from the review list? This can't be undone.`)) act("clearAll"); }} style={smallOutline("var(--bad)")}>clear whole list</button>
          </div>
        </div>
      );
    }}</DrillGate>
  );
}
