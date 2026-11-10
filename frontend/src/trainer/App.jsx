import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { api, session } from "./lib/api.js";
import { loadContent } from "./lib/content.js";
import { Loading, Switch, applyCategoryPalette, counterStyle, navBtnStyle } from "./ui/common.jsx";
import { ArticleQuiz, ClozeQuiz, Flashcards, MistakesReview, Quiz, SeparableVerbs, StudyMode, WriteMode } from "./practice/drills.jsx";
import { PatternStudy } from "./practice/patterns.jsx";
import { ConnectorPractice } from "./practice/connectors.jsx";
import { STORY_PROGRESS, StoriesPage } from "./stories/stories.jsx";
import { AddWord, SettingsPanel } from "./settings.jsx";
import { TabBar, UserMenu } from "./frame.jsx";
import { FormulasPage } from "./grammar.jsx";
import { TalkloopPage } from "../talkloop/TalkloopPage.jsx";

export const ICON_PATHS = {
  practice: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM9 7h7M9 11h5",
  stories: "M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2V4Zm20 0h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7V4Z",
  rules: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  talk: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5Z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
};
export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export function TopBar({ storyMode, onStoryMode, formulas, onFormulas, talk, onTalk, theme, onTheme, user, onLogout }) {
  const dark = theme === "dark";
  const page = talk ? "talk" : formulas ? "rules" : storyMode ? "stories" : "practice";
  const go = (p) => {
    if (p === "talk") { onTalk(true); return; }
    onTalk(false);
    onFormulas(p === "rules");
    if (p !== "rules" && storyMode !== (p === "stories")) onStoryMode(p === "stories");
  };
  const items = [["practice", "Practice"], ["stories", "Stories"], ["rules", "Grammar"], ["talk", "Talkloop"]];
  const navButtons = items.map(([id, label]) => (
    <button key={id} onClick={() => go(id)} aria-current={page === id ? "page" : undefined}><Icon name={id} /><span>{label}</span></button>
  ));
  return (
    <React.Fragment>
      <header className="app-header">
        <div className="app-header-inner">
          <div className="brand"><span className="brand-mark">W</span><span>Wortschatz</span><span className="brand-sub">German trainer</span></div>
          <nav className="topnav" aria-label="Sections">{navButtons}</nav>
          <div className="header-actions">
            <button className="icon-btn" onClick={() => onTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
              <Icon name={dark ? "sun" : "moon"} />
            </button>
            {user && <UserMenu user={user} onLogout={onLogout} />}
          </div>
        </div>
      </header>
      <nav className="bottomnav" aria-label="Sections">{navButtons}</nav>
    </React.Fragment>
  );
}

export function StreakHeader({ header, showCounts }) {
  const extra = showCounts ? (header.focus === "all" ? "All words" : header.focus === "trouble" ? "Trouble words" : header.due + " due · " + header.new + " new") : null;
  return (
    <div className="glass" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "16px 18px", borderRadius: "18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", flexWrap: "wrap", fontSize: "13px", color: "var(--ink-soft)" }}>
        <span><strong style={{ color: "var(--ink)", fontWeight: 600 }}>{header.reviewed} / {header.goal}</strong> reviewed today</span>
        <span style={{ display: "flex", gap: "14px", fontVariantNumeric: "tabular-nums" }}>
          {extra && <span>{extra}</span>}
          <span>{header.streak > 0 ? header.streak + "-day streak" : "No streak yet"}</span>
        </span>
      </div>
      <div style={{ height: "6px", background: "var(--tint)", borderRadius: "999px", overflow: "hidden" }}>
        <div style={{ width: header.pct + "%", height: "100%", background: "var(--btn-grad)", borderRadius: "999px", boxShadow: "0 0 14px var(--accent)", transition: "width .5s cubic-bezier(.2,.8,.2,1)" }} />
      </div>
    </div>
  );
}


