import React, { useState } from "react";
import { useUi } from "../ui.js";
import { TapButton } from "../tap.jsx";
import { resetMistakes, closeExplorer, submitLookup, listenWord, saveExplorerWord } from "../engine.js";

// The word explorer: a word tapped in a reply, or the 🔍 look-up of any word.
export function Explorer() {
  const e = useUi((s) => s.explorer);
  const [query, setQuery] = useState("");
  if (!e) return null;
  return (
    <aside id="explorer" className="card explorer">
      <TapButton className="close" aria-label="Close" onTap={closeExplorer}>×</TapButton>
      <div>
        {e.lookup && (
          <form className="lookup" onSubmit={(ev) => { ev.preventDefault(); submitLookup(query); }}>
            <input autoFocus autoComplete="off" enterKeyHint="search" placeholder={e.placeholder} value={query} onChange={(ev) => setQuery(ev.target.value)} />
            <button type="submit" className="primary">Look up</button>
          </form>
        )}
        {e.status === "loading" && <>Looking up “{e.word}”…</>}
        {e.status === "error" && e.error}
        {e.status === "done" && e.info && (
          <>
            <h2>{e.info.word} — {e.info.translation}</h2>
            <p>{e.info.part_of_speech} · say it: {e.info.pronunciation}</p>
            <p>{e.info.example} ({e.info.example_translation})</p>
            <div className="tools">
              <TapButton onTap={() => listenWord(e.info.word)}>▶ Listen</TapButton>
              <TapButton disabled={e.saved} onTap={saveExplorerWord}>{e.saved ? "Saved" : "★ Save word"}</TapButton>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

const clip = (t) => (t.length > 90 ? `${t.slice(0, 87)}…` : t);

// Recurring mistakes, by kind, for the language picked on the setup screen.
export function Mistakes() {
  const m = useUi((s) => s.mistakes);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Recurring mistakes</h2>
        {m.items.length > 0 && <button type="button" onClick={resetMistakes}>Reset</button>}
      </div>
      <ul className="bookmarks">
        {!m.items.length && (
          <li className="muted">Corrections are sorted here by kind of mistake. The ones you make again and again get practised on purpose in your {m.language} conversations.</li>
        )}
        {m.items.map((t) => (
          <li key={t.type}>
            {t.name} — {t.count}×{t.practised && <> <span className="mistake-focus">being practised</span></>}
            <div className="muted mistake-example">“{clip(t.said)}” → “{clip(t.fix)}”</div>
          </li>
        ))}
      </ul>
      <p className="muted mistakes-sync">
        {m.synced ? "Kept in your Vocab Trainer too, so it follows you to your other devices." : "Kept on this device until Talkloop is linked to your Vocab Trainer."}
      </p>
    </section>
  );
}

export function Bookmarks() {
  const bookmarks = useUi((s) => s.bookmarks);
  return (
    <section className="card">
      <h2>Saved words</h2>
      <ul className="bookmarks">
        {!bookmarks.length && <li className="muted">Tap any word the character says to look it up and save it.</li>}
        {bookmarks.map((b, i) => <li key={i}>{b.word} — {b.translation} <span className="muted">({b.language})</span></li>)}
      </ul>
    </section>
  );
}

// ChatGPT as the partner, on the learner's own ChatGPT plan (the trainer's /mcp/{link}).
export function ChatGptCard() {
  const url = useUi((s) => s.chatgptUrl);
  const [copied, setCopied] = useState(false);
  const copy = async (ev) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      ev.currentTarget.previousSibling?.select?.(); // clipboard blocked: selected, to copy by hand
    }
  };
  return (
    <section id="chatgpt" className="card chatgpt">
      <details className="chats">
        <summary>Use Talkloop in ChatGPT</summary>
        <p className="muted">ChatGPT can be your partner instead, with no API key: Talkloop's screen opens inside ChatGPT, with your words to say today, corrections and the microphone, and your mistakes and words are saved here.</p>
        <ol className="muted">
          <li>In ChatGPT on a computer: Settings → <strong>Plugins</strong> (or Apps) → <strong>Add</strong> → <strong>Add custom MCP server</strong>. If you don't see Add, turn on <strong>Developer mode</strong> under Advanced settings first.</li>
          <li>Name it Talkloop, paste the address below, Authentication <strong>None</strong>, and save.</li>
          <li>In a new chat, turn Talkloop on and write e.g. <em>Talkloop: interview me, A2</em> or <em>Talkloop: Konnektoren mit weil, A2</em>. Tap 🎙️ on the Talkloop screen and speak.</li>
        </ol>
        <div className="vocab-url-row">
          <input type="text" readOnly value={url} />
          <button type="button" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
        </div>
        <p className="muted">This address works like your login for Talkloop for 180 days: don't share it.</p>
      </details>
    </section>
  );
}
