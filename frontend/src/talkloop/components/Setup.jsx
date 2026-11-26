import React, { useEffect, useRef } from "react";
import { StarButton, Pull, Blur } from "../../bits/fx.jsx";
import { useUi } from "../ui.js";
import { setForm, startConversation, changeKey, chooseAi, openChat, deleteChat, topicChats, MODES, markLevelTest, levelTests, grammarPreview, grammarFits, cancelStoryTalk } from "../engine.js";
import { LANGUAGES, NATIVE_LANGUAGES, LEVELS, MODE_OPTIONS, OFFICE_GAPS, TENSE_OPTIONS, SCENE_OPTIONS, GEMINI_VOICE_OPTIONS } from "../options.js";

const day = (at) => new Date(at).toLocaleDateString([], { day: "numeric", month: "short" });

// Earlier level tests, newest first.
function LevelHistory({ tests }) {
  if (!tests?.length) return null;
  return (
    <p className="muted level-history"><strong>Your tests: </strong>
      {tests.slice(0, 8).map((t) => `${t.level} (${day(t.at)})`).join(" · ")}
    </p>
  );
}

// After a Sprechstand test: the level, each criterion with the learner's own sentence, what's next.
function LevelResult({ recap }) {
  if (recap.loading) return <p aria-live="polite">Marking your answers… this takes a few seconds.</p>;
  if (recap.error) {
    return (
      <>
        <p aria-live="polite">{recap.error}</p>
        {recap.retry && <button type="button" onClick={markLevelTest}>Mark again</button>}
        <LevelHistory tests={recap.history} />
      </>
    );
  }
  const r = recap.result;
  const earlier = recap.history?.[1];
  return (
    <div className="level-result">
      <p className="level-badge"><span className="level-big">{r.level}</span>
        <span className="muted"> your speaking level (scale A1– to B1+){earlier ? ` · last time ${earlier.level}` : ""}</span>
      </p>
      {r.summary && <p>{r.summary}</p>}
      <ul className="level-criteria">
        {r.criteria.map((c) => (
          <li key={c.key}>
            <strong>{c.name} · {c.level}</strong> <span className="muted">({c.about})</span><br />
            {c.note}
            {c.quote && <><br /><em className="muted">„{c.quote}“</em></>}
          </li>
        ))}
      </ul>
      {r.strengths.length > 0 && <><p><strong>What you do well</strong></p><ul>{r.strengths.map((s) => <li key={s}>{s}</li>)}</ul></>}
      {r.nextSteps.length > 0 && <><p><strong>For the next level</strong></p><ul>{r.nextSteps.map((s) => <li key={s}>{s}</li>)}</ul></>}
      {r.corrections.length > 0 && (
        <>
          <p><strong>Mistakes worth fixing</strong></p>
          <ul>{r.corrections.map((c) => <li key={c.said}><s>{c.said}</s> → {c.better}</li>)}</ul>
        </>
      )}
      <p className="muted">
        {r.by === "examiner"
          ? "Judged by Frau Weber from your voice during the call, not from the written transcript. "
          : "Marked from the written transcript of the call, so a word the speech recognition missed can count against you. "}
        {r.stats.answers} answers, about {r.stats.avgWords} words each. Pronunciation isn't judged; take it as an estimate.
      </p>
      <LevelHistory tests={recap.history} />
    </div>
  );
}

// Today's grammar after a call: how often each structure came out, right and wrong.
function GrammarRecap({ grammar }) {
  return (
    <div className="grammar-recap">
      <p><strong>Today's grammar</strong></p>
      <ul>
        {grammar.items.map((g) => (
          <li key={g.key}>
            {g.name}:{" "}
            {g.correct + g.wrong === 0
              ? <span className="muted">not used yet, so it comes back next call</span>
              : <>{g.correct} ✓{g.wrong > 0 && <> · {g.wrong} to fix</>}</>}
          </li>
        ))}
      </ul>
      <p className="muted">{grammar.automatic} structure{grammar.automatic === 1 ? "" : "s"} automatic so far. One used well comes back after 1, 3, 7 and 21 days; one avoided or used wrongly comes back next call.</p>
    </div>
  );
}