export const SYSTEM_THEME = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
export function LoginScreen({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState({ busy: false, error: null });
  const submit = (e) => {
    e.preventDefault();
    if (state.busy) return;
    setState({ busy: true, error: null });
    session.login(email.trim(), password)
      // Sent here by Talkloop (/#talkloop): go back to it once logged in.
      // Sent here by Talkloop (/#talkloop): its tab opens once logged in.
      .then((user) => { const toTalk = location.hash === "#talkloop"; if (toTalk) history.replaceState(null, "", "/"); onLoggedIn(user, toTalk); })
      .catch((err) => setState({ busy: false, error: err.message }));
  };
  const field = { fontFamily: "var(--font-serif)", fontSize: "16px", padding: "12px 14px", borderRadius: "10px", border: "1px solid var(--line)", background: "var(--paper-raised)", color: "var(--ink)", width: "100%", boxSizing: "border-box" };
  return (
    <form onSubmit={submit} style={{ width: "min(380px, 100%)", display: "flex", flexDirection: "column", gap: "12px", padding: "32px 28px", borderRadius: "16px", border: "1px solid var(--line)", background: "var(--paper-raised)", boxShadow: "var(--shadow-card)", boxSizing: "border-box" }}>
      <div className="brand-mark" style={{ width: "44px", height: "44px", borderRadius: "12px", fontSize: "21px", margin: "0 auto 4px" }}>W</div>
      <div style={{ textAlign: "center", fontSize: "22px", fontWeight: 700, letterSpacing: "-.02em", color: "var(--ink)" }}>Sign in to Wortschatz</div>
      <div style={{ textAlign: "center", fontSize: "14px", color: "var(--ink-soft)", marginTop: "-4px", marginBottom: "10px" }}>Your German vocabulary, grammar and speaking practice.</div>
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" autoComplete="username" required style={field} />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required style={field} />
      <button type="submit" disabled={state.busy} style={{ ...navBtnStyle, opacity: state.busy ? 0.6 : 1 }}>{state.busy ? "Signing in…" : "Sign in"}</button>
      {state.error && <div role="alert" style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--bad)", textAlign: "center" }}>{state.error}</div>}
    </form>
  );
}

// settings changes after which practice rounds start over with the new choices
export const ROUND_SETTINGS = ["toggleLevel", "toggleCat", "toggleDirection", "toggleNoRepeat", "setFocus"];
// Where the learner is in the app: kept in the page only, never sent to the backend.
// Every visit starts on Practice.
export const NAV_START = { storyMode: false, storyOpen: null, storyTest: null };
export const NAV_SETTINGS = {
  setStoryMode: (v) => ({ storyMode: !!v }),
  openStory: (v) => ({ storyOpen: v == null ? null : String(v), storyTest: null }),
  openPhaseTest: (v) => ({ storyTest: v == null ? null : String(v) }),
};

export function App() {
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "login" | { error }
  const [user, setUser] = useState(session.user());
  const [attempt, setAttempt] = useState(0);
  const [summary, setSummary] = useState(null);
  const [nav, setNav] = useState(NAV_START); // where the learner is — page only
  const visited = useRef({}); // pages opened since login (kept mounted)
  const [saveError, setSaveError] = useState(null);
  const [mode, setMode] = useState("study");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formulas, setFormulas] = useState(false); // the Formulas page is open
  // the Talkloop tab is open; /#talkloop (old Talkloop links) opens on it
  const [talk, setTalk] = useState(() => {
    if (location.hash !== "#talkloop" || !session.user()) return false; // not logged in: the login screen keeps the hash
    history.replaceState(null, "", "/");
    return true;
  });
  const [version, setVersion] = useState(0); // bump → practice rounds restart
  // memory only, for this visit — never saved
  const [geminiKey, setGeminiKey] = useState("");
  const [ghToken, setGhToken] = useState("");

  useEffect(() => {
    api.setErrorHandler((msg) => setSaveError(msg));
    api.setLoggedOutHandler(() => setUser(null));
  }, []);
  // Logging out starts the page afresh, so nothing of this learner (Talkloop's AI keys, its call)
  // stays in memory for the next one. Talkloop logs out the same way when its link has ended,
  // and comes back to its tab after the next login.
  const logout = useCallback(() => { session.logout(); location.replace("/"); }, []);
  const talkLoggedOut = useCallback(() => { session.logout(); location.replace("/#talkloop"); }, []);

  const refreshSummary = useCallback(() => {
    return api.get("/api/summary?ai=" + (geminiKey ? "true" : "false"), { quiet: true }).then(setSummary).catch(api.report);
  }, [geminiKey]);
  // After an answer: the response carries the header numbers it changed ({summary: {header, mistakeCount}}).
  const applyChange = useCallback((r) => {
    if (r && r.summary) setSummary((s) => (s ? Object.assign({}, s, r.summary) : s));
    else refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    if (!user) {
      // someone else may log in next: drop everything of the last user
      STORY_PROGRESS.value = null; STORY_PROGRESS.stale = true; setNav(NAV_START); visited.current = {};
      setSummary(null); setSaveError(null); setGeminiKey(""); setGhToken(""); setMode("study"); setSettingsOpen(false); setFormulas(false); setTalk(false);
      setStatus("login");
      return;
    }
    api.get("/api/summary?ai=false")
      .then((s) => { if (!cancelled) { setSummary(s); setStatus("ready"); } })
      .catch((e) => { if (!cancelled) setStatus(e && e.status === 401 ? "login" : { error: (e && e.message) || String(e) }); });
    return () => { cancelled = true; };
  }, [attempt, user]);
  useEffect(() => { if (status === "ready") refreshSummary(); }, [geminiKey]);

  const onSettings = useCallback((action, value) => {
    // Moving around (Practice/Stories, a story, a phase test) stays in the page — no call.
    const nav = NAV_SETTINGS[action];
    if (nav) {
      setNav((n) => Object.assign({}, n, nav(value)));
      return Promise.resolve();
    }
    return api.post("/api/settings/" + action + "?ai=" + (geminiKey ? "true" : "false"), { value })
      .then((next) => { // the whole new summary — no second call
        setSummary(next);
        if (ROUND_SETTINGS.includes(action)) setVersion((v) => v + 1);
      })
      .catch(api.report);
  }, [geminiKey]);

  const theme = summary && summary.settings.theme ? summary.settings.theme : SYSTEM_THEME;
  applyCategoryPalette(theme);
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#05060D" : "#F3F4FA");
  }, [theme]);

  const shellStyle = { minHeight: "100%", padding: "36px 20px 48px", fontFamily: "var(--font-serif)", display: "flex", alignItems: "center", justifyContent: "center" };
  if (status && status.error) {
    return (
      <div style={shellStyle}>
        <div style={{ maxWidth: "440px", textAlign: "center", display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ fontSize: "22px", color: "var(--ink)" }}>Can’t reach the server</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--bad)" }}>{status.error}</div>
          <button onClick={() => setAttempt((n) => n + 1)} style={navBtnStyle}>Try again</button>
        </div>
      </div>
    );
  }
  if (status === "login") {
    return <div style={shellStyle}><LoginScreen onLoggedIn={(u, toTalk) => { setUser(u); if (toTalk) setTalk(true); }} /></div>;
  }
  if (status === "loading" || !summary) {
    return <div style={shellStyle}><div style={{ ...counterStyle, fontSize: "13px" }}>Loading…</div></div>;
  }

  const s = Object.assign({}, summary.settings, nav);
  const notice = saveError ? (
    <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", padding: "8px 12px", borderRadius: "10px", border: "1px solid var(--bad)", fontFamily: "var(--font-mono)", fontSize: "10px", letterSpacing: "0.04em", color: "var(--bad)" }}>
      <span>⚠ {saveError}</span>
      <button onClick={() => setSaveError(null)} aria-label="dismiss" style={{ background: "transparent", border: "none", color: "var(--bad)", cursor: "pointer", fontSize: "14px" }}>×</button>
    </div>
  ) : null;
  const topBar = (
    <TopBar storyMode={s.storyMode} onStoryMode={(v) => onSettings("setStoryMode", v)} formulas={formulas} onFormulas={setFormulas} talk={talk} onTalk={setTalk}
      theme={theme} onTheme={(t) => onSettings("setTheme", t)} user={user} onLogout={logout} />
  );

  // Practice, Stories and Rules stay mounted once opened and are only hidden,
  // so switching between them starts nothing again on the backend.
  const page = talk ? "talk" : formulas ? "rules" : s.storyMode ? "stories" : "practice";
  if (!visited.current[page]) visited.current[page] = true;
  const show = (p) => ({ display: page === p ? "block" : "none" });
  const drillProps = { version, onChange: applyChange, geminiKey, settings: s };
  return (
    <div style={{ minHeight: "100%", fontFamily: "var(--font-serif)" }}>
      {topBar}
      <main className="app-main">
      <div style={{ maxWidth: page === "talk" ? "760px" : page === "rules" ? "760px" : page === "stories" ? "680px" : "600px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "22px" }}>
        {notice}
        {/* Started in the background right after login, so it is ready when its tab is opened. */}
        <div style={show("talk")}>
          <TalkloopPage onLoggedOut={talkLoggedOut} />
        </div>
        {visited.current.rules && <div style={show("rules")}><div style={{ animation: "cardIn .35s ease both" }}><FormulasPage /></div></div>}
        {visited.current.stories && (
          <div style={show("stories")}>
            <div style={{ animation: "cardIn .35s ease both" }}>
              <StoriesPage settings={s} onSettings={onSettings} onChange={applyChange} />
            </div>
          </div>
        )}
        <div style={{ display: page === "practice" ? "flex" : "none", flexDirection: "column", gap: "18px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <div>
              <div className="page-eyebrow">{summary.levelTitle}</div>
              <h1 className="page-title">Practice</h1>
              <div className="page-sub">{summary.cardCount} cards · nouns, verbs, separable verbs, adjectives, connectors and phrases</div>
            </div>
            <button className="settings-toggle" onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen}>
              <Icon name="sliders" /><span>{summary.settingsLabel}</span>
            </button>
          </div>
          {settingsOpen && <SettingsPanel summary={summary} onSettings={onSettings} geminiKey={geminiKey} setGeminiKey={setGeminiKey} ghToken={ghToken} setGhToken={setGhToken} />}
          <StreakHeader header={summary.header} showCounts={mode === "study" || mode === "write"} />
          <TabBar mode={mode} setMode={setMode} mistakeCount={summary.mistakeCount} />
          <div style={{ marginTop: "6px", animation: "cardIn .35s ease both" }} key={mode}>
            {mode === "study" && <StudyMode {...drillProps} />}
            {mode === "write" && <WriteMode {...drillProps} />}
            {mode === "build" && <PatternStudy onChange={applyChange} />}
            {mode === "connectors" && <ConnectorPractice />}
            {mode === "flash" && <Flashcards {...drillProps} />}
            {mode === "quiz" && <Quiz {...drillProps} />}
            {mode === "articles" && <ArticleQuiz {...drillProps} />}
            {mode === "sep" && <SeparableVerbs {...drillProps} />}
            {mode === "cloze" && <ClozeQuiz {...drillProps} />}
            {mode === "mistakes" && <MistakesReview {...drillProps} />}
            {mode === "add" && <AddWord summary={summary} ghToken={ghToken} onToken={setGhToken} onAdded={() => { loadContent(true).finally(() => setVersion((v) => v + 1)); refreshSummary(); }} />}
          </div>
        </div>
      </div>
      </main>
    </div>
  );
}
