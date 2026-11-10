import React, { useEffect, useRef } from "react";
import { useUi } from "../ui.js";
import { setForm, startConversation, changeKey, chooseAi, openChat, deleteChat, topicChats, MODES } from "../engine.js";
import { LANGUAGES, NATIVE_LANGUAGES, LEVELS, MODE_OPTIONS, OFFICE_GAPS, TENSE_OPTIONS, SCENE_OPTIONS } from "../options.js";

// After a call: what was said, tried and not reached.
function Recap({ recap }) {
  if (!recap) return null;
  const line = (label, list, sep = ", ") => list.length ? <p><strong>{label}: </strong>{list.join(sep)}</p> : null;
  return (
    <div id="recap" className="recap">
      <h3>Last call</h3>
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
          {recap.topic && line(`Topic words used ${recap.topic.used.length}/${recap.topic.total} ✓`, recap.topic.used.length ? recap.topic.used : ["none yet"])}
          {recap.topic && line("Topic words for next time", recap.topic.unused)}
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
      <h2>Start a conversation</h2>
      <div className="grid">
        <label>Practise
          {select("language", LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>))}
        </label>
        <label>I speak
          {select("native", NATIVE_LANGUAGES.map((n) => <option key={n}>{n}</option>))}
        </label>
        <label>Level
          {select("level", LEVELS.map((l) => <option key={l} value={l}>{l}</option>))}
        </label>
        <label>Mode
          {select("mode", MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
        </label>
        <label style={dim(Boolean(m.office))}>Büro: how often someone drops by
          <select id="office-gap" value={form.officeGap} disabled={!m.office} onChange={(e) => setForm({ officeGap: e.target.value })}>
            {OFFICE_GAPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>Tense to practise
          {select("tense", TENSE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>))}
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
      </div>
      {voiceStatus && <p className="muted voice-status" aria-live="polite">{voiceStatus}</p>}

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
        <input type="checkbox" checked={form.liveVoice} onChange={(e) => setForm({ liveVoice: e.target.checked })} />
        Live voice call <span className="muted">(Gemini 3.8 Live: replies in about a second and you can interrupt)</span>
      </label>

      <button id="start" type="button" className="primary" onClick={startConversation}>Start conversation</button>
      <Chats />
    </section>
  );
}
