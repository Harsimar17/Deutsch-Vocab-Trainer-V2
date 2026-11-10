import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { api } from "./lib/api.js";
import { isNoun } from "./lib/content.js";
import { CATEGORY_META, ghostBtn, miniBtn, monoLabel, navBtnStyle, srsCol } from "./ui/common.jsx";

// ---------- SETTINGS CONTROLS (show the saved settings; every change is a backend action) ----------

export function LevelToggle({ levels, selected, onToggle }) {
  return (
    <div style={{ display: "flex", justifyContent: "center", gap: "2px", padding: "3px", background: "var(--tint)", borderRadius: "11px", alignSelf: "center", margin: "0 auto" }}>
      {levels.map((lv) => {
        const on = selected.includes(lv);
        return (
          <button key={lv} onClick={() => onToggle(lv)} style={{
            fontFamily: "var(--font-serif)", fontSize: "13px", fontWeight: 600, padding: "7px 18px",
            border: "none", borderRadius: "8px", background: on ? "var(--btn-grad)" : "transparent", color: on ? "#FFFFFF" : "var(--ink-soft)",
            boxShadow: on ? "var(--shadow-soft)" : "none", cursor: "pointer",
          }}>{lv}</button>
        );
      })}
    </div>
  );
}

export function FilterBar({ cats, active, onToggle }) {
  return (
    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
      {cats.map((c) => {
        const meta = CATEGORY_META[c];
        const on = active.includes(c);
        return (
          <button key={c} onClick={() => onToggle(c)} style={{
            fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", padding: "7px 14px", borderRadius: "999px",
            border: `1px solid ${on ? meta.color : meta.color + "66"}`, background: on ? meta.color : meta.color + "0d", color: on ? "#FCF8EE" : meta.color,
            cursor: "pointer", boxShadow: on ? `0 6px 14px -6px ${meta.color}99` : "none",
          }}>{meta.label}</button>
        );
      })}
    </div>
  );
}

export function PillButton({ on, onClick, children, onColor = "var(--good)" }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: "var(--font-mono)", fontSize: "11px", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", padding: "8px 16px", borderRadius: "999px",
      border: `1px solid ${on ? onColor : "var(--ink-faint)"}`, background: on ? onColor : "transparent", color: on ? "#F6F1E5" : "var(--ink-soft)", cursor: "pointer",
    }}>{children}</button>
  );
}

export function GeminiKeyField({ value, onChange, label = "✨ Gemini API key", placeholder = "paste Google AI Studio key (AIza…)",
  help = "Kept in memory for this visit only — never saved. Sent with a request only when a new example sentence has to be generated (each sentence is saved after the first time)." }) {
  const [draft, setDraft] = useState(value || "");
  const [show, setShow] = useState(false);
  useEffect(() => { setDraft(value || ""); }, [value]);
  const dirty = draft.trim() !== (value || "");
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "7px" }}>
      <div style={{ ...monoLabel, color: value ? "var(--good)" : "var(--ink-soft)" }}>{label} · {value ? "set" : "off"}</div>
      <div style={{ display: "flex", gap: "6px", width: "min(430px, 92vw)" }}>
        <input type={show ? "text" : "password"} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} spellCheck={false} autoComplete="off"
          style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: "12px", padding: "8px 10px", borderRadius: "8px", border: "1px solid var(--line)", background: "var(--paper-raised)", color: "var(--ink)" }} />
        <button onClick={() => setShow((s) => !s)} style={miniBtn}>{show ? "hide" : "show"}</button>
        <button onClick={() => onChange(draft.trim())} disabled={!dirty} style={{ ...miniBtn, opacity: dirty ? 1 : 0.4, cursor: dirty ? "pointer" : "default" }}>save</button>
        {value && <button onClick={() => { onChange(""); setDraft(""); }} style={{ ...miniBtn, color: "var(--bad)", borderColor: "var(--bad)" }}>clear</button>}
      </div>
      <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--ink-faint)", maxWidth: "min(430px, 92vw)", textAlign: "center", lineHeight: 1.6 }}>{help}</div>
    </div>
  );
}

export function SettingsPanel({ summary, onSettings, geminiKey, setGeminiKey, ghToken, setGhToken }) {
  const s = summary.settings;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
      <LevelToggle levels={summary.levels} selected={s.levels} onToggle={(lv) => onSettings("toggleLevel", lv)} />
      <FilterBar cats={summary.cats} active={s.cats} onToggle={(c) => onSettings("toggleCat", c)} />
      <div style={{ display: "flex", justifyContent: "center", gap: "10px", flexWrap: "wrap" }}>
        <button onClick={() => onSettings("toggleDirection")} style={{ ...ghostBtn, fontSize: "11px", padding: "8px 16px", borderRadius: "999px", border: "1px solid var(--ink)" }}>
          {s.direction === "de-en" ? "German → English" : "English → German"}   ⇄
        </button>
        <PillButton on={s.noRepeat} onClick={() => onSettings("toggleNoRepeat")}>{s.noRepeat ? "✓ no repeats" : "no repeats: off"}</PillButton>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
        <div style={{ ...monoLabel, color: "var(--ink-soft)" }}>Study / Write focus</div>
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "center" }}>
          {[["due", "due today"], ["all", "everything"], ["trouble", "trouble words"]].map(([f, lbl]) => (
            <PillButton key={f} on={s.focus === f} onClick={() => onSettings("setFocus", f)} onColor="var(--accent)">{lbl}</PillButton>
          ))}
        </div>
      </div>
      <GeminiKeyField value={geminiKey} onChange={setGeminiKey} />
    </div>
  );
}

