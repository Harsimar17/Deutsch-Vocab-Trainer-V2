import React, { useState, useEffect, useRef, useCallback } from "react";
import "../styles/exam.css";
import { api } from "../trainer/lib/api.js";
import { aiJson, providerReady, getProvider, geminiTts, geminiTtsBlocked } from "../talkloop/engine.js";
import {
  DIFFICULTIES, MODULES, TEILE, moduleMinutes, systemPrompt, validTeil, scoreItems, grade,
  writePrompt, buildWriting, gradeWritingPrompt, gradeResult, countWords, CRITERIA_LABELS,
  speakPrompt, buildSpeaking, speakTurnPrompt, gradeSpeakingPrompt, SPEAK_POINTS, EXAMINER, PARTNER,
} from "./spec.js";
import { playLines, stopAudio, warmVoice, listen, stopListening, canListen } from "./audio.js";

// ---------- small helpers ----------
const saved = {
  get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ } },
};
// State that survives a reload: a three-hour exam is not lost to a refresh.
function useSaved(key, initial) {
  const [value, setValue] = useState(() => saved.get(key, typeof initial === "function" ? initial() : initial));
  useEffect(() => { saved.set(key, value); }, [key, value]);
  return [value, setValue];
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (system, text, schema, temperature = 0.9) =>
  aiJson({ systemInstruction: system, schema, contents: [{ role: "user", parts: [{ text }] }], temperature });
// The AI's free tiers answer "busy" now and then: wait and try again before giving up.
async function askBuilt(system, text, schema, build, tries = 3) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      const built = build(await ask(system, text, schema));
      if (built) return built;
      last = new Error("The AI's answer was incomplete.");
    } catch (e) { last = e; }
    if (i < tries - 1) await sleep(i ? 20000 : 6000);
  }
  throw last;
}
const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

function Timer({ deadline, onTimeUp }) {
  const [now, setNow] = useState(Date.now());
  const fired = useRef(false);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  useEffect(() => { if (left === 0 && !fired.current) { fired.current = true; onTimeUp(); } }, [left]);
  return <span className={`exam-timer${left < 300 ? " low" : ""}`} role="timer" aria-label="Time left">{clock(left)}</span>;
}

function ModuleHead({ module, diff, deadline, onTimeUp, onQuit, children }) {
  const d = DIFFICULTIES[diff];
  return (
    <div className="exam-head glass">
      <div>
        <div className="exam-head-title">{module.label}</div>
        <div className="exam-head-sub">{d.label} {d.factor} · bestanden ab {d.pass} %</div>
      </div>
      {children}
      {deadline ? <Timer deadline={deadline} onTimeUp={onTimeUp} /> : <span className="exam-timer">--:--</span>}
      <button className="exam-quit" onClick={onQuit} title="Stop this module without a mark">Abbrechen</button>
    </div>
  );
}

function Problem({ error, onRetry }) {
  return (
    <div className="exam-card exam-problem" role="alert">
      <div>{error}</div>
      {onRetry && <button className="exam-btn" onClick={onRetry}>Try again</button>}
    </div>
  );
}

// ---------- Lesen and Hören ----------
function Item({ number, item, value, onPick, review }) {
  const state = (i) => (!review ? (value === i ? " on" : "") : i === item.answer ? " right" : value === i ? " wrong" : "");
  return (
    <div className={`exam-item${review ? (value === item.answer ? " ok" : " miss") : ""}`}>
      <div className="exam-item-q"><span className="exam-num">{number}</span><span><strong>{item.context ? `${item.prompt}: ` : ""}</strong>{item.context || item.prompt}</span></div>
      {item.select ? (
        <div className="exam-select-row">
          <select value={value ?? ""} disabled={review} onChange={(e) => onPick(e.target.value === "" ? undefined : Number(e.target.value))} aria-label={`Aufgabe ${number}`}>
            <option value="">–</option>
            {item.options.map((o, i) => <option key={i} value={i}>{o === "0" ? "0 (keine Anzeige passt)" : `Anzeige ${o}`}</option>)}
          </select>
          {review && value !== item.answer && <span className="exam-solution">Lösung: {item.options[item.answer]}</span>}
        </div>
      ) : (
        <div className={`exam-options${item.letters ? " col" : ""}`}>
          {item.options.map((o, i) => (
            <button key={i} className={`exam-opt${state(i)}`} disabled={review} aria-pressed={value === i} onClick={() => onPick(value === i ? undefined : i)}>
              {item.letters && <b>{"abc"[i]}</b>}{o}
            </button>
          ))}
        </div>
      )}
      {review && item.why && <div className="exam-why">{item.why}</div>}
    </div>
  );
}

function AudioClip({ id, audio, allowed, played, playing, onPlay, review }) {
  const left = allowed - (played ?? 0);
  const [open, setOpen] = useState(false);
  if (review) {
    return (
      <div className="exam-audio">
        <button className="exam-btn ghost" onClick={() => setOpen((o) => !o)}>{open ? "Transkript ausblenden" : "Transkript zeigen"}</button>
        <button className="exam-btn ghost" disabled={playing != null} onClick={() => onPlay(id)}>{playing === id ? "läuft…" : "▶ Noch einmal hören"}</button>
        {open && <div className="exam-script">{audio.lines.map((l, i) => <p key={i}><b>{l.speaker}:</b> {l.text}</p>)}</div>}
      </div>
    );
  }
  // During the exam a text can't be started on its own: the Teil's recording plays them in order.
  return (
    <div className="exam-audio">
      <span className={`exam-chip${left <= 0 ? " done" : ""}`}>{audio.label}: {left <= 0 ? "gehört" : played ? `${played}× gehört` : "noch nicht gehört"}</span>
    </div>
  );
}

