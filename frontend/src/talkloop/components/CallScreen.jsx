import React, { useEffect, useRef } from "react";
import { useUi, ui, wordTokens, setRef } from "../ui.js";
import { TapButton, useTap } from "../tap.jsx";
import {
  openExplorer, replayMessage, translateMessage, peekWord, useSuggestion, submitComposer, sendTap, textFocus, textBlur,
  insertUmlaut, toggleUmlautShift, onTextInput, onTextBeforeInput, onTextKeyDown, setAutoSend, micClick, togglePause,
  toggleCoach, drillSay, drillHear, skipDrill, heardEdit, heardDelete, openLookup, endCall,
} from "../engine.js";

// A word of a reply: tap it to look it up (text stays selectable with the mouse).
function Word({ text, sentence, speaking }) {
  const tap = useTap(() => openExplorer(text, sentence), { selectable: true });
  return <span className={speaking ? "word speaking" : "word"} {...tap}>{text}</span>;
}

function CharacterMessage({ m }) {
  let wordIndex = -1;
  return (
    <li className="msg character">
      <span className="who">{m.who}</span>
      <div>
        {m.plain ? m.text : wordTokens(m.text).map((t, i) => {
          if (!t.word) return <React.Fragment key={i}>{t.text}</React.Fragment>;
          wordIndex++;
          return <Word key={i} text={t.text} sentence={m.text} speaking={wordIndex === m.speaking} />;
        })}
      </div>
      {!m.plain && (
        <>
          {m.showTranslation && m.translation && <div className="translation">{m.translation}</div>}
          <div className="tools">
            <TapButton onTap={() => replayMessage(m.id)}>▶ Replay</TapButton>
            <TapButton onTap={() => translateMessage(m.id)} disabled={m.translating}>{m.translating ? "Translating…" : "Translate"}</TapButton>
          </div>
          {m.voiceNote && <div className="voice-note">{m.voiceNote}</div>}
        </>
      )}
    </li>
  );
}

function Transcript() {
  const transcript = useUi((s) => s.transcript);
  return (
    <ol id="transcript" aria-live="polite">
      {transcript.map((m) =>
        m.kind === "character" ? <CharacterMessage key={m.id} m={m} />
          : m.kind === "divider" ? <li key={m.id} className="msg divider muted">{m.text}</li>
            : <li key={m.id} className="msg learner"><span className="who">{m.who}</span>{m.text}</li>)}
    </ol>
  );
}

