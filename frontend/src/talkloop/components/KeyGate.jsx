import React, { useEffect, useState } from "react";
import { useUi } from "../ui.js";
import { keyGateInfo, editSavedKeys, saveKeys, setForm } from "../engine.js";
import { PROVIDERS } from "../options.js";

const EMPTY = { openai: "", mistral: "", groq: "", groq2: "", groq3: "", cfAccount: "", cfToken: "", gemini: "", gemini2: "", geminiLive: "" };

// The key screen: which AI to talk with, and its keys (saved in the learner's account).
export function KeyGate() {
  const keysVersion = useUi((s) => s.keysVersion);
  const savedProvider = useUi((s) => s.provider);
  const keyStatus = useUi((s) => s.keyStatus);
  const grammarCheck = useUi((s) => s.form.grammarCheck);
  const [provider, setProvider] = useState(savedProvider);
  const [typed, setTyped] = useState(EMPTY);
  const [model, setModel] = useState("");
  useEffect(() => setProvider(savedProvider), [savedProvider, keysVersion]);
  const info = keyGateInfo(provider);
  const ph = (service, placeholder) => (info.saved[service] ? "Saved — leave blank to keep" : placeholder);
  const field = (service, placeholder, type = "password") => (
    <input type={type} autoComplete="off" spellCheck={false} value={typed[service]} placeholder={ph(service, placeholder)}
      onChange={(e) => setTyped({ ...typed, [service]: e.target.value })} />
  );
  const save = async () => {
    if (await saveKeys(provider, typed, model)) setTyped(EMPTY);
  };

  return (
    <section id="keygate" className="card">
      <h2>Connect an AI provider</h2>
      <p className="muted">{info.intro}</p>
      <label>Conversation AI
        <select id="provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => <option key={p.value} value={p.value}>{p.label}{info.ready[p.value] ? " ✓" : ""}</option>)}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={grammarCheck} onChange={(e) => setForm({ grammarCheck: e.target.checked })} />
        Double-check my grammar with LanguageTool <span className="muted">(free, no key; catches mistakes the AI misses)</span>
      </label>
      {info.show.openai && (
        <label>OpenAI API key
          {field("openai", "Paste your OpenAI key (sk-…)")}
          <span className="muted">From <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a> (paid per use).</span>
        </label>
      )}
      {provider === "openai" && (
        <label>Model <span className="muted">(leave blank for gpt-6-luna)</span>
          <input type="text" autoComplete="off" spellCheck={false} placeholder="gpt-6-luna" value={model} onChange={(e) => setModel(e.target.value)} />
        </label>
      )}
      {info.show.groq && (
        <label>Groq API key {info.optional.groq && <span className="muted">(optional — used when OpenAI is busy)</span>}
          {field("groq", "Paste your Groq key (gsk_…)")}
          <span className="muted">Free at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>.</span>
        </label>
      )}
      {info.show.mistral && (
        <label>Mistral API key <span className="muted">(optional — used when Groq is busy)</span>
          {field("mistral", "Paste your Mistral key")}
          <span className="muted">Free at <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener">console.mistral.ai</a> (pick the free Experiment plan).</span>
        </label>
      )}
      {info.show.groq2 && (
        <label>Backup Groq key <span className="muted">(optional — another account's key, used when the first one reaches its limit)</span>
          {field("groq2", "Paste a second Groq key (gsk_…)")}
        </label>
      )}
      {info.show.groq3 && (
        <label>Second backup Groq key <span className="muted">(optional — a third account's key, used when the first two reach their limits)</span>
          {field("groq3", "Paste a third Groq key (gsk_…)")}
        </label>
      )}
      {info.show.cfAccount && (
        <label>Cloudflare Workers AI {info.optional.cf && <span className="muted">(optional — backup when Groq reaches its limit)</span>} <span className="muted">needs the Vocab Trainer link</span>
          {field("cfAccount", "Cloudflare account ID (32 characters)", "text")}
          {field("cfToken", "Cloudflare API token with Workers AI access")}
        </label>
      )}
      {info.show.gemini && (
        <label>Gemini API key {info.optional.gemini && <span className="muted">(optional — backup voice)</span>}
          {field("gemini", "Paste your key (AIza… or AQ.…)")}
          <span className="muted">Free at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.</span>
        </label>
      )}
      {info.show.gemini2 && (
        <label>Backup Gemini key <span className="muted">(optional — another account's key, used when the first one reaches its limit)</span>
          {field("gemini2", "Paste a second Gemini key (AIza… or AQ.…)")}
        </label>
      )}
      {info.show.geminiLive && (
        <label>Gemini 3.8 Live key <span className="muted">(optional — for the Gemini 3.8 Live voice call; leave blank to use the Gemini key above)</span>
          {field("geminiLive", "Paste your Gemini Live key (AIza… or AQ.…)")}
        </label>
      )}
      <button id="save-key" type="button" className="primary" onClick={save}>{info.saveLabel}</button>
      {info.showEditSaved && <button type="button" onClick={editSavedKeys}>Change my saved keys</button>}
      {keyStatus && <p className="status">{keyStatus}</p>}
    </section>
  );
}