function ItemsModule({ module, diff, onDone, onQuit }) {
  const d = DIFFICULTIES[diff];
  const specs = TEILE[module.id];
  const key = `exam_mod_${module.id}`;
  const [st, setSt] = useSaved(key, { parts: [], answers: {}, played: {}, deadline: 0, result: null });
  const [error, setError] = useState(null);
  const [teil, setTeil] = useState(0);
  const [playing, setPlaying] = useState(null);
  const [player, setPlayer] = useState(null); // the Teil's recording while it runs: {teil, text}
  const audioRun = useRef(0);
  const loading = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; if (module.id === "hoeren") warmVoice(); return () => { alive.current = false; stopAudio(); }; }, []);

  // The Teile are written one after the other; the clock starts when the first is ready.
  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    setError(null);
    try {
      for (let i = saved.get(key, st).parts.length; i < specs.length; i++) {
        const spec = specs[i];
        const sections = await askBuilt(systemPrompt(diff), spec.prompt(), spec.schema, (r) => { const s = spec.build(r); return validTeil(spec, s) ? s : null; });
        if (!alive.current) return;
        setSt((s) => ({ ...s, parts: [...s.parts, { sections }], deadline: s.deadline || Date.now() + moduleMinutes(module.id, diff) * 60000 }));
        await sleep(50); // let the save land before the next Teil reads it
      }
    } catch (e) {
      if (alive.current) setError((e && e.message) || String(e));
    } finally { loading.current = false; }
  }, []);
  useEffect(() => { if (!st.result) load(); }, []);

  const numberOf = (pi, si, ii) => {
    let n = 1;
    for (let p = 0; p < st.parts.length; p++) for (let s = 0; s < st.parts[p].sections.length; s++) for (let i = 0; i < st.parts[p].sections[s].items.length; i++) {
      if (p === pi && s === si && i === ii) return n;
      n++;
    }
    return n;
  };
  // After the exam: any text can be heard again, at normal speed.
  const play = async (id, lines) => {
    setPlaying(id);
    await playLines(lines, { rate: 1 });
    if (alive.current) setPlaying(null);
  };
  // A Teil's recording, as in the exam room: it is started once and then runs by itself.
  // Before each text there is time to read its tasks (10 s per short text, 60 s for the long
  // ones, less at the harder levels); a text heard twice comes again after a short pause.
  // It can't be paused, rewound or started again; after a reload it goes on with the texts not yet heard.
  const plays = (t) => (specs[t].twice && d.twice ? 2 : 1);
  const heard = (t) => Boolean(st.parts[t]) && st.parts[t].sections.every((s, si) => !s.audio || (st.played[`${t}.${si}`] ?? 0) >= plays(t));
  const runAudio = async (t) => {
    const run = ++audioRun.current;
    const live = () => alive.current && audioRun.current === run;
    const counts = { ...st.played };
    const readTime = Math.round((t === 0 ? 10 : 60) * d.time);
    const sections = st.parts[t].sections;
    for (let si = 0; si < sections.length; si++) {
      const audio = sections[si].audio;
      const id = `${t}.${si}`;
      if (!audio || (counts[id] ?? 0) >= plays(t)) continue;
      if (!counts[id]) {
        for (let left = readTime; left > 0; left--) {
          setPlayer({ teil: t, text: `${audio.label}: Lesen Sie die Aufgaben. Noch ${left} Sekunden.` });
          await sleep(1000);
          if (!live()) return;
        }
      }
      for (let n = counts[id] ?? 0; n < plays(t); n++) {
        setPlayer({ teil: t, text: `♪ ${audio.label}${plays(t) > 1 ? ` · ${n + 1}. Hören` : ""}` });
        const done = await playLines(audio.lines, { rate: d.rate });
        if (!live() || !done) return;
        counts[id] = n + 1;
        setSt((s) => ({ ...s, played: { ...s.played, [id]: n + 1 } }));
        await sleep(n + 1 < plays(t) ? 3000 : 1500);
        if (!live()) return;
      }
    }
    setPlayer(null);
  };
  const submit = () => {
    audioRun.current++;
    stopAudio();
    setPlayer(null);
    setPlaying(null);
    const score = scoreItems(st.parts, st.answers);
    // Teile the AI never delivered count as wrong only if the clock ran out on them.
    const result = { module: module.id, diff, points: score.points, right: score.right, total: score.total, passed: score.points >= d.pass, at: Date.now() };
    setSt((s) => ({ ...s, result }));
    setTeil(0);
    window.scrollTo({ top: 0 });
  };

  const total = specs.reduce((n, s) => n + s.count, 0);
  const answered = Object.values(st.answers).filter((v) => v !== undefined).length;
  const ready = st.parts.length;
  const part = st.parts[teil];
  const spec = specs[teil];
  const review = Boolean(st.result);
  return (
    <div className="exam-module">
      {review
        ? <ResultCard result={st.result} module={module} onNext={() => { saved.set(key, null); onDone(st.result); }} />
        : (
          <ModuleHead module={module} diff={diff} deadline={st.deadline} onTimeUp={submit} onQuit={() => { saved.set(key, null); onQuit(); }}>
            <span className="exam-progress">{answered} / {total}</span>
          </ModuleHead>
        )}
      <div className="exam-tabs" role="tablist">
        {specs.map((s, i) => (
          <button key={i} role="tab" aria-selected={teil === i} className={teil === i ? "on" : ""} onClick={() => setTeil(i)}>
            {s.title}{i >= ready && !error ? " …" : ""}
          </button>
        ))}
      </div>
      {!part ? (
        error ? <Problem error={`${spec.title} konnte nicht geschrieben werden: ${error}`} onRetry={load} />
          : <div className="exam-card exam-wait"><div className="exam-spinner" />Die KI schreibt {spec.title}… Das dauert einige Sekunden. Die Zeit läuft erst, wenn Teil 1 bereit ist.</div>
      ) : (
        <div className="exam-part">
          <div className="exam-instruction">{spec.instruction}{module.id === "hoeren" && !review ? ` Sie hören ${spec.twice && d.twice ? "jeden Text zweimal" : "den Text nur einmal"}.` : ""}</div>
          {module.id === "hoeren" && !review && (
            <div className="exam-card exam-player">
              <button className="exam-btn" disabled={player != null || heard(teil)} onClick={() => runAudio(teil)}>
                {heard(teil) ? "✓ Audio gehört" : player?.teil === teil ? "♪ Audio läuft…" : part.sections.some((s, si) => st.played[`${teil}.${si}`]) ? "▶ Audio fortsetzen" : "▶ Audio starten"}
              </button>
              <span className="exam-audio-note" aria-live="polite">
                {player ? (player.teil === teil ? player.text : `Das Audio von ${specs[player.teil].title} läuft noch.`)
                  : heard(teil) ? "Sie können das Audio nicht noch einmal hören."
                    : "Wie in der Prüfung: Das Audio läuft nach dem Start von selbst (Lesezeit, dann der Text). Sie können es nicht anhalten oder wiederholen."}
              </span>
            </div>
          )}
          {part.sections.map((s, si) => {
            const id = `${teil}.${si}`;
            return (
              <div className="exam-card" key={si}>
                {s.title && <h3 className="exam-text-title">{s.title}</h3>}
                {s.text && <div className="exam-text">{s.text.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}</div>}
                {s.texts && <div className="exam-ads">{s.texts.map((a) => <div className="exam-ad" key={a.label}><span className="exam-num">{a.label}</span><div><b>{a.title}</b><p>{a.text}</p></div></div>)}</div>}
                {s.audio && <AudioClip id={id} audio={s.audio} allowed={spec.twice && d.twice ? 2 : 1} played={st.played[id]} playing={playing} review={review} onPlay={(x) => play(x, s.audio.lines)} />}
                {s.items.map((item, ii) => (
                  <Item key={ii} number={numberOf(teil, si, ii)} item={item} review={review} value={st.answers[`${id}.${ii}`]}
                    onPick={(v) => setSt((x) => ({ ...x, answers: { ...x.answers, [`${id}.${ii}`]: v } }))} />
                ))}
              </div>
            );
          })}
          <div className="exam-foot">
            {teil > 0 && <button className="exam-btn ghost" onClick={() => { setTeil(teil - 1); window.scrollTo({ top: 0 }); }}>← {specs[teil - 1].title}</button>}
            {teil < specs.length - 1 && <button className="exam-btn" onClick={() => { setTeil(teil + 1); window.scrollTo({ top: 0 }); }}>{specs[teil + 1].title} →</button>}
            {!review && teil === specs.length - 1 && (
              <button className="exam-btn" disabled={ready < specs.length && !error} onClick={() => { if (answered >= total || window.confirm(`${total - answered} Aufgaben sind noch offen. Trotzdem abgeben?`)) submit(); }}>Abgeben</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Schreiben ----------
function Marks({ g }) {
  return (
    <div className="exam-marks">
      {Object.entries(g.criteria).map(([c, v]) => (
        <div key={c}><span>{CRITERIA_LABELS[c]}</span><span className="exam-bar"><i style={{ width: `${v * 20}%` }} /></span><b>{v}/5</b></div>
      ))}
    </div>
  );
}
function Feedback({ g }) {
  return (
    <React.Fragment>
      <Marks g={g} />
      {g.comment && <p className="exam-comment">{g.comment}</p>}
      {g.corrections.length > 0 && (
        <ul className="exam-fixes">{g.corrections.map((c, i) => <li key={i}><s>{c.wrong}</s> → <b>{c.right}</b>{c.why && <em> ({c.why})</em>}</li>)}</ul>
      )}
    </React.Fragment>
  );
}

function WritingModule({ module, diff, onDone, onQuit }) {
  const d = DIFFICULTIES[diff];
  const key = "exam_mod_schreiben";
  const [st, setSt] = useSaved(key, { tasks: null, texts: ["", "", ""], deadline: 0, result: null });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [tab, setTab] = useState(0);
  const area = useRef(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = writePrompt(diff);
      const tasks = await askBuilt(systemPrompt(diff), p.text, p.schema, (r) => buildWriting(r, diff));
      if (alive.current) setSt((s) => ({ ...s, tasks, deadline: Date.now() + moduleMinutes("schreiben", diff) * 60000 }));
    } catch (e) { if (alive.current) setError((e && e.message) || String(e)); }
  }, []);
  useEffect(() => { if (!st.tasks) load(); }, []);

  const submit = async () => {
    if (busy) return;
    setError(null);
    try {
      const grades = [];
      for (let i = 0; i < st.tasks.length; i++) {
        setBusy(`Aufgabe ${i + 1} wird bewertet…`);
        const p = gradeWritingPrompt(st.tasks[i], st.texts[i], diff);
        grades.push(st.texts[i].trim()
          ? await askBuilt(p.system, p.text, p.schema, (r) => gradeResult(r, st.tasks[i].max))
          : gradeResult({ comment: "Nothing was written for this task." }, st.tasks[i].max));
      }
      const points = grades.reduce((n, g) => n + g.points, 0);
      const result = { module: "schreiben", diff, points, passed: points >= d.pass, at: Date.now(), grades };
      if (alive.current) { setSt((s) => ({ ...s, result })); window.scrollTo({ top: 0 }); }
    } catch (e) { if (alive.current) setError(`Die Bewertung ist fehlgeschlagen: ${(e && e.message) || e}`); }
    if (alive.current) setBusy("");
  };
  const type = (ch) => {
    const el = area.current;
    if (!el) return;
    const at = el.selectionStart ?? el.value.length;
    const next = el.value.slice(0, at) + ch + el.value.slice(el.selectionEnd ?? at);
    setSt((s) => ({ ...s, texts: s.texts.map((t, i) => (i === tab ? next : t)) }));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + 1, at + 1); });
  };

  if (!st.tasks) {
    return (
      <div className="exam-module">
        <ModuleHead module={module} diff={diff} onQuit={() => { saved.set(key, null); onQuit(); }} />
        {error ? <Problem error={`Die Aufgaben konnten nicht geschrieben werden: ${error}`} onRetry={load} />
          : <div className="exam-card exam-wait"><div className="exam-spinner" />Die KI schreibt die drei Aufgaben…</div>}
      </div>
    );
  }
  const task = st.tasks[tab];
  const words = countWords(st.texts[tab]);
  const g = st.result?.grades[tab];
  return (
    <div className="exam-module">
      {st.result
        ? <ResultCard result={st.result} module={module} onNext={() => { saved.set(key, null); onDone(st.result); }} />
        : (
          <ModuleHead module={module} diff={diff} deadline={st.deadline} onTimeUp={submit} onQuit={() => { saved.set(key, null); onQuit(); }}>
            <span className="exam-progress">{st.texts.filter((t) => t.trim()).length} / 3</span>
          </ModuleHead>
        )}
      <div className="exam-tabs" role="tablist">
        {st.tasks.map((t, i) => <button key={i} role="tab" aria-selected={tab === i} className={tab === i ? "on" : ""} onClick={() => setTab(i)}>{t.title}{st.result ? ` · ${st.result.grades[i].points}/${t.max}` : ""}</button>)}
      </div>
      <div className="exam-card">
        <div className="exam-kind">{task.kind} · {task.max} Punkte · ca. {task.target} Wörter</div>
        <p className="exam-situation">{task.situation}</p>
        {task.points && <ul className="exam-points">{task.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
        {task.quote && <blockquote className="exam-quote"><b>{task.quote.name}</b>{task.quote.text}</blockquote>}
        <p className="exam-closing">{task.closing}</p>
        <textarea ref={area} className="exam-write" rows={10} value={st.texts[tab]} readOnly={Boolean(st.result) || Boolean(busy)} spellCheck={false} autoCorrect="off" autoCapitalize="sentences"
          placeholder="Schreiben Sie hier…" onChange={(e) => { const v = e.target.value; setSt((s) => ({ ...s, texts: s.texts.map((t, i) => (i === tab ? v : t)) })); }} />
        <div className="exam-write-foot">
          {!st.result && <span className="exam-umlauts">{["ä", "ö", "ü", "ß", "Ä", "Ö", "Ü"].map((c) => <button key={c} onClick={() => type(c)} tabIndex={-1}>{c}</button>)}</span>}
          <span className={`exam-words${words >= task.target ? " ok" : ""}`}>{words} / {task.target} Wörter</span>
        </div>
        {g && (
          <div className="exam-feedback">
            <Feedback g={g} />
            {g.better && <details><summary>Musterlösung</summary><div className="exam-text">{g.better.split(/\n+/).map((p, i) => <p key={i}>{p}</p>)}</div></details>}
          </div>
        )}
      </div>
      {error && <Problem error={error} onRetry={submit} />}
      {!st.result && (
        <div className="exam-foot">
          {tab > 0 && <button className="exam-btn ghost" onClick={() => setTab(tab - 1)}>← Aufgabe {tab}</button>}
          {tab < 2 && <button className="exam-btn" onClick={() => setTab(tab + 1)}>Aufgabe {tab + 2} →</button>}
          {tab === 2 && <button className="exam-btn" disabled={Boolean(busy)} onClick={() => { if (st.texts.every((t) => t.trim()) || window.confirm("Nicht alle Aufgaben sind bearbeitet. Trotzdem abgeben?")) submit(); }}>{busy || "Abgeben"}</button>}
        </div>
      )}
    </div>
  );
}

// ---------- Sprechen ----------
// With Gemini as the AI, the examiner and the partner speak with Gemini's natural voices (a
// woman's and a man's), so the oral exam sounds like two people. Its free tier allows only
// a limited number of spoken lines a day: once that is reached, the voice on this device takes over.
const GEMINI_VOICES = { f: "Kore", m: "Charon" };
const geminiVoice = () => (getProvider() === "gemini" && !geminiTtsBlocked() ? (line) => geminiTts(line.text, GEMINI_VOICES[line.gender]) : null);
const ME = "Kandidat/in";
const PART_TITLES = ["Teil 1 · Gemeinsam etwas planen", "Teil 2 · Ein Thema präsentieren", "Teil 3 · Über ein Thema sprechen"];

function SpeakingModule({ module, diff, onDone, onQuit }) {
  const d = DIFFICULTIES[diff];
  const [sheet, setSheet] = useState(null);
  const [error, setError] = useState(null);
  const [stage, setStage] = useState("prep"); // prep → plan → present → questions → partner → feedback → grading → done
  const [topic, setTopic] = useState(0);
  const [log, setLog] = useState([]); // {part, who, text, me}
  const [deadline, setDeadline] = useState(0);
  const [prepEnd, setPrepEnd] = useState(0);
  const [busy, setBusy] = useState(""); // what the examiner side is doing
  const [mic, setMic] = useState(false);
  const [heard, setHeard] = useState("");
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState(null);
  const ref = useRef({ log: [], stage: "prep", planTurns: 0, asked: 0, micOk: canListen });
  const alive = useRef(true);
  const end = useRef(null);
  useEffect(() => { alive.current = true; warmVoice(); return () => { alive.current = false; stopAudio(); stopListening(); }; }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [log, busy, heard]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const p = speakPrompt();
      const s = await askBuilt(systemPrompt(diff), p.text, p.schema, buildSpeaking);
      if (alive.current) { setSheet(s); setPrepEnd(Date.now() + d.prep * 60000); }
    } catch (e) { if (alive.current) setError((e && e.message) || String(e)); }
  }, []);
  useEffect(() => { load(); }, []);

  const go = (s) => { ref.current.stage = s; setStage(s); };
  const add = (part, who, text, me = false) => {
    ref.current.log = [...ref.current.log, { part, who, text, me }];
    setLog(ref.current.log);
  };
  const transcript = (part) => ref.current.log.filter((m) => m.part === part).map((m) => `${m.who}: ${m.text}`).join("\n");
  // One line from the examiner's side: written by the AI (or fixed), shown, then spoken.
  const over = () => !alive.current || ["grading", "done"].includes(ref.current.stage);
  const say = async (part, who, text) => {
    if (over()) return;
    add(part, who.name, text);
    setBusy(`${who.name} spricht…`);
    await playLines([{ text, gender: who.gender }], { rate: d.rate, cloud: geminiVoice() });
  };
  const aiSay = async (part, who, stageName, extra, context) => {
    if (over()) return;
    setBusy(`${who.name} überlegt…`);
    const p = speakTurnPrompt(stageName, sheetRef.current, diff, extra);
    const text = await askBuilt(p.system, context || "(Die Prüfung beginnt.)", p.schema, (r) => (typeof r.reply === "string" && r.reply.trim() ? r.reply.trim() : null), 2);
    await say(part, who, text);
  };
  const sheetRef = useRef(null);
  const listenNow = (silence) => {
    if (!ref.current.micOk || !alive.current) return;
    setMic(true);
    setHeard("");
    listen({
      silence,
      onText: setHeard,
      onEnd: (text, problem) => {
        if (!alive.current) return;
        setMic(false);
        setHeard("");
        if (problem) { ref.current.micOk = false; setNote(problem); }
        if (text) learnerSaid(text);
      },
    });
  };
  // Runs the examiner's side after each thing the candidate says.
  const run = async (step) => {
    try {
      await step();
    } catch (e) {
      console.warn("Exam examiner turn failed:", e);
      if (alive.current) setNote(`Die KI hat nicht geantwortet (${(e && e.message) || e}). Sagen Sie es noch einmal oder tippen Sie.`);
    }
    if (over()) return;
    setBusy("");
    if (["plan", "peer", "questions", "feedback"].includes(ref.current.stage)) listenNow(3500);
  };
  const finish = async () => {
    stopAudio(); stopListening();
    go("grading");
    setBusy("");
    try {
      const full = { ...sheetRef.current };
      const p = gradeSpeakingPrompt(full, ref.current.log.map((m) => ({ ...m, who: m.me ? ME : m.who })), diff);
      const grades = await askBuilt(p.system, p.text, p.schema, (r) => (r.teil1 && r.teil2 && r.teil3 ? [r.teil1, r.teil2, r.teil3].map((t, i) => gradeResult(t, SPEAK_POINTS[i])) : null));
      const sum = grades.reduce((n, g) => n + g.points, 0);
      const points = Math.round((sum / SPEAK_POINTS.reduce((a, b) => a + b, 0)) * 100);
      if (alive.current) { setResult({ module: "sprechen", diff, points, passed: points >= d.pass, at: Date.now(), grades }); go("done"); window.scrollTo({ top: 0 }); }
    } catch (e) { if (alive.current) { setError(`Die Bewertung ist fehlgeschlagen: ${(e && e.message) || e}`); } }
  };
  const start = () => {
    const chosen = sheet.topics[topic];
    sheetRef.current = { ...sheet, topic: chosen, other: sheet.topics[1 - topic] };
    setDeadline(Date.now() + moduleMinutes("sprechen", diff) * 60000);
    go("plan");
    run(async () => {
      await say(0, EXAMINER, `Guten Tag. Mein Name ist ${EXAMINER.name}, das ist ${PARTNER.name}. Wir beginnen mit Teil 1: Planen Sie bitte gemeinsam.`);
      await aiSay(0, PARTNER, "plan", { opening: true });
    });
  };
  const learnerSaid = (text) => {
    const r = ref.current;
    setNote("");
    if (r.stage === "plan") {
      add(0, ME, text, true);
      r.planTurns++;
      const closing = r.planTurns >= d.planTurns;
      run(async () => {
        await aiSay(0, PARTNER, "plan", { closing }, transcript(0));
        if (closing && !over()) {
          go("present");
          await say(1, EXAMINER, `Vielen Dank. Wir kommen zu Teil 2. Bitte präsentieren Sie jetzt Ihr Thema: ${sheetRef.current.topic.title}`);
        }
      });
    } else if (r.stage === "present") {
      add(1, ME, text, true);
    } else if (r.stage === "peer") {
      add(2, ME, text, true);
      go("questions");
      run(nextQuestion);
    } else if (r.stage === "questions") {
      add(2, ME, text, true);
      run(r.asked < d.questions ? nextQuestion : partnerTalk);
    } else if (r.stage === "feedback") {
      add(2, ME, text, true);
      go("closing");
      run(async () => {
        await aiSay(2, PARTNER, "answer", { topic: sheetRef.current.other.title }, transcript(2));
        await say(2, EXAMINER, "Vielen Dank. Die Prüfung ist damit beendet. Auf Wiedersehen.");
        if (!over()) finish();
      });
    }
  };
  const nextQuestion = async () => {
    const r = ref.current;
    r.asked++;
    await aiSay(2, EXAMINER, "questions", { topic: sheetRef.current.topic.title, n: r.asked, of: d.questions },
      `PRESENTATION:\n${transcript(1) || "(the candidate said nothing)"}\n\nQUESTIONS SO FAR:\n${transcript(2) || "(none)"}`);
  };
  const partnerTalk = async () => {
    go("partner");
    await say(2, EXAMINER, `Danke. Jetzt präsentiert ${PARTNER.name} sein Thema. Geben Sie ihm danach eine Rückmeldung und stellen Sie ihm eine Frage.`);
    const other = sheetRef.current.other;
    await aiSay(2, PARTNER, "presentation", { topic: other.title, slides: other.slides });
    if (!over()) go("feedback");
  };
  // Teil 3 in the exam's order: the other candidate reacts to the presentation and asks a
  // question, then the examiner asks; after that the roles swap.
  const endPresentation = () => {
    stopListening();
    setMic(false);
    go("peer");
    run(async () => {
      await say(2, EXAMINER, `Vielen Dank. ${PARTNER.name}, bitte geben Sie eine Rückmeldung und stellen Sie eine Frage.`);
      await aiSay(2, PARTNER, "peer", { topic: sheetRef.current.topic.title }, `PRESENTATION:\n${transcript(1) || "(the candidate said nothing)"}`);
    });
  };
  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    learnerSaid(text);
  };
  const quit = () => { stopAudio(); stopListening(); onQuit(); };

  if (!sheet) {
    return (
      <div className="exam-module">
        <ModuleHead module={module} diff={diff} onQuit={quit} />
        {error ? <Problem error={`Die Aufgaben konnten nicht geschrieben werden: ${error}`} onRetry={load} />
          : <div className="exam-card exam-wait"><div className="exam-spinner" />Die KI schreibt die Aufgabenblätter…</div>}
      </div>
    );
  }
  const part = stage === "plan" ? 0 : stage === "present" ? 1 : 2;
  const sheetCard = (
    <div className="exam-card exam-sheet">
      {(stage === "prep" || stage === "plan") && (
        <React.Fragment>
          <div className="exam-kind">{PART_TITLES[0]}</div>
          <p className="exam-situation">{sheet.plan.situation}</p>
          <ul className="exam-points">{sheet.plan.points.map((p, i) => <li key={i}>{p}</li>)}</ul>
        </React.Fragment>
      )}
      {stage === "prep" && (
        <React.Fragment>
          <div className="exam-kind">{PART_TITLES[1]} · wählen Sie ein Thema</div>
          <div className="exam-topics">
            {sheet.topics.map((t, i) => (
              <button key={i} className={`exam-topic${topic === i ? " on" : ""}`} aria-pressed={topic === i} onClick={() => setTopic(i)}>
                <b>Thema {i + 1}: {t.title}</b>
                <ol>{t.slides.map((s, k) => <li key={k}>{s}</li>)}</ol>
              </button>
            ))}
          </div>
          <div className="exam-kind">{PART_TITLES[2]}</div>
          <p className="exam-situation">Nach Ihrer Präsentation gibt {PARTNER.name} eine Rückmeldung und stellt eine Frage, dann fragt die Prüferin. Danach hören Sie die Präsentation von {PARTNER.name}: Geben Sie eine Rückmeldung und stellen Sie eine Frage.</p>
        </React.Fragment>
      )}
      {["present", "peer", "questions"].includes(stage) && (
        <React.Fragment>
          <div className="exam-kind">{stage === "present" ? PART_TITLES[1] : PART_TITLES[2]}</div>
          <p className="exam-situation"><b>{sheetRef.current.topic.title}</b></p>
          {stage === "present" && <ol className="exam-points">{sheetRef.current.topic.slides.map((s, k) => <li key={k}>{s}</li>)}</ol>}
        </React.Fragment>
      )}
      {["partner", "feedback", "closing"].includes(stage) && (
        <React.Fragment>
          <div className="exam-kind">{PART_TITLES[2]}</div>
          <p className="exam-situation">{PARTNER.name} präsentiert: <b>{sheetRef.current.other.title}</b>. Geben Sie eine Rückmeldung (Was hat Ihnen gefallen? Was war neu?) und stellen Sie eine Frage.</p>
        </React.Fragment>
      )}
    </div>
  );
  if (stage === "prep") {
    return (
      <div className="exam-module">
        <ModuleHead key="prep" module={module} diff={diff} deadline={prepEnd} onTimeUp={start} onQuit={quit}><span className="exam-progress">Vorbereitung</span></ModuleHead>
        <div className="exam-instruction">Vorbereitungszeit: {d.prep} Minuten. Sie dürfen sich Notizen auf Papier machen, aber nicht ablesen. Danach sprechen Sie mit der Prüferin {EXAMINER.name} und dem zweiten Kandidaten {PARTNER.name} (beide KI).
          {canListen ? " Erlauben Sie das Mikrofon, wenn der Browser fragt." : " Dieser Browser hat keine Spracheingabe: Sie können Ihre Antworten tippen."}</div>
        {sheetCard}
        <div className="exam-foot"><button className="exam-btn" onClick={start}>Ich bin bereit: Prüfung beginnen</button></div>
      </div>
    );
  }
  if (stage === "done" && result) {
    return (
      <div className="exam-module">
        <ResultCard result={result} module={module} onNext={() => onDone(result)} note="Die Aussprache (16 Punkte in der echten Prüfung) kann aus dem Transkript nicht bewertet werden; die übrigen 84 Punkte sind auf 100 hochgerechnet." />
        {result.grades.map((g, i) => (
          <div className="exam-card" key={i}><div className="exam-kind">{PART_TITLES[i]} · {g.points}/{g.max}</div><Feedback g={g} /></div>
        ))}
        <div className="exam-card"><div className="exam-kind">Transkript</div>
          <div className="exam-chat static">{log.map((m, i) => <div key={i} className={`exam-msg${m.me ? " me" : ""}`}><small>{m.who}</small>{m.text}</div>)}</div>
        </div>
      </div>
    );
  }
  const myTurn = !busy && ["plan", "present", "peer", "questions", "feedback"].includes(stage);
  return (
    <div className="exam-module">
      <ModuleHead key="exam" module={module} diff={diff} deadline={deadline} onTimeUp={() => { if (!["grading", "done"].includes(ref.current.stage)) finish(); }} onQuit={quit}>
        <span className="exam-progress">Teil {part + 1} / 3</span>
      </ModuleHead>
      {stage === "grading"
        ? (error ? <Problem error={error} onRetry={() => { setError(null); finish(); }} /> : <div className="exam-card exam-wait"><div className="exam-spinner" />Die Prüfer beraten sich und bewerten Ihre Leistung…</div>)
        : (
          <React.Fragment>
            {sheetCard}
            <div className="exam-card">
              <div className="exam-chat">
                {log.map((m, i) => <div key={i} className={`exam-msg${m.me ? " me" : ""}`}><small>{m.who}</small>{m.text}</div>)}
                {heard && <div className="exam-msg me interim"><small>{ME}</small>{heard}</div>}
                {busy && <div className="exam-status">{busy}</div>}
                <div ref={end} />
              </div>
              {note && <div className="exam-note">{note}</div>}
              <div className="exam-speak">
                {canListen && (
                  <button className={`exam-mic${mic ? " on" : ""}`} disabled={!myTurn && !mic} aria-pressed={mic}
                    onClick={() => (mic ? stopListening() : (ref.current.micOk = true, listenNow(stage === "present" ? 0 : 3500)))}>
                    {mic ? "■ Fertig gesprochen" : "🎤 Sprechen"}
                  </button>
                )}
                <textarea rows={2} value={draft} disabled={!myTurn} placeholder={myTurn ? "…oder hier tippen" : ""} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button className="exam-btn" disabled={!myTurn || !draft.trim()} onClick={send}>Senden</button>
              </div>
              {stage === "present" && (
                <div className="exam-foot">
                  <span className="exam-audio-note">Sprechen Sie etwa drei Minuten zu allen fünf Punkten. Sie können mehrmals ansetzen.</span>
                  <button className="exam-btn" disabled={Boolean(busy) || !log.some((m) => m.part === 1 && m.me)} onClick={endPresentation}>Präsentation beenden</button>
                </div>
              )}
            </div>
          </React.Fragment>
        )}
    </div>
  );
}