function Coach() {
  const coach = useUi((s) => s.coach);
  const ref = useRef(null);
  const tap = useTap(() => {
    toggleCoach();
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, { selectable: true });
  if (!coach) return null;
  const cls = "card coach" + (coach.correction ? " has-correction" : "") + (coach.expanded ? " expanded" : "");
  return (
    <div id="coach" className={cls} ref={ref} {...tap}>
      {!coach.understood && <p>That didn't quite land. Try one of the suggestions below.</p>}
      {coach.correction && <p><strong>More natural:</strong> {coach.correction}</p>}
      {coach.tip && <p>{coach.tip}</p>}
    </div>
  );
}

function Focus() {
  const focus = useUi((s) => s.focus);
  if (!focus) return null;
  return (
    <div id="focus" className="focus" aria-label="Vocabulary being practised">
      <span className="focus-label">{focus.label}</span>
      {focus.words.map((w) => focus.today
        ? <TapButton key={w.key} className={"focus-word today" + w.cls} title={w.title} onTap={() => peekWord(w.key)}>{w.text}</TapButton>
        : <span key={w.key} className="focus-word" title={w.title}>{w.text}</span>)}
    </div>
  );
}

function Drill() {
  const drill = useUi((s) => s.drill);
  if (!drill) return null;
  return (
    <div id="drill" className="drill" aria-live="polite">
      <p className="drill-label">Say the corrected sentence</p>
      <p className="drill-target" lang={drill.lang}>{drill.target}</p>
      {drill.feedback && <p className={drill.ok ? "drill-feedback ok" : "drill-feedback"}>{drill.feedback}</p>}
      <div className="drill-actions">
        <TapButton className="primary" onTap={drillSay}>🎤 Say it</TapButton>
        <TapButton onTap={drillHear}>▶ Hear it</TapButton>
        <TapButton onTap={skipDrill}>Skip</TapButton>
      </div>
    </div>
  );
}

const UMLAUTS = ["ä", "ö", "ü", "ß"];

function Composer() {
  const composer = useUi((s) => s.composer);
  const shift = useUi((s) => s.umlautShift);
  const send = useTap(sendTap, { click: false });
  // The umlaut conversions need the browser's own input events (React's onBeforeInput has no
  // inputType), so they are listened to on the element itself.
  const input = useRef(null);
  useEffect(() => {
    const el = input.current;
    el.addEventListener("input", onTextInput);
    el.addEventListener("beforeinput", onTextBeforeInput);
    el.addEventListener("keydown", onTextKeyDown);
    return () => {
      el.removeEventListener("input", onTextInput);
      el.removeEventListener("beforeinput", onTextBeforeInput);
      el.removeEventListener("keydown", onTextKeyDown);
    };
  }, []);
  const textRef = (el) => { input.current = el; setRef("text")(el); };
  return (
    <>
      <div id="umlauts" className="umlauts" role="group" aria-label="Umlaut keys">
        {UMLAUTS.map((ch) => (
          <TapButton key={ch} title={`${ch}: tap, or type "${ch === "ß" ? "s" : ch === "ä" ? "a" : ch === "ö" ? "o" : "u"}, or Alt+${ch === "ß" ? "S" : ch === "ä" ? "A" : ch === "ö" ? "O" : "U"}`}
            onTap={() => insertUmlaut(ch)}>{shift && ch !== "ß" ? ch.toUpperCase() : ch}</TapButton>
        ))}
        <TapButton aria-pressed={shift} title="Capital letter for the next one (a sentence start is capital anyway)" onTap={toggleUmlautShift}>⇧</TapButton>
      </div>
      <form id="composer" className="composer" onSubmit={(e) => { e.preventDefault(); submitComposer(); }}>
        <input id="text" ref={textRef} autoComplete="off" placeholder="Type your reply…" disabled={composer.textDisabled}
          onFocus={textFocus} onBlur={textBlur} />
        <TapButton title="Look up a word" aria-label="Look up a word" disabled={composer.buttonsDisabled} onTap={openLookup}>🔍</TapButton>
        <button className="primary" type="submit" disabled={composer.buttonsDisabled} {...send}>Send</button>
      </form>
    </>
  );
}

const MIC = "M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z";
const END = "M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85a.98.98 0 0 1-1.38-.01L.29 13.08a1 1 0 0 1 0-1.41C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67a1 1 0 0 1 0 1.41l-2.51 2.48a.98.98 0 0 1-1.38.01 11.3 11.3 0 0 0-2.66-1.85 1 1 0 0 1-.56-.9v-3.1A15 15 0 0 0 12 9Z";

function Controls() {
  const mic = useUi((s) => s.mic);
  const pause = useUi((s) => s.pause);
  return (
    <div className="call-controls">
      <button type="button" id="mic" className="round mic" aria-pressed={mic.on} disabled={mic.disabled} title="Talk hands-free" onClick={micClick}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={MIC} /></svg>
        <span className="round-label">{mic.label}</span>
      </button>
      <button type="button" id="pause" className="round pause" aria-pressed={pause.on} title={pause.on ? "Resume the call" : "Pause the call"} onClick={togglePause}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path className="icon-pause" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /><path className="icon-play" d="M8 5.5v13l10.5-6.5z" /></svg>
        <span className="round-label">{pause.on ? "Resume" : "Pause"}</span>
      </button>
      <button type="button" id="end" className="round end" title="End the conversation" onClick={endCall}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={END} /></svg>
        <span className="round-label">End</span>
      </button>
    </div>
  );
}

// The conversation as a phone call: caller on top, the transcript in the middle, the controls
// pinned to the bottom. Always mounted (the 3D office and the scroll box are reached by ref),
// shown while a call runs.
export function CallScreen() {
  const show = useUi((s) => s.view.call);
  const call = useUi((s) => s.call);
  const office = useUi((s) => s.office);
  const sayThis = useUi((s) => s.sayThis);
  const suggestions = useUi((s) => s.suggestions);
  const heard = useUi((s) => s.heard);
  const status = useUi((s) => s.status);
  const autoSend = useUi((s) => s.autoSend);
  const paused = useUi((s) => s.pause.on);
  const callState = paused ? "paused" : call.state;
  return (
    <main id="conversation" className="call" hidden={!show} data-state={callState}>
      <header className="call-head">
        <div className="avatar" aria-hidden="true">{call.avatar}</div>
        <div className="caller">
          <div className="caller-name">{call.name}</div>
          <div className="caller-sub"><span>{call.mode}</span> · <span id="call-timer">{call.timer}</span></div>
          {call.topic && (
            <div className={call.topicOpen ? "caller-topic expanded" : "caller-topic"} onClick={() => ui.merge("call", { topicOpen: !call.topicOpen })}>{call.topic}</div>
          )}
        </div>
        <div className="call-state">{call.stateText}</div>
      </header>

      <div className={office.talking ? "office-scene you-talking" : "office-scene"} hidden={!office.show} aria-hidden="true">
        <div className="os-3d" ref={setRef("os3d")}>
          <div className="os-photo-waves">🎙️ I hear you</div>
        </div>
      </div>

      <div className="call-scroll" ref={setRef("callScroll")}>
        <Transcript />
        <Coach />
      </div>

      <footer className="call-dock">
        <Focus />
        <Drill />
        {sayThis && <p className="say-this"><span className="muted">{sayThis.label}</span><strong>{sayThis.text}</strong></p>}
        {suggestions.length > 0 && (
          <div className="chips" aria-label="Things you could say">
            {suggestions.map((text, i) => <TapButton key={i} onTap={() => useSuggestion(text)}>{text}</TapButton>)}
          </div>
        )}
        {heard && (
          <div className="heard">
            <div className="live" aria-live="polite">{heard}</div>
            <div className="heard-actions">
              <TapButton onTap={heardEdit}>✎ Edit</TapButton>
              <TapButton onTap={heardDelete}>✕ Delete</TapButton>
            </div>
          </div>
        )}
        {status && <p className="status">{status}</p>}
        <label className="check auto-send">
          <input type="checkbox" checked={autoSend} onChange={(e) => setAutoSend(e.target.checked)} />
          Auto-send when I pause <span className="muted">(off: tap Send when done)</span>
        </label>
        <Composer />
        <Controls />
      </footer>
    </main>
  );
}
