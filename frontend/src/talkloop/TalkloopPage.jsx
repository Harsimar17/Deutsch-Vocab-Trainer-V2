import React, { useEffect } from "react";
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
          <span className="eyebrow">Talkloop</span>
          <h1>Speaking practice</h1>
        </div>
        <div className="stats">
          <span id="streak" title="Days in a row you practised">🔥 {stats.streak}</span>
        </div>
      </header>
      {view.keygate && <KeyGate />}
      {view.setup && <Setup />}
      <CallScreen />
      <Explorer />
      {view.chatgpt && <ChatGptCard />}
      <Mistakes />
      <Bookmarks />
    </div>
  );
}