// ---------- results ----------
function ResultCard({ result, module, onNext, note }) {
  const d = DIFFICULTIES[result.diff];
  return (
    <div className={`exam-result glass ${result.passed ? "pass" : "fail"}`}>
      <div className="exam-result-score">{result.points}<small>/100</small></div>
      <div className="exam-result-body">
        <div className="exam-result-title">{module.label}: {result.passed ? "bestanden" : "nicht bestanden"}</div>
        <div className="exam-result-sub">
          {result.total ? `${result.right} von ${result.total} richtig · ` : ""}{d.label} {d.factor}, bestanden ab {d.pass} %
          {result.passed ? ` · In der echten Prüfung: ${grade(result.points)}` : result.points >= 60 ? " · Für die echte Prüfung (60 %) hätte es gereicht." : ""}
        </div>
        {note && <div className="exam-result-note">{note}</div>}
      </div>
      <button className="exam-btn" onClick={onNext}>Weiter</button>
    </div>
  );
}

function Certificate({ run, onClose }) {
  const d = DIFFICULTIES[run.diff];
  const rows = run.queue.map((id) => ({ module: MODULES.find((m) => m.id === id), r: run.results[id] }));
  const done = rows.filter((x) => x.r);
  const passed = done.length === rows.length && done.every((x) => x.r.passed);
  const avg = done.length ? Math.round(done.reduce((n, x) => n + x.r.points, 0) / done.length) : 0;
  return (
    <div className="exam-module">
      <div className={`exam-cert glass ${passed ? "pass" : "fail"}`}>
        <div className="page-eyebrow">Prüfungsergebnis · {d.label} {d.factor}</div>
        <h2>{passed ? "Bestanden" : "Nicht bestanden"}</h2>
        <p>{passed ? `Jedes Modul über ${d.pass} %. Die echte Prüfung verlangt 60 %: Sie sind vorbereitet.` : `Zum Bestehen braucht hier jedes Modul ${d.pass} % (in der echten Prüfung 60 %).`}</p>
        <table>
          <tbody>
            {rows.map(({ module, r }) => (
              <tr key={module.id}><td>{module.label}</td><td>{r ? `${r.points} / 100` : "–"}</td><td className={r?.passed ? "ok" : "no"}>{r ? (r.passed ? "bestanden" : "nicht bestanden") : "abgebrochen"}</td></tr>
            ))}
            {rows.length > 1 && <tr className="sum"><td>Gesamt</td><td>{avg} / 100</td><td>{grade(avg)}</td></tr>}
          </tbody>
        </table>
        <button className="exam-btn" onClick={onClose}>Zur Übersicht</button>
      </div>
    </div>
  );
}