// After a call: what was said, tried and not reached.
function Recap({ recap }) {
  if (!recap) return null;
  if (recap.kind === "level") {
    return (
      <div id="recap" className="recap">
        <h3><Blur text="Sprechstand" /></h3>
        <LevelResult recap={recap} />
      </div>
    );
  }
  const line = (label, list, sep = ", ") => list.length ? <p><strong>{label}: </strong>{list.join(sep)}</p> : null;
  return (
    <div id="recap" className="recap">
      <h3><Blur text="Last call" /></h3>
      {recap.kind === "sentences" ? (
        <>
          {recap.right.length > 0 && <p><strong>Said ✓ ({recap.right.length}): </strong>{recap.right.join(" · ")}</p>}
          {recap.again.length > 0 && <p><strong>Practise again ({recap.again.length}): </strong>{recap.again.join(" · ")}</p>}
          <p className="muted">{recap.learnt} sentence{recap.learnt === 1 ? "" : "s"} learnt so far. Sentences come back after 1, 3, 7 and 21 days; the ones to practise come back tomorrow.</p>
        </>
      ) : (
        <>
          {line("Said ✓", recap.said)}
          {line("Practise again", recap.tried)}
          {line("Not reached", recap.missed)}
          {recap.topic && line(`${recap.topic.story ? "Story" : "Topic"} words used ${recap.topic.used.length}/${recap.topic.total} ✓`, recap.topic.used.length ? recap.topic.used : ["none yet"])}
          {recap.topic && line(recap.topic.story ? "Story words still to say" : "Topic words for next time", recap.topic.unused)}
          {recap.fixes?.length > 0 && (
            <div className="call-fixes">
              <p><strong>Grammar to fix ({recap.fixes.length})</strong></p>
              <ul>
                {recap.fixes.map((f) => (
                  <li key={f.said}>
                    <s className="muted">{f.said}</s> → <strong>{f.better}</strong>
                    {f.tip && <span className="muted"> · {f.tip}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {recap.grammar && <GrammarRecap grammar={recap.grammar} />}
          <p className="muted">{recap.automatic} word{recap.automatic === 1 ? "" : "s"} automatic so far. Words come back after 1, 3, 7 and 21 days.</p>
        </>
      )}
    </div>
  );
}

// Saved chats, newest first.
function Chats() {
  useUi((s) => s.chatsVersion);
  const chats = topicChats();
  if (!chats.length) return null;
  return (
    <details id="chats" className="chats">
      <summary>Chat history ({chats.length})</summary>
      <p className="muted">Every “Discuss a topic” chat is saved here. Open one to read it or carry on; a new chat always picks a topic you haven't had yet.</p>
      <ul className="chat-list">
        {chats.map((chat) => {
          const said = chat.log.filter((e) => "you" in e).length;
          const when = new Date(chat.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          return (
            <li key={chat.id} className="chat-item">
              <button type="button" className="chat-open" onClick={() => openChat(chat.id)}>
                <strong>{chat.topic}</strong><br />
                <span className="muted">{said} message{said === 1 ? "" : "s"} from you · {when}</span>
              </button>
              <button type="button" className="chat-del" aria-label="Delete this chat"
                onClick={() => { if (confirm("Delete this chat?")) deleteChat(chat.id); }}>×</button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// "Start a conversation": the choices, the learner's vocabulary and Start.
export function Setup() {
  const form = useUi((s) => s.form);
  const keySaved = useUi((s) => s.view.keySaved);
  const keySummary = useUi((s) => s.keySummary);
  const aiChoices = useUi((s) => s.aiChoices);
  const aiChoice = useUi((s) => s.aiChoice);
  const recap = useUi((s) => s.recap);
  const voiceStatus = useUi((s) => s.voiceStatus);
  const trainerStatus = useUi((s) => s.trainerStatus);
  const vocabStatus = useUi((s) => s.vocabStatus);
  const vocabStatusAt = useUi((s) => s.vocabStatusAt);
  const useVocab = useUi((s) => s.useVocab);
  const connectors = useUi((s) => s.connectors);
  const storyTalk = useUi((s) => s.storyTalk);
  const statusRef = useRef(null);
  useEffect(() => {
    if (vocabStatusAt) statusRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [vocabStatusAt]);

  // The scene only matters in scene role-play, the connector in the connector drill, the pace
  // in the Büro; they are greyed out otherwise.
  const m = MODES[form.mode] ?? MODES.scene;
  const dim = (on) => ({ opacity: on ? 1 : 0.5 });
  const select = (key, options) => (
    <select id={key === "officeGap" ? "office-gap" : key} value={form[key]} onChange={(e) => setForm({ [key]: e.target.value })}>{options}</select>
  );

  return (
    <section id="setup" className="card">
      {keySaved && (
        <div className="keyline">
          <label className="ai-choice">Talk with
            <select value={aiChoice} onChange={(e) => chooseAi(e.target.value)}>
              {aiChoices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <span className="muted" id="key-summary">{keySummary}</span>
          <button type="button" onClick={changeKey}>Add or change keys</button>
        </div>
      )}
      <Recap recap={recap} />
      <h2><Blur text="Start a conversation" /></h2>
      <div className="grid">
        <label>Practise
          {select("language", LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>))}
        </label>
        <label>I speak
          {select("native", NATIVE_LANGUAGES.map((n) => <option key={n}>{n}</option>))}
        </label>
        <label style={dim(!m.assess)}>Level
          <select id="level" value={form.level} disabled={Boolean(m.assess)} onChange={(e) => setForm({ level: e.target.value })}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label>Mode
          {select("mode", MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
        </label>
        <label style={dim(Boolean(m.office))}>Büro: how often someone drops by
          <select id="office-gap" value={form.officeGap} disabled={!m.office} onChange={(e) => setForm({ officeGap: e.target.value })}>
            {OFFICE_GAPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={dim(!m.assess)}>Tense to practise
          <select id="tense" value={form.tense} disabled={Boolean(m.assess)} onChange={(e) => setForm({ tense: e.target.value })}>
            {TENSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label style={dim(m.usesScene)}>Scene
          <select id="scenario" value={form.scenario} disabled={!m.usesScene} onChange={(e) => setForm({ scenario: e.target.value })}>
            {SCENE_OPTIONS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label style={dim(Boolean(m.joiner))}>Connector
          <select id="connector" value={form.connector} disabled={!m.joiner} onChange={(e) => setForm({ connector: e.target.value })}>
            <option value="mix">Mix — all up to my level</option>
            {connectors.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label>Gemini voice
          <select id="gemini-voice" value={form.geminiVoice} onChange={(e) => setForm({ geminiVoice: e.target.value })}>
            <option value="">Standard — Kore (Puck in the live call)</option>
            {GEMINI_VOICE_OPTIONS.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {voiceStatus && <p className="muted voice-status" aria-live="polite">{voiceStatus}</p>}
      {m.assess && (
        <div className="level-intro">
          <p>A short interview with an examiner. The questions start easy (A1) and get harder up to B1; when you struggle, they get easier again. There are no corrections, hints or suggestions during the test. Answer in full sentences and say as much as you can. With the live voice call ticked, Frau Weber judges your level from your voice as you talk and ends the test herself once she's sure (after 8 to 15 answers); tap End to see her verdict for five skills. Without it, the test has 12 answers and is marked from the written transcript when you tap End.</p>
          <LevelHistory tests={levelTests()} />
        </div>
      )}

      <div className="vocab">
        <div className="vocab-head"><strong>My vocabulary</strong></div>
        <div className="trainer-link"><p className="muted" aria-live="polite">{trainerStatus}</p></div>
        <p className="muted" ref={statusRef}>{vocabStatus}</p>
        <label className="check">
          <input type="checkbox" checked={form.useVocab} disabled={useVocab.disabled} onChange={(e) => setForm({ useVocab: e.target.checked })} />
          Weave my vocab into the conversation (words up to your level)
        </label>
      </div>

      <label className="check say-again">
        <input type="checkbox" checked={form.sayAgain} onChange={(e) => setForm({ sayAgain: e.target.checked })} />
        Repeat each corrected sentence before moving on
      </label>
      <label className="check say-again">
        <input type="checkbox" checked={form.tutor} onChange={(e) => setForm({ tutor: e.target.checked })} />
        Tutor: correct my grammar out loud <span className="muted">(live voice: the partner says “Kleine Korrektur: …” and why, instead of only using the right form)</span>
      </label>
      <label className="check say-again" style={dim(grammarFits(form.mode, form.language))}>
        <input type="checkbox" checked={form.grammarFocus} disabled={!grammarFits(form.mode, form.language)} onChange={(e) => setForm({ grammarFocus: e.target.checked })} />
        Today's grammar: work grammar into the talk without telling me{" "}
        <span className="muted">
          {grammarFits(form.mode, form.language)
            ? `(next: ${grammarPreview(form.level).join(" · ")}; the partner asks questions that need them, the recap shows how you did)`
            : "(German conversations only, not the test or drills)"}
        </span>
      </label>
      <label className="check say-again">
        <input type="checkbox" checked={form.liveVoice} onChange={(e) => setForm({ liveVoice: e.target.checked })} />
        Live voice call <span className="muted">(Gemini 3.8 Live: replies in about a second and you can interrupt)</span>
      </label>

      {storyTalk && (
        <p className="muted" role="status">
          📖 Next call practises the story „{storyTalk.title}“: a topic that needs its {storyTalk.count} words, ticked as you say them.{" "}
          <button type="button" onClick={cancelStoryTalk}>Not now</button>
        </p>
      )}
      <Pull><StarButton id="start" type="button" className="primary" onClick={startConversation}>{storyTalk ? "Start story practice" : "Start conversation"}</StarButton></Pull>
      <Chats />
    </section>
  );
}
