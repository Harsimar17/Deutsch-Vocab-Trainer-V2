// Talkloop's screen state. The engine (engine.js) runs the conversation; instead of writing to
// the page it writes here, and the React components render from it (useUi).
import { useSyncExternalStore } from "react";

const listeners = new Set();
let state = {
  stats: { streak: 0, rapport: 0 },
  // Which parts of the page show.
  view: { keygate: false, setup: false, chatgpt: false, call: false, keySaved: false, editSavedKeys: false },
  // The setup screen's choices (setForm in engine.js keeps some of them in this browser).
  form: {
    language: "German", native: "English", level: "A1", mode: "lead", officeGap: "normal", tense: "any",
    scenario: "cafe", connector: "mix", useVocab: true, sayAgain: true, liveVoice: false, grammarCheck: true,
  },
  keyStatus: "",
  keySummary: "",
  keysVersion: 0, // the key screen redraws its fields when this changes
  provider: "groq",
  composer: { buttonsDisabled: false, textDisabled: false },
  mistakes: { language: "German", synced: false, items: [] },
  bookmarks: [],
  vocabStatusAt: 0, // when set, the setup screen brings the vocab message into view
  aiChoices: [], // [{ value, label }] for "Talk with"
  aiChoice: "",
  voiceStatus: "",
  vocabStatus: "",
  trainerStatus: "",
  useVocab: { checked: true, disabled: true },
  chatgptUrl: "",
  connectors: [], // [{ value, label }] for the connector choice
  recap: null, // { kind: "words" | "sentences", ... } after a call
  chatsVersion: 0,
  mistakesVersion: 0,
  bookmarksVersion: 0,
  // The call screen.
  call: { avatar: "", name: "", mode: "", topic: "", timer: "00:00", state: "idle", stateText: "Connecting…", topicOpen: false },
  mic: { on: false, label: "Talk", disabled: false },
  pause: { on: false, disabled: false },
  transcript: [], // messages, see addMessage
  coach: null, // { understood, correction, tip, mistakes, extra, expanded }
  suggestions: [],
  focus: null, // { label, words: [{ de, en, state, current, peek }] }
  topicWords: null, // the "Use these words" panel: { count, sub, lang, words, flash, flashAt }
  drill: null, // { target, feedback, ok }
  sayThis: null, // { text, kind }
  heard: "",
  status: "",
  busy: false,
  autoSend: true,
  umlautShift: false,
  typing: false,
  explorer: null, // { kind: "word" | "lookup", word, sentence, info, error, loading }
  office: { show: false, talking: false },
};

export const ui = {
  get: () => state,
  set(patch) {
    state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
    listeners.forEach((l) => l());
  },
  // Merges into one of the nested objects: ui.merge("call", { timer: "01:02" }).
  merge(key, patch) {
    ui.set({ [key]: { ...state[key], ...patch } });
  },
  bump(key) {
    ui.set({ [key]: state[key] + 1 });
  },
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function useUi(selector = (s) => s) {
  return useSyncExternalStore(ui.subscribe, () => selector(state));
}

// ---- transcript messages ----
let nextId = 1;
export function addMessage(msg) {
  const m = { id: nextId++, speaking: -1, voiceNote: "", ...msg };
  ui.set({ transcript: [...state.transcript, m] });
  return m.id;
}
export function updateMessage(id, patch) {
  ui.set({ transcript: state.transcript.map((m) => (m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)) });
}
export const clearTranscript = () => ui.set({ transcript: [] });

// A message's words with their character offsets, as the old page split them (wordify):
// the same split drives both what is shown and which word is highlighted while it is spoken.
export function wordTokens(text) {
  const out = [];
  for (const match of String(text ?? "").matchAll(/[\p{L}\p{M}'’-]+|[^\p{L}\p{M}'’-]+/gu)) {
    const chunk = match[0];
    out.push({ text: chunk, word: /\p{L}/u.test(chunk), start: match.index, end: match.index + chunk.length });
  }
  return out;
}

// What the voice code used to get as the list of word <span>s of a message: it highlights
// the word being spoken. `length` is the number of words, like the list's.
export class WordTrack {
  constructor(messageId, text) {
    this.id = messageId;
    this.words = wordTokens(text).filter((t) => t.word);
    this.length = this.words.length;
  }
  highlight(i) {
    const m = state.transcript.find((x) => x.id === this.id);
    if (!m || m.speaking === i) return; // only a change redraws the message
    updateMessage(this.id, { speaking: i });
  }
  highlightAt(charIndex) {
    this.highlight(this.words.findIndex((w) => charIndex >= w.start && charIndex < w.end));
  }
  clear() {
    this.highlight(-1);
  }
}
export const NO_WORDS = { length: 0, highlight() {}, highlightAt() {}, clear() {}, id: null };

// Elements the engine still needs as elements: the typing box (its text, caret and focus are
// the browser's, as with any uncontrolled input) and the scrolling transcript.
export const refs = {};
export const setRef = (name) => (el) => { refs[name] = el; };
