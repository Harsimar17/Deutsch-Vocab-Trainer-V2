import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import ReactDOM from "react-dom";
import { api } from "../lib/api.js";
import { useContent, useDrill } from "../lib/content.js";
import { CatChip, DrillError, Loading, SpeakButton, Switch, catColor, ghostBtn, miniBtn, monoLabel, navBtnStyle, optionColors, smallOutline, srsCol, srsNote } from "../ui/common.jsx";
import { PhaseSentences } from "../practice/drills.jsx";

// ---------- STORY MODE ----------

// Tooltip with a word's meaning, as analysed by the backend. Portalled to
// <body> (the tab wrapper's transform would break position: fixed) and
// re-measured on scroll so it follows the word.
export function WordTip({ tip }) {
  const { el, entry, word } = tip;
  const [, reflow] = useState(0);
  useEffect(() => {
    const onMove = () => reflow((n) => n + 1);
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => { window.removeEventListener("scroll", onMove, true); window.removeEventListener("resize", onMove); };
  }, []);
  const rect = el.getBoundingClientRect();
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const w = Math.min(270, vw - 32);
  const cx = Math.min(Math.max(rect.left + rect.width / 2, w / 2 + 16), vw - w / 2 - 16);
  const above = rect.top > 170;
  const bare = String(entry.head || "").replace(/^(der|die|das)\s+/i, "").toLowerCase();
  return ReactDOM.createPortal(
    <div data-tip="1" role="tooltip" style={{
      position: "fixed", zIndex: 50, left: cx, width: w, boxSizing: "border-box", top: above ? rect.top - 8 : rect.bottom + 8,
      transform: above ? "translate(-50%, -100%)" : "translate(-50%, 0)", background: "var(--paper-raised)", border: "1px solid var(--line)",
      borderRadius: "12px", boxShadow: "var(--shadow-card)", padding: "12px 14px", textAlign: "left", animation: "tipIn .14s ease both",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
        <CatChip cat={entry.cat} />
        {entry.lvl && <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.12em", color: "var(--ink-faint)" }}>{entry.lvl}</span>}
        {tip.pinned && <span style={{ marginLeft: "auto" }}><SpeakButton text={entry.head} size={28} /></span>}
      </div>
      <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "17px", color: "var(--ink)", lineHeight: 1.3 }}>{entry.head}</div>
      <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "15px", color: "var(--ink-soft)", marginTop: "3px", lineHeight: 1.4 }}>{entry.en}</div>
      {word.toLowerCase() !== bare && <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", letterSpacing: "0.08em", color: "var(--ink-faint)", marginTop: "6px" }}>im Text: {word}</div>}
      {entry.example && <div style={{ fontFamily: "var(--font-serif)", fontSize: "13px", color: "var(--ink-soft)", marginTop: "8px", paddingTop: "8px", borderTop: "1px solid var(--line)", lineHeight: 1.45 }}>{entry.example}</div>}
    </div>,
    document.body
  );
}

// Phase test status from the backend, in words.
// What a phase test's two sets are called: the stories' target words, and the B1 verbs used in them.
export const SET_NAME = { words: "Wörter", verbs: "Verben" };  // in the German texts
export const SET_LABEL = { words: "Words", verbs: "Verbs", sentences: "Sentences" };   // on buttons

export function testStatusText(s, unit = "words") {
  if (!s) return { text: "", tone: "var(--ink-faint)" };
  switch (s.kind) {
    case "refreshDue": return { text: "⏰ refresher due", tone: "var(--accent)" };
    case "practiceAgain": return { text: "↻ practise " + s.open + " " + unit + " again", tone: "var(--bad)" };
    case "passed": return { text: "✓ passed · next refresher " + new Date(s.due).toLocaleDateString(undefined, { day: "numeric", month: "short" }), tone: "var(--good)" };
    case "inProgress": return { text: s.mastered + " / " + s.total + " mastered", tone: "var(--ink-faint)" };
    default: return { text: s.total + " " + unit + " · not started yet", tone: "var(--ink-faint)" };
  }
}