// ---------- ADD A WORD (the backend validates, commits to GitHub and serves the new file) ----------
export const fieldLabel = { display: "block", marginBottom: "6px", ...monoLabel, color: "var(--ink-soft)" };
export const fieldInput = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px", fontFamily: "var(--font-serif)", fontSize: "17px",
  border: "1px solid var(--line)", borderRadius: "10px", background: "var(--paper-raised)", color: "var(--ink)", outline: "none",
};

export function AddWord({ summary, ghToken, onToken, onAdded }) {
  const [lvl, setLvl] = useState(summary.settings.levels[0] || "A2");
  const [cat, setCat] = useState("der");
  const [de, setDe] = useState("");
  const [en, setEn] = useState("");
  const [example, setExample] = useState("");
  const [prefix, setPrefix] = useState("");
  const [state, setState] = useState({ status: "idle" });
  const saving = state.status === "saving";
  const isNoun = cat === "der" || cat === "die" || cat === "das";
  const submit = () => {
    if (saving) return;
    setState({ status: "saving" });
    api.post("/api/vocab/words", { lvl, cat, de, en, example, prefix: cat === "sep" ? prefix : "" }, { "X-GitHub-Token": ghToken || "" })
      .then((r) => {
        setDe(""); setEn(""); setExample(""); setPrefix("");
        setState({ status: "done", word: r.entry.de, lvl: r.lvl, url: r.commitUrl });
        onAdded();
      })
      .catch((err) => setState({ status: "error", message: err.message }));
  };
  return (
    <div onKeyDown={(e) => { if (e.key === "Enter" && e.target.tagName === "INPUT" && e.target.type !== "password" && !e.nativeEvent.isComposing) submit(); }}
      style={{ ...srsCol, width: "min(440px, 92vw)", margin: "0 auto", gap: "16px", alignItems: "stretch" }}>
      <div style={{ ...monoLabel, textAlign: "center", lineHeight: 1.7 }}>the backend adds the word to german_vocab.json · one commit on GitHub</div>
      <LevelToggle levels={summary.levels} selected={[lvl]} onToggle={setLvl} />
      <FilterBar cats={summary.cats} active={[cat]} onToggle={setCat} />
      <label>
        <span style={fieldLabel}>{isNoun ? "German noun (article added for you)" : "German"}</span>
        <input value={de} onChange={(e) => setDe(e.target.value)} style={fieldInput} disabled={saving}
          placeholder={isNoun ? "Abfall" : cat === "sep" ? "vorbereiten" : cat === "phrase" ? "Ich bin der Meinung, dass ..." : ""} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      </label>
      <label>
        <span style={fieldLabel}>English</span>
        <input value={en} onChange={(e) => setEn(e.target.value)} style={fieldInput} disabled={saving} autoCapitalize="off" spellCheck={false} />
      </label>
      {cat === "sep" && (
        <label>
          <span style={fieldLabel}>Prefix (optional — guessed if blank)</span>
          <input value={prefix} onChange={(e) => setPrefix(e.target.value)} style={fieldInput} disabled={saving} placeholder="vor" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        </label>
      )}
      <label>
        <span style={fieldLabel}>Example sentence (optional{cat === "sep" || isNoun ? " — powers the fill-in quizzes" : ""})</span>
        <input value={example} onChange={(e) => setExample(e.target.value)} style={fieldInput} disabled={saving}
          placeholder={cat === "sep" ? "Ich bereite das Essen vor." : isNoun ? "Der Abfall kommt in den Müll." : ""} spellCheck={false} />
      </label>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
        <button type="button" onClick={submit} disabled={saving} style={{ ...navBtnStyle, opacity: saving ? 0.6 : 1, cursor: saving ? "default" : "pointer" }}>{saving ? "committing …" : "add & commit ›"}</button>
        {!ghToken && (
          <GeminiKeyField value={ghToken} onChange={onToken} label="🔑 GitHub token (one-time)" placeholder="fine-grained token (github_pat_…)"
            help="Needed to commit to german_vocab.json in Harsimar17/Deutsch-Vocab-Helper. Create a fine-grained token at github.com/settings/personal-access-tokens limited to that repo with Contents: Read and write. Kept in memory for this visit and sent with each add — the backend never stores it." />
        )}
        {state.status === "error" && <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--bad)", textAlign: "center", lineHeight: 1.5 }}>{state.message}</div>}
        {state.status === "done" && (
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--good)", textAlign: "center", lineHeight: 1.6 }}>
            ✓ “{state.word}” committed
            {state.url && <React.Fragment> · <a href={state.url} target="_blank" rel="noreferrer" style={{ color: "var(--good)" }}>view commit</a></React.Fragment>}
            <div style={{ color: "var(--ink-faint)" }}>
              already in the app — the backend serves the committed file right away
              {!summary.settings.levels.includes(state.lvl) ? ` · ${state.lvl} isn't selected in settings, so it won't show in Study yet` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
