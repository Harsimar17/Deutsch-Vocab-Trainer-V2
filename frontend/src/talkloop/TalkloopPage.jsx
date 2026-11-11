import React, { useEffect } from "react";
import { PageTitle, Eyebrow, Digits, Reveal, Typed } from "../bits/fx.jsx";
import "../styles/talkloop.css";
import { useUi } from "./ui.js";
import { initTalkloop, setLoggedOutHandler } from "./engine.js";
import { KeyGate } from "./components/KeyGate.jsx";
import { Setup } from "./components/Setup.jsx";
import { CallScreen } from "./components/CallScreen.jsx";
import { Explorer, Mistakes, Bookmarks, ChatGptCard } from "./components/Panels.jsx";

// Talkloop, the speaking practice, as a page of the app. It starts once, right after login
// (mounted in the background so it is ready when its tab opens), and keeps running while the
// other pages are shown, so a call isn't cut off by a look at the vocabulary.
export function TalkloopPage({ onLoggedOut }) {
  useEffect(() => {
    setLoggedOutHandler(onLoggedOut);
    initTalkloop();
  }, []);
  const view = useUi((s) => s.view);
  const stats = useUi((s) => s.stats);
  return (
    <div className="talkloop">
      <header className="topbar">
        <div>
          <Eyebrow text="Talkloop" className="eyebrow" />
          <PageTitle text="Speaking practice" tag="h1" className="" />
          <Typed className="talk-sub" loop text={["Real conversations with an AI partner, in German.", "Say it, get corrected, say it again.", "Your learnt words come up naturally."]} />
        </div>
        <div className="stats">
          <span id="streak" title="Days in a row you practised">🔥 <Digits value={stats.streak} /></span>
        </div>
      </header>
      {view.keygate && <Reveal><KeyGate /></Reveal>}
      {view.setup && <Reveal><Setup /></Reveal>}
      <CallScreen />
      <Explorer />
      {view.chatgpt && <Reveal><ChatGptCard /></Reveal>}
      <Reveal><Mistakes /></Reveal>
      <Reveal><Bookmarks /></Reveal>
    </div>
  );
}