export function StoriesList({ progress, onSettings }) {
  const [content, error] = useContent();
  if (error) return <DrillError message={error} />;
  if (!content) return <Loading />;
  const data = content.storyList(progress);
  if (!data.groups.length) return <p style={srsNote}>No stories found in german_vocab.json.</p>;
  return (
    <div style={{ ...srsCol, width: "100%", maxWidth: "560px", margin: "0 auto", alignItems: "stretch", gap: "22px" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.28em", color: "var(--accent)", marginBottom: "8px" }}>{data.level} · LESEN</div>
        <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "30px", color: "var(--ink)", letterSpacing: "-0.01em" }}>Geschichten</div>
        <div style={{ ...monoLabel, color: "var(--ink-soft)", marginTop: "8px" }}>{data.readCount} / {data.total} gelesen</div>
      </div>
      {data.groups.map((g, gi) => {
        const st = testStatusText(g.test, "words");
        const vt = testStatusText(g.verbTest, "verbs");
        const testDue = (g.test && g.test.dueNow) || (g.verbTest && g.verbTest.dueNow);
        return (
          <div key={gi} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div>
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "18px", color: "var(--ink)" }}>{g.phase.name}</div>
              {g.phase.description && <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "13px", color: "var(--ink-soft)" }}>{g.phase.description}</div>}
              {g.phase.note && <div style={{ fontFamily: "var(--font-serif)", fontSize: "13px", color: "var(--ink-faint)", marginTop: "4px", lineHeight: 1.5 }}>{g.phase.note}</div>}
            </div>
            {g.stories.map((s) => (
              <button key={s.id} onClick={() => onSettings("openStory", s.id)} style={{
                display: "flex", alignItems: "center", gap: "12px", textAlign: "left", width: "100%", padding: "12px 14px", borderRadius: "12px",
                border: "1px solid " + (s.read ? "var(--good-soft)" : "var(--line-card)"), background: "var(--paper-raised)", boxShadow: "var(--shadow-soft)", cursor: "pointer", color: "var(--ink)",
              }}>
                <span style={{ flexShrink: 0, width: "34px", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-faint)" }}>{String(s.chapter).padStart(2, "0")}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "16px", lineHeight: 1.3 }}>{s.titleDe}</span>
                  <span style={{ display: "block", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "13px", color: "var(--ink-soft)", marginTop: "2px" }}>{s.titleEn}</span>
                </span>
                <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.06em", color: s.read ? "var(--good)" : "var(--ink-faint)", textAlign: "right" }}>{s.read ? "✓" : s.words + " w."}</span>
              </button>
            ))}
            {g.test && (
              <button onClick={() => onSettings("openPhaseTest", g.phase.index)} style={{
                display: "flex", alignItems: "center", gap: "12px", textAlign: "left", width: "100%", padding: "12px 14px", borderRadius: "12px", cursor: "pointer", color: "var(--ink)",
                border: "1px dashed " + (testDue ? "var(--accent)" : "var(--line)"), background: testDue ? "var(--word-hover)" : "var(--tint)",
              }}>
                <span style={{ flexShrink: 0, width: "34px", fontSize: "18px", textAlign: "center" }}>🎯</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "16px" }}>Phase test</span>
                  <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.04em", color: st.tone, marginTop: "3px" }}>
                    Words: {st.text}{!g.test.passed && !g.allRead ? " · recommended after all chapters" : ""}
                  </span>
                  {g.verbTest && (
                    <span style={{ display: "block", fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.04em", color: vt.tone, marginTop: "2px" }}>
                      Verbs: {vt.text}
                    </span>
                  )}
                </span>
                <span style={{ flexShrink: 0, fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--ink-faint)" }}>DE⇄EN</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// A line typed out letter by letter, with a blinking caret while it types.
export function TypedLine({ text, speed = 26 }) {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [n, setN] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) { setN(text.length); return undefined; }
    setN(0);
    let i = 0;
    const t = setInterval(() => { i += 1; setN(i); if (i >= text.length) clearInterval(t); }, speed);
    return () => clearInterval(t);
  }, [text]);
  return <div className="typed">{text.slice(0, n)}{n < text.length && <span className="caret" />}</div>;
}

export const PaperClip = () => (
  <svg className="clip" viewBox="0 0 26 64" aria-hidden="true">
    <path d="M8 22 V48 a5 5 0 0 0 10 0 V12 a8 8 0 0 0 -16 0 V50 a11 11 0 0 0 22 0 V24" fill="none" stroke="#8b8e95" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);

// The story as a notebook page on a desk, like a mission briefing: the page
// slides in, the header types itself, the chapter is stamped, the paragraphs
// appear one by one. Words stay tappable for their meaning.
export function StoryReader({ id, read, showEn, onRead, onSettings }) {
  const [content, error] = useContent();
  const story = content ? content.reader(id) : null;
  const [tip, setTip] = useState(null);
  const [glossOpen, setGlossOpen] = useState(false);
  const topRef = useRef(null);
  useEffect(() => {
    setTip(null); setGlossOpen(false);
    if (topRef.current && topRef.current.getBoundingClientRect().top < 0) topRef.current.scrollIntoView({ block: "start" });
  }, [id]);
  // Close the tooltip on tap outside or Escape.
  useEffect(() => {
    if (!tip) return;
    const onDown = (e) => { if (e.target && e.target.closest && e.target.closest("[data-sw],[data-tip]")) return; setTip(null); };
    const onKey = (e) => { if (e.key === "Escape") setTip(null); };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [tip]);

  const frame = { ...srsCol, width: "100%", maxWidth: "640px", margin: "0 auto", gap: "18px", alignItems: "stretch", scrollMarginTop: "12px" };
  if (error) return <DrillError message={error} />;
  if (content && !story) return <DrillError message={"no such story: " + id} />;
  if (!story) {
    return (
      <div ref={topRef} style={frame}>
        <div className="notebook" style={{ minHeight: "220px" }}>
          <div className="holes" />
          <TypedLine text="Lade Kapitel …" />
        </div>
      </div>
    );
  }
  const show = (e, key, seg, pinned) => setTip({ key, el: e.currentTarget, entry: seg.entry, word: seg.w, pinned });
  const setShowEn = (v) => onSettings("setStoryShowEn", v);
  const toggleRead = () => api.post("/api/stories/" + encodeURIComponent(story.id) + "/read").then((r) => onRead(story.id, r.read)).catch(api.report);
  const hover = window.matchMedia && window.matchMedia("(hover: hover)").matches;
  const chapter = String(story.chapter).padStart(2, "0");

  return (
    <div ref={topRef} style={frame}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
        <button onClick={() => onSettings("openStory", null)} style={miniBtn}>‹ all stories</button>
        <Switch on={!!showEn} onChange={setShowEn} label="English notes" />
      </div>
      <div className="notebook" key={story.id}>
        <div className="holes" />
        <PaperClip />
        <TypedLine text={"Leseauftrag" + (story.phaseName ? " · " + story.phaseName : "")} />
        <div className="stamp">KAPITEL {chapter}</div>
        <div className="title">{story.titleDe}</div>
        <div className="hand" style={{ fontSize: "20px", color: "#6b6150", marginTop: "2px" }}>{story.titleEn}</div>
        <div style={{ fontFamily: "'Special Elite', 'Courier New', monospace", fontSize: "11px", color: "var(--ink-faint)", margin: "10px 0 14px", lineHeight: 1.6 }}>
          <span className="st" style={{ fontFamily: "var(--font-serif)", fontSize: "13px" }}>underlined</span> = B1 target word · tap{hover ? " or hover" : ""} a word for its meaning
        </div>
        {story.paragraphs.map((p, pi) => (
          <div key={story.id + "-" + pi} className="reveal" style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "var(--rule)", animationDelay: (1.1 + pi * 0.18) + "s" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p className="para">
                {p.segments.map((seg, si) => {
                  if (seg.t != null) return <React.Fragment key={si}>{seg.t}</React.Fragment>;
                  const key = pi + "-" + si;
                  if (!seg.entry) return <span key={si} className="st">{seg.w}</span>;
                  const on = tip && tip.key === key;
                  return (
                    <span key={si} data-sw="1" className={(seg.target ? "st sw" : "sw") + (on ? " on" : "")}
                      onPointerEnter={(e) => { if (e.pointerType === "mouse" && !(tip && tip.pinned)) show(e, key, seg, false); }}
                      onPointerLeave={(e) => { if (e.pointerType === "mouse") setTip((t) => (t && !t.pinned ? null : t)); }}
                      onClick={(e) => { if (tip && tip.key === key && tip.pinned) setTip(null); else show(e, key, seg, true); }}>
                      {seg.w}
                    </span>
                  );
                })}
              </p>
              {showEn && p.en && <p className="pencil">{p.en}</p>}
            </div>
            <SpeakButton text={p.speech} size={30} />
          </div>
        ))}
        {story.glossary.length > 0 && (
          <div className="reveal" style={{ borderTop: "1px dashed rgba(196,62,62,.45)", paddingTop: "12px", animationDelay: (1.2 + story.paragraphs.length * 0.18) + "s" }}>
            <button onClick={() => setGlossOpen((o) => !o)} className="hand" style={{ fontSize: "22px", color: "#23324f", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>
              {glossOpen ? "▾" : "▸"} Wortliste ({story.glossary.length})
            </button>
            {glossOpen && (
              <div style={{ display: "flex", flexDirection: "column", marginTop: "4px" }}>
                {story.glossary.map((g, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "baseline", gap: "8px", lineHeight: "var(--rule)" }}>
                    <span style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "15px", color: catColor(g.cat), whiteSpace: "nowrap" }}>{g.de}</span>
                    <span style={{ flex: 1, borderBottom: "1px dotted var(--ink-faint)", transform: "translateY(-4px)" }} />
                    <span className="hand" style={{ fontSize: "19px", color: "#4a5f8a", textAlign: "right" }}>{g.en}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", paddingTop: "4px" }}>
        <button onClick={toggleRead} style={{ ...navBtnStyle, background: read ? "var(--good)" : "transparent", border: "1px solid " + (read ? "var(--good)" : "var(--ink-muted)"), color: read ? "#F6F1E5" : "var(--ink-muted)", boxShadow: "none" }}>
          {read ? "✓ read" : "mark as read"}
        </button>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          {story.endsPhase && <button onClick={() => onSettings("openPhaseTest", story.endsPhase)} style={{ ...navBtnStyle, background: "var(--good)", borderColor: "var(--good)" }}>🎯 Phase test</button>}
          {story.prev && <button onClick={() => onSettings("openStory", story.prev.id)} style={navBtnStyle}>‹ Chapter {story.prev.chapter}</button>}
          {story.next && <button onClick={() => onSettings("openStory", story.next.id)} style={navBtnStyle}>Chapter {story.next.chapter} ›</button>}
        </div>
      </div>
      {tip && <WordTip tip={tip} />}
    </div>
  );
}

export function MasteryBar({ status }) {
  const pct = status && status.total ? Math.round((status.mastered / status.total) * 100) : 0;
  return (
    <div style={{ width: "100%", height: "4px", background: "var(--line)", borderRadius: "999px", overflow: "hidden" }}>
      <div style={{ width: pct + "%", height: "100%", background: "var(--good)", transition: "width .3s ease" }} />
    </div>
  );
}

export function PhaseTestPage({ idx, onSettings, onChange }) {
  const [set, setSet] = useState("words"); // "words" | "verbs" | "sentences" — the three tabs
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const [round, setRound] = useState(null); // { refresh, retake, n } while a round is running
  const [howOpen, setHowOpen] = useState(false);
  const load = useCallback(() => {
    if (set === "sentences") return; // a round of its own, no overview
    api.get("/api/phase-tests/" + idx + "?set=" + set).then(setOverview).catch((e) => setError(e.message));
  }, [idx, set]);
  useEffect(() => { load(); }, [load]);

  if (round) {
    return <PhaseRound key={round.n} idx={idx} set={set} refresh={round.refresh} retake={round.retake} onChange={onChange}
      onExit={() => { setRound(null); load(); }} onNext={() => setRound({ refresh: false, retake: round.retake, n: round.n + 1 })} />;
  }
  if (error) return <DrillError message={error} />;
  const tabs = (
    <div role="tablist" aria-label="Phasentest" style={{ display: "flex", gap: "3px", padding: "3px", background: "var(--tint)", border: "1px solid var(--line)", borderRadius: "999px", alignSelf: "center" }}>
      {["words", "verbs", "sentences"].map((k) => (
        <button key={k} role="tab" aria-selected={set === k} onClick={() => setSet(k)} style={{
          fontFamily: "var(--font-mono)", fontSize: "10px", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 18px",
          border: "none", borderRadius: "999px", background: set === k ? "var(--btn-grad)" : "transparent", color: set === k ? "#FCF8EE" : "var(--ink-soft)", cursor: "pointer",
        }}>{SET_LABEL[k]}</button>
      ))}
    </div>
  );
  if (set === "sentences") {
    return (
      <div style={{ ...srsCol, width: "100%", maxWidth: "560px", margin: "0 auto", alignItems: "stretch", gap: "18px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <button onClick={() => onSettings("openPhaseTest", null)} style={miniBtn}>‹ all stories</button>
          <span style={{ ...monoLabel, fontSize: "9px", textAlign: "right" }}>🎯 Phasentest · {overview ? overview.phase.name : ""}</span>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "26px", color: "var(--ink)" }}>Phasentest</div>
          <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "14px", color: "var(--ink-soft)", marginTop: "4px" }}>
            Use this phase's words and verbs in sentences
          </div>
        </div>
        {tabs}
        <PhaseSentences idx={idx} onChange={onChange} />
      </div>
    );
  }
  if (!overview || overview.set !== set) {
    return <div style={{ ...srsCol, width: "100%", maxWidth: "560px", margin: "0 auto", alignItems: "stretch", gap: "18px" }}>{tabs}<Loading /></div>;
  }
  const o = overview;
  const s = o.status;
  const unit = SET_NAME[set];
  const unitEn = SET_LABEL[set].toLowerCase();
  const st = testStatusText(s, unitEn);
  const start = (refresh, retake) => setRound({ refresh, retake: retake || null, n: Date.now() });
  return (
    <div style={{ ...srsCol, width: "100%", maxWidth: "560px", margin: "0 auto", alignItems: "stretch", gap: "18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <button onClick={() => onSettings("openPhaseTest", null)} style={miniBtn}>‹ all stories</button>
        <span style={{ ...monoLabel, fontSize: "9px", textAlign: "right" }}>🎯 Phasentest · {o.phase.name}</span>
      </div>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "26px", color: "var(--ink)" }}>Phasentest</div>
        <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: "14px", color: "var(--ink-soft)", marginTop: "4px" }}>
          {o.phase.name} · {set === "verbs" ? s.total + " B1-Verben aus den " + o.phase.chapters + " Kapiteln" : s.total + " Wörter aus " + o.phase.chapters + " Kapiteln"}
        </div>
      </div>
      {tabs}
      <MasteryBar status={s} />
      <div style={{ display: "flex", justifyContent: "space-around", gap: "10px", flexWrap: "wrap", textAlign: "center" }}>
        {[["gemeistert", s.mastered], ["DE → EN sicher", o.recDone], ["EN → DE sicher", o.prodDone]].map(([l, n]) => (
          <div key={l}>
            <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "22px", color: "var(--ink)" }}>{n}<span style={{ fontSize: "13px", color: "var(--ink-faint)" }}> / {s.total}</span></div>
            <div style={monoLabel}>{l}</div>
          </div>
        ))}
      </div>
      <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.06em", color: st.tone }}>{st.text}</div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
        {s.dueNow && <button onClick={() => start(true)} style={navBtnStyle}>⏰ Start refresher · {o.refreshWords} {unitEn}</button>}
        {s.open > 0 && (
          <button onClick={() => start(false)} style={s.dueNow ? ghostBtn : navBtnStyle}>
            {s.started ? "▶ Next round" : "▶ Start test"} · {o.roundWords} {unitEn}
          </button>
        )}
        {s.open === 0 && !s.dueNow && <div style={{ ...srsNote, fontSize: "14px" }}>Alle {unit} sitzen. Die nächste Auffrischung erscheint hier, wenn sie fällig ist — genau dann, wenn du sonst anfangen würdest zu vergessen.</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px", borderTop: "1px solid var(--line)", paddingTop: "14px" }}>
        <div style={{ ...monoLabel }}>↻ Test wiederholen — jederzeit, dein Fortschritt bleibt</div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
          <button onClick={() => start(false, "short")} style={ghostBtn}>short · {2 * o.retakeShortWords} questions</button>
          <button onClick={() => start(false, "all")} style={ghostBtn}>full · {2 * s.total} questions</button>
        </div>
        {o.attempts.length > 0 && (
          <div style={{ width: "100%", marginTop: "6px" }}>
            <div style={{ ...monoLabel, marginBottom: "6px" }}>deine Ergebnisse</div>
            {o.attempts.map((t, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: "10px", padding: "6px 2px", borderBottom: "1px dashed var(--line)", fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--ink-soft)" }}>
                <span>{new Date(t.at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · {t.size === "all" ? "komplett" : "kurz"}</span>
                <span style={{ color: t.right === t.total ? "var(--good)" : "var(--ink)" }}>{t.right} / {t.total} · {t.total ? Math.round((t.right / t.total) * 100) : 0}%</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {o.missed.length > 0 && (
        <div>
          <div style={{ ...monoLabel, marginBottom: "8px" }}>am häufigsten verfehlt</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {o.missed.map((w) => (
              <span key={w.de} style={{ fontFamily: "var(--font-serif)", fontSize: "14px", padding: "4px 10px", borderRadius: "999px", border: "1px solid var(--line)", background: "var(--paper-raised)", color: "var(--ink)" }}>
                {w.de} <span style={{ color: "var(--bad)", fontFamily: "var(--font-mono)", fontSize: "10px" }}>×{w.miss}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: "12px" }}>
        <button onClick={() => setHowOpen((x) => !x)} style={{ ...monoLabel, fontSize: "11px", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--ink-soft)" }}>
          {howOpen ? "▾" : "▸"} how it works
        </button>
        {howOpen && (
          <ol style={{ fontFamily: "var(--font-serif)", fontSize: "14px", color: "var(--ink-soft)", lineHeight: 1.6, paddingLeft: "20px", margin: "10px 0 0" }}>
            <li><strong>Erkennen</strong> (DE → EN): wähle die Bedeutung aus vier. Tasten 1–4.</li>
            <li><strong>Produzieren</strong> (EN → DE): wähle das deutsche Wort aus vier — bei Nomen mit Artikel. Tasten 1–4.</li>
            <li>Ein Wort sitzt erst, wenn du es in <strong>zwei verschiedenen Runden</strong> beim ersten Versuch richtig hast — in beide Richtungen.</li>
            <li>Fehler kommen in derselben Runde ein paar Fragen später wieder, bis sie sitzen.</li>
            <li>Nach dem Bestehen: <strong>Auffrischungen nach {o.refreshDays.join(", ").replace(/, (\d+)$/, " und $1")} Tagen</strong> — schwächste Wörter zuerst. Wer dort patzt, übt das Wort erneut.</li>
            <li><strong>Wörter</strong> sind die markierten Zielwörter der Geschichten, <strong>Verben</strong> die B1-Verben, die in den Geschichten vorkommen — jeweils mit eigenem Fortschritt. Bei den Verben steht der Satz aus der Geschichte als Beispiel.</li>
            <li>Jede Antwort fließt auch in deinen Lernplan (Study-Tab, Stufe B1).</li>
            <li><strong>Test wiederholen</strong> geht jederzeit — kurz (10 zufällige {unit}) oder komplett. Es zählt nur das Ergebnis; Fortschritt, Auffrischungen und Lernplan bleiben unverändert.</li>
          </ol>
        )}
        {s.started && (
          <button onClick={() => { if (window.confirm("Fortschritt dieses Phasentests (" + unit + ") zurücksetzen? Das kann nicht rückgängig gemacht werden.")) api.post("/api/phase-tests/" + idx + "/reset?set=" + set).then(setOverview).catch(api.report); }}
            style={{ ...smallOutline("var(--bad)"), fontSize: "9px", display: "block", marginTop: "14px", padding: "3px 9px" }}>
            Reset progress
          </button>
        )}
      </div>
    </div>
  );
}

export function PhaseRound({ idx, set, refresh, retake, onExit, onNext, onChange }) {
  const drill = useDrill("phase", retake ? { phase: idx, set, retake } : { phase: idx, set, refresh }, 0, onChange);
  const v = drill.view;
  const nextRef = useRef(null);
  const answered = !!(v && v.answer);
  const qid = v ? v.state + "#" + v.position + "#" + v.total : "";
  // Focus "weiter" once answered — so Enter always does the obvious thing.
  useEffect(() => {
    if (v && v.state === "question" && answered && nextRef.current) nextRef.current.focus();
  }, [qid, answered]);
  useEffect(() => {
    if (!v || v.state !== "question") return;
    const onKey = (e) => {
      if (e.isComposing) return;
      const el = e.target;
      if (el && el !== nextRef.current && /^(BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === "Enter") {
        if (answered) { e.preventDefault(); drill.act("next"); }
      } else if (!answered && /^[1-4]$/.test(e.key) && v.options[+e.key - 1]) {
        drill.act("choose", { key: v.options[+e.key - 1].key });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const head = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
      <button onClick={v && v.state === "finished" ? onExit : () => { if (window.confirm(retake ? "Wiederholung abbrechen? Es wird kein Ergebnis gespeichert." : "Runde abbrechen? Bisherige Antworten bleiben gespeichert.")) onExit(); }} style={miniBtn}>
        {v && v.state === "finished" ? "‹ Overview" : "× Cancel round"}
      </button>
      <span style={{ ...monoLabel, fontSize: "9px", textAlign: "right" }}>🎯 Phasentest · {SET_NAME[set]}{retake ? " · Wiederholung" : ""}</span>
    </div>
  );
  const wrap = (children) => <div style={{ ...srsCol, width: "100%", maxWidth: "560px", margin: "0 auto", alignItems: "stretch", gap: "18px" }}>{head}{children}</div>;

  if (drill.error) return wrap(<DrillError message={drill.error} />);
  if (!v) return wrap(<Loading />);

  if (v.state === "finished") {
    const pct = v.first ? Math.round((v.right / v.first) * 100) : 0;
    const st = testStatusText(v.status);
    return wrap(
      <React.Fragment>
        <div style={{ textAlign: "center", padding: "20px 0 6px" }}>
          <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "24px", color: "var(--ink)" }}>{retake ? "Wiederholung fertig" : v.passedNow ? "Phase bestanden" : v.refresh ? "Auffrischung fertig" : "Runde fertig"}</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", letterSpacing: "0.08em", color: "var(--ink-soft)", marginTop: "10px" }}>{v.right} / {v.first} {retake ? "richtig" : "beim ersten Versuch richtig"} ({pct}%)</div>
        </div>
        <MasteryBar status={v.status} />
        <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "11px", color: st.tone }}>{st.text}</div>
        {retake && <p style={{ ...srsNote, fontSize: "14px" }}>Dein Fortschritt bleibt, wie er war — das Ergebnis steht in der Übersicht.</p>}
        {v.passedNow && <p style={{ ...srsNote, fontSize: "14px" }}>{set === "verbs" ? "Jedes Verb" : "Jedes Wort"} sitzt in beide Richtungen. Die erste Auffrischung ist morgen fällig — danach nach 7, 30, 90 und 180 Tagen.</p>}
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", justifyContent: "center" }}>
          {retake ? <button onClick={onNext} style={navBtnStyle}>↻ Retake again</button>
            : v.status.open > 0 && <button onClick={onNext} style={navBtnStyle}>▶ Next round</button>}
          <button onClick={onExit} style={ghostBtn}>Overview</button>
        </div>
      </React.Fragment>
    );
  }

  const deEn = v.dir === "de-en";
  const a = v.answer;
  const tone = a ? (a.correct ? "var(--good)" : "var(--bad)") : "var(--line)";
  const verdictText = !a ? "" : a.correct ? "✓ Richtig" : retake ? "✗ Falsch" : "✗ Noch nicht — comes back shortly";
  return wrap(
    <React.Fragment>
      <MasteryBar status={v.status} />
      <div style={{ display: "flex", justifyContent: "space-between", ...monoLabel }}>
        <span>{deEn ? "DE → EN · erkennen" : "EN → DE · deutsches Wort wählen"}{v.relearn ? " · nochmal" : ""}</span>
        <span>{v.position} / {v.total}{v.refresh ? " · Auffrischung" : ""}</span>
      </div>
      <div style={{ textAlign: "center", padding: "10px 0 4px" }}>
        <div style={{ marginBottom: "12px" }}>
          {deEn ? <CatChip cat={v.cat} /> : <span style={{ ...monoLabel, fontSize: "9px", fontWeight: 600, color: "var(--ink-soft)", border: "1px solid var(--line)", borderRadius: "999px", padding: "3px 10px" }}>{v.typeLabel}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", flexWrap: "wrap" }}>
          {deEn && <SpeakButton text={v.prompt} />}
          <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: v.prompt.length > 26 ? "22px" : "30px", color: "var(--ink)", lineHeight: 1.25 }}>{v.prompt}</div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {v.options.map((o, i) => {
          const c = optionColors(a && o.key === v.card.de, a && o.key === a.pick, !!a);
          return (
            <button key={o.key} onClick={() => drill.act("choose", { key: o.key })} style={{ display: "flex", gap: "12px", alignItems: "baseline", textAlign: "left", fontFamily: "var(--font-serif)", fontSize: o.text.length > 30 ? "14px" : "17px", padding: "13px 16px", borderRadius: "12px", border: "1px solid " + c.border, background: c.bg, color: c.color, boxShadow: c.shadow, cursor: a ? "default" : "pointer" }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", opacity: 0.6 }}>{i + 1}</span>{o.text}
            </button>
          );
        })}
      </div>
      {a && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", letterSpacing: "0.08em", color: tone }}>{verdictText}</div>
          {!deEn && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <SpeakButton text={v.card.de} />
              <div style={{ fontFamily: "var(--font-serif)", fontWeight: 600, fontSize: "22px", color: catColor(v.card.cat), textAlign: "center" }}>{v.card.de}</div>
            </div>
          )}
          {deEn && !a.correct && <div style={{ fontFamily: "var(--font-serif)", fontSize: "15px", color: "var(--ink-soft)" }}>{v.card.de} = <strong style={{ color: "var(--ink)" }}>{v.card.en}</strong></div>}
          {v.card.example && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", maxWidth: "min(440px, 100%)", padding: "10px 14px", background: "var(--paper-raised)", border: "1px solid var(--line)", borderRadius: "12px", boxShadow: "var(--shadow-soft)" }}>
              <SpeakButton text={v.card.example} size={30} />
              <div style={{ fontFamily: "var(--font-serif)", fontSize: "15px", color: "var(--ink)", lineHeight: 1.45 }}>{v.card.example}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap", justifyContent: "center" }}>
            <button ref={nextRef} onClick={() => drill.act("next")} style={navBtnStyle}>next › <span style={{ opacity: 0.6 }}>⏎</span></button>
          </div>
          <div style={{ ...monoLabel, fontSize: "8px" }}>aus Kapitel {v.chapter}</div>
        </div>
      )}
    </React.Fragment>
  );
}

// The stories come from german_vocab.json; the learner's read marks and phase
// test statuses are loaded on opening Stories and again after a Phasentest.
// Loaded once per login; fetched again only after a phase test (which changes it).
export const STORY_PROGRESS = { value: null, stale: true };
export function StoriesPage({ settings, onSettings, onChange }) {
  const [progress, setProgressState] = useState(STORY_PROGRESS.value);
  const setProgress = (fn) => setProgressState((p) => (STORY_PROGRESS.value = typeof fn === "function" ? fn(p) : fn));
  useEffect(() => {
    if (settings.storyTest) { STORY_PROGRESS.stale = true; return; }
    if (!STORY_PROGRESS.stale) return;
    STORY_PROGRESS.stale = false;
    api.get("/api/stories/progress", { quiet: true }).then(setProgress).catch((e) => { STORY_PROGRESS.stale = true; api.report(e); });
  }, [settings.storyTest]);
  const onRead = (id, read) => setProgress((p) => p && Object.assign({}, p, { read: read ? p.read.filter((x) => x !== id).concat([id]) : p.read.filter((x) => x !== id) }));
  if (settings.storyTest) return <PhaseTestPage key={settings.storyTest} idx={settings.storyTest} onSettings={onSettings} onChange={onChange} />;
  if (settings.storyOpen) {
    return <StoryReader id={settings.storyOpen} read={!!(progress && progress.read.includes(settings.storyOpen))} showEn={!!settings.storyShowEn}
      onRead={onRead} onSettings={onSettings} />;
  }
  return <StoriesList progress={progress} onSettings={onSettings} />;
}