// ---------- the tab ----------
const RUNNERS = { lesen: ItemsModule, hoeren: ItemsModule, schreiben: WritingModule, sprechen: SpeakingModule };

export function ExamPage({ onTalkloop }) {
  const [run, setRun] = useSaved("exam_run", null); // {diff, queue, index, results}
  const [diff, setDiff] = useSaved("exam_difficulty", "hard");
  const [history, setHistory] = useState([]);
  const [problem, setProblem] = useState("");
  useEffect(() => { api.get("/api/exam/results", { quiet: true }).then((r) => setHistory(r.results ?? [])).catch(() => {}); }, []);

  const begin = (queue) => {
    if (!providerReady()) { setProblem("The exam is written and marked by your own AI. Save an AI key in the Talkloop tab first (Groq's is free), then come back."); return; }
    setProblem("");
    for (const m of MODULES) saved.set(`exam_mod_${m.id}`, null);
    setRun({ diff, queue, index: 0, results: {} });
    window.scrollTo({ top: 0 });
  };
  const record = (result) => {
    const { module, diff: level, points, passed, at } = result;
    api.post("/api/exam/results", { result: { module, diff: level, points, passed, at } }, undefined, { quiet: true })
      .then((r) => setHistory(r.results ?? [])).catch(api.report);
    setRun((r) => ({ ...r, results: { ...r.results, [module]: { points, passed, diff: level } }, index: r.index + 1 }));
    window.scrollTo({ top: 0 });
  };
  const skip = () => {
    if (!window.confirm("Dieses Modul ohne Ergebnis abbrechen?")) return;
    setRun((r) => (r.queue.length === 1 ? null : { ...r, index: r.index + 1 }));
  };

  if (run && run.index < run.queue.length) {
    const module = MODULES.find((m) => m.id === run.queue[run.index]);
    const Runner = RUNNERS[module.id];
    return (
      <div className="exam">
        {run.queue.length > 1 && <div className="exam-steps">{run.queue.map((id, i) => <span key={id} className={i === run.index ? "on" : i < run.index ? "done" : ""}>{MODULES.find((m) => m.id === id).label}</span>)}</div>}
        <Runner key={module.id} module={module} diff={run.diff} onDone={record} onQuit={skip} />
      </div>
    );
  }
  if (run) return <div className="exam"><Certificate run={run} onClose={() => setRun(null)} /></div>;

  const d = DIFFICULTIES[diff];
  const total = MODULES.reduce((n, m) => n + moduleMinutes(m.id, diff), 0);
  return (
    <div className="exam">
      <div>
        <div className="page-eyebrow">Goethe-Zertifikat B1 · Simulation</div>
        <h1 className="page-title">Prüfung</h1>
        <div className="page-sub">Alle vier Module mit allen Teilen, im Format der echten Prüfung, aber schwerer. Jede Prüfung schreibt Ihre KI neu; sie bewertet Ihre Texte und prüft Sie mündlich.</div>
      </div>
      <div className="exam-card">
        <div className="exam-kind">Schwierigkeit</div>
        <div className="exam-levels" role="radiogroup" aria-label="Schwierigkeit">
          {Object.entries(DIFFICULTIES).map(([id, x]) => (
            <button key={id} role="radio" aria-checked={diff === id} className={diff === id ? "on" : ""} onClick={() => setDiff(id)}>
              <b>{x.label}</b><span>{x.factor}</span>
            </button>
          ))}
        </div>
        <p className="exam-blurb">{d.blurb}</p>
      </div>
      {problem && (
        <div className="exam-card exam-problem" role="alert"><div>{problem}</div>{onTalkloop && <button className="exam-btn" onClick={onTalkloop}>Open Talkloop</button>}</div>
      )}
      <button className="exam-start" onClick={() => begin(MODULES.map((m) => m.id))}>
        <b>Ganze Prüfung starten</b>
        <span>Lesen → Hören → Schreiben → Sprechen · ca. {total} Minuten</span>
      </button>
      <div className="exam-modules">
        {MODULES.map((m) => {
          const last = history.find((h) => h.module === m.id);
          return (
            <button key={m.id} className="exam-modcard glass" onClick={() => begin([m.id])}>
              <b>{m.label}</b>
              <span>{m.about}</span>
              <span>{moduleMinutes(m.id, diff)} Minuten</span>
              {last && <em className={last.passed ? "ok" : "no"}>zuletzt {last.points} % ({DIFFICULTIES[last.diff]?.label ?? last.diff})</em>}
            </button>
          );
        })}
      </div>
      {history.length > 0 && (
        <div className="exam-card">
          <div className="exam-kind">Bisherige Ergebnisse</div>
          <table className="exam-history">
            <tbody>
              {history.slice(0, 12).map((h, i) => (
                <tr key={i}>
                  <td>{new Date(h.at).toLocaleDateString()}</td><td>{MODULES.find((m) => m.id === h.module)?.label ?? h.module}</td>
                  <td>{DIFFICULTIES[h.diff]?.label ?? h.diff}</td><td>{h.points} %</td><td className={h.passed ? "ok" : "no"}>{h.passed ? "bestanden" : "nicht bestanden"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
