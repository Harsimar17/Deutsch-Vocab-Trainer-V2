// Talkloop client: speech in, AI character turn out, spoken back with word highlighting.
import { hasPiperVoice, piperLoaded, piperReady, loadPiperVoice, piperSpeak, MOODS } from "./piper.js?v=5"; // bump with piper.js changes so no browser pairs this file with an old copy

const $ = (id) => document.getElementById(id);

const state = {
  settings: null,
  history: [],
  rapport: 0,
  busy: false,
  finished: false,
  handsFree: false, // when true, the mic listens, auto-sends on a pause, and resumes after each reply
  speaking: false,
  paused: false, // call on hold: no voice, no mic, timer stopped
  drill: null, // { target, said, turn } while the learner says a correction again before the reply
};

const SILENCE_MS = 1500; // how long a pause ends your turn in hands-free mode

// ---------- persistence (per-browser conveniences only) ----------
const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private mode); the app still works without it.
    }
  },
};

function today() {
  return new Date().toISOString().slice(0, 10);
}

function bumpStreak() {
  const streak = store.get("streak", { count: 0, last: null });
  const now = today();
  if (streak.last === now) return streak.count;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  streak.count = streak.last === yesterday ? streak.count + 1 : 1;
  streak.last = now;
  store.set("streak", streak);
  return streak.count;
}

function renderStats() {
  $("streak").textContent = `🔥 ${store.get("streak", { count: 0 }).count}`;
  $("rapport").textContent = `♥ ${state.rapport}`;
}

// ---------- AI services (called directly from the browser with the user's own keys) ----------
// Conversation runs on Mistral (best German of the free tiers, with Groq as a backup when
// Mistral is busy) or on Gemini. Gemini is also the backup voice when Piper can't speak.
// Lite answers in about a second; Flash takes about five, so it is only the fallback.
const CONV_MODEL = "gemini-flash-lite-latest";
const CONV_FALLBACK_MODEL = "gemini-flash-latest";
const TTS_MODEL = "gemini-3.8-flash-tts";
const TTS_VOICE = "Kore";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

const MISTRAL = { name: "Mistral", url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" };
const GROQ = {
  name: "Groq",
  url: "https://api.groq.com/openai/v1/chat/completions",
  model: "openai/gpt-oss-120b",
  extra: { reasoning_effort: "low" }, // keep replies quick enough for a conversation
};

const memoryKeys = {}; // fallback when localStorage is unavailable
function getKey(service = "gemini") {
  try {
    return localStorage.getItem(`${service}_key`) || "";
  } catch {
    return memoryKeys[service] || "";
  }
}
function setKey(service, k) {
  memoryKeys[service] = k;
  try {
    if (k) localStorage.setItem(`${service}_key`, k);
    else localStorage.removeItem(`${service}_key`);
  } catch {
    // storage unavailable; key lives only for this page load
  }
}

// Which service runs the conversation. People who only ever saved a Gemini key stay on Gemini.
function getProvider() {
  let saved = "";
  try {
    saved = localStorage.getItem("talkloop_provider") || "";
  } catch {
    saved = memoryKeys.provider || "";
  }
  if (saved === "mistral" || saved === "gemini" || saved === "groq") return saved;
  return getKey("gemini") && !getKey("mistral") ? "gemini" : "mistral";
}
function setProvider(p) {
  memoryKeys.provider = p;
  try {
    localStorage.setItem("talkloop_provider", p);
  } catch {
    // storage unavailable
  }
}

// Each scene has a goal with several steps, so the learner has to do most of the talking
// over many turns instead of finishing in two lines.
const SCENARIOS = {
  cafe: {
    character: "Inès",
    setting: "a barista at a busy neighbourhood café who loves recommending pastries",
    goal: "Take the learner's order: drink, size, milk, something to eat, here or to go, then payment. Chat a little while you prepare it.",
  },
  market: {
    character: "Tomás",
    setting: "a fruit seller at an outdoor market who haggles playfully",
    goal: "Sell the learner fruit and vegetables for a dinner they're cooking. Ask what they're making, suggest things, discuss quantities and haggle over the price.",
  },
  station: {
    character: "Yuki",
    setting: "a helpful ticket clerk at a train station during rush hour",
    goal: "Help the learner buy a ticket: destination, date and time, one-way or return, class, seat reservation, discount card, and which platform. Then tell them their train is delayed and help them choose an alternative.",
  },
  doctor: {
    character: "Dr. Weber",
    setting: "a friendly but thorough family doctor",
    goal: "Find out what's wrong: ask about the symptoms, since when, how bad, fever, medication, allergies, work and sleep. Explain what you think it is, what to take and how often, and whether they need a sick note.",
  },
  flat: {
    character: "Frau Schulz",
    setting: "a landlady showing a flat to a possible new tenant",
    goal: "Show the flat room by room and interview the learner: their job, income, why they're moving, pets, smoking, how long they'd stay, when they could move in. Let them ask about rent, deposit, heating and the neighbours.",
  },
  job: {
    character: "Herr Brandt",
    setting: "a recruiter interviewing the learner for a job at a mid-sized company",
    goal: "Run a job interview: ask them to introduce themselves, their experience, strengths and weaknesses, a difficult situation they solved, why this job, salary expectations and start date. Then invite their questions.",
  },
  office: {
    character: "Frau Yilmaz",
    setting: "a clerk at the town hall registration office who is strict about paperwork",
    goal: "Register the learner's new address: ask for ID, the landlord's confirmation, moving date, previous address, marital status and religion for tax. One document is missing; work out with them how to solve it.",
  },
  restaurant: {
    character: "Luca",
    setting: "a chatty waiter at a small family restaurant",
    goal: "Seat the learner, explain the specials, take drinks and food orders with questions about preferences and allergies. Later there's a problem with the dish; handle the complaint, then dessert, the bill and splitting it.",
  },
  hotel: {
    character: "Sophie",
    setting: "a receptionist at a city hotel",
    goal: "Check the learner in, but their booking can't be found. Sort it out together: name, dates, room type, how they booked. Then explain breakfast, Wi-Fi and checkout, and give tips for sightseeing.",
  },
  neighbour: {
    character: "Jonas",
    setting: "a friendly neighbour who has just moved in next door",
    goal: "Get to know the learner on the stairs: where they're from, how long they've lived here, work, hobbies, tips for the area. Invite them to a small party and agree on day, time and what to bring.",
  },
  dentist: {
    character: "Frau Klein",
    setting: "a receptionist answering the phone at a busy dental practice",
    goal: "Take an appointment request by phone: name and spelling, date of birth, insurance, what the problem is, how urgent. Offer times that don't fit at first and negotiate until one works, then confirm.",
  },
  shop: {
    character: "Max",
    setting: "a shop assistant in a clothing store",
    goal: "The learner wants to return a jacket. Ask what's wrong, when they bought it, whether they have the receipt. Offer an exchange or a voucher instead of a refund and negotiate, then help them try something else.",
  },
};

// A general partner used by the AI-led modes (not tied to a scene).
const PARTNER = { character: "Mika", setting: "a warm, patient native-speaker conversation partner and language buddy" };

// Conversation modes. Open modes never end on their own — they run until you quit.
const MODES = {
  lead: {
    label: "Free chat — the partner leads",
    usesScene: false,
    endable: false,
    opener: "(Start the conversation. Greet the learner warmly and ask one easy opening question.)",
    extra: "You lead the whole conversation. Always finish your reply with a question that keeps it going. Follow up on what the learner says, gently change topic when one runs dry, and keep it light and encouraging. Never end the conversation: always set conversation_finished to false.",
  },
  interview: {
    label: "Interview me",
    usesScene: false,
    endable: false,
    opener: "(Greet the learner and ask their name or how their day is going.)",
    extra: "Interview the learner about their life, day, hobbies, work and opinions. Ask one question at a time, react to the answer, then ask a natural follow-up. Never end: always set conversation_finished to false.",
  },
  topic: {
    label: "Discuss a topic",
    usesScene: false,
    endable: false,
    opener: "(Pick a light, everyday topic suited to the learner's level — food, travel, films, weekend plans — introduce it in one line and ask the learner what they think.)",
    extra: "Have a back-and-forth discussion about an everyday topic at the learner's level. Share a short opinion, then ask what they think. Keep it flowing and never end: always set conversation_finished to false.",
  },
  // Sentence making with the learner's own words: one word per turn, a short situation,
  // one sentence from the learner, a quick check, the next word (see the speaking schedule).
  sentences: {
    label: "Sentence drill — my learnt words",
    usesScene: false,
    endable: false,
    drill: true,
    opener: "(Greet the learner in one short line, say which situation you are starting, and give its first step.)",
    extra: "This is a sentence drill played out as one realistic everyday situation, like a short story the learner lives through (for example: moving into a new flat, a day at work, planning a trip, a visit to the doctor). Choose a situation in which as many of today's words as possible would naturally come up, and tell the learner in one short line what it is. Then go through it step by step, in order: each turn, describe the next logical moment of the situation in one or two short, simple sentences and ask the learner what they do, say or think there, in one full sentence using the word that fits that moment (the app shows the learner its meaning). Every step must follow sensibly from the previous one and from what the learner said, so the whole drill reads like one coherent story where every sentence makes sense. When none of the remaining words fits the situation any more, start a new one and say so (Neue Situation: …); never force a word into a moment where a real person wouldn't use it. React to the learner's sentence in a few words, no small talk. Set situation to a short title (2–5 words, in the language being practised) of the current situation. Leave suggestions empty and keep reply_translation short. Never end: always set conversation_finished to false.",
  },
  scene: {
    label: "Scene role-play",
    usesScene: true,
    endable: true,
    opener: "(The learner walks up. Greet them and open the scene.)",
    extra: "Play out the scene naturally, one step at a time. Ask the learner questions so they do most of the talking, and ask follow-ups when an answer is short. Set conversation_finished to true only once every part of the scene goal is done, usually after ten or more exchanges.",
  },
};

// Tense practice: the partner steers the talk so the learner has to use this tense,
// and the coach checks it. "any" adds nothing.
const TENSES = {
  any: null,
  present: {
    short: "Präsens",
    form: "the present tense (in German the Präsens: ich spiele, du fährst, er ist)",
    ask: "what the learner usually does, their routines, likes, family, job and what is happening right now",
  },
  perfekt: {
    short: "Perfekt",
    form: "the spoken past (in German the Perfekt: haben or sein + Partizip II, e.g. ich habe gekocht, ich bin gefahren)",
    ask: "what the learner did yesterday, last weekend, on their last holiday or at work this week",
  },
  praeteritum: {
    short: "Präteritum",
    form: "the simple past used for telling stories (in German the Präteritum: ich ging, ich machte, ich war, ich hatte, ich konnte)",
    ask: "stories: their childhood, how something happened, a film or book they remember, an adventure",
  },
  future: {
    short: "Futur I",
    form: "the future (in German Futur I: werden + infinitive, e.g. ich werde reisen)",
    ask: "the learner's plans for tonight, the weekend, next year, and their dreams",
  },
};

// ---------- Vocabulary (user-imported, stored locally in IndexedDB) ----------
const VOCAB_DB = "talkloop";
const VOCAB_KV = "kv";

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(VOCAB_DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(VOCAB_KV);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function idbSet(key, val) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOCAB_KV, "readwrite");
    tx.objectStore(VOCAB_KV).put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VOCAB_KV, "readonly");
    const rq = tx.objectStore(VOCAB_KV).get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
  });
}

// Flatten the nested { levels: { A1: { nouns: { der:[...] }, verbs:[...] } } } shape
// into a flat list of { de, en, example, level, cat }.
function flattenVocab(json) {
  const out = [];
  const levels = json?.levels ?? {};
  const add = (e, level, cat) => {
    if (e && e.de) out.push({ de: e.de, en: e.en ?? "", example: e.example ?? "", level, cat });
  };
  for (const level of Object.keys(levels)) {
    const cats = levels[level] ?? {};
    for (const cat of Object.keys(cats)) {
      const v = cats[cat];
      if (Array.isArray(v)) v.forEach((e) => add(e, level, cat));
      else if (v && typeof v === "object") {
        for (const sub of Object.keys(v)) {
          if (Array.isArray(v[sub])) v[sub].forEach((e) => add(e, level, cat));
        }
      }
    }
  }
  return out;
}

const DEFAULT_VOCAB_URL = "https://harsimar17.github.io/Deutsch-Vocab-Helper/german_vocab.json";

async function storeVocab(json) {
  const words = flattenVocab(json);
  if (!words.length) throw new Error("No vocabulary found in that source.");
  await idbSet("vocab_words", words);
  await idbSet("vocab_seen", []);
  return { count: words.length, levels: [...new Set(words.map((w) => w.level))].sort() };
}

async function importVocab(file) {
  return storeVocab(JSON.parse(await file.text()));
}

async function importVocabFromUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
  return storeVocab(await res.json());
}

async function vocabMeta() {
  const words = (await idbGet("vocab_words")) ?? [];
  return { count: words.length, levels: [...new Set(words.map((w) => w.level))].sort() };
}

// ---------- Link to the Vocab Trainer (only the words learnt there) ----------
// Talkloop links itself from the trainer's login (linkFromTrainerSession below). It also
// still takes a link in the address: #vocab-link=…&vocab-api=…:
// a read-only link to the learner's learnt words. It is kept here and the
// fragment is wiped from the address bar.
function takeTrainerLinkFromUrl() {
  const params = new URLSearchParams(location.hash.slice(1));
  const token = params.get("vocab-link");
  const api = params.get("vocab-api");
  if (!token || !/^https?:\/\//.test(api ?? "")) return false;
  store.set("trainer_link", { token, api: api.replace(/\/+$/, "") });
  history.replaceState(null, "", location.pathname + location.search);
  return true;
}

function trainerLink() {
  return store.get("trainer_link", null);
}

// Talkloop is served by the Vocab Trainer itself (at /talkloop/), so its backend is this
// page's own origin; "trainer_api" in localStorage overrides it (e.g. a local one).
const TRAINER_API = location.origin;

// Logged in to the trainer in this browser? It is the same site, so its session is right
// here: swap it for a read-only link without asking for the password again.
async function linkFromTrainerSession() {
  if (trainerLink()) return false;
  let session = null;
  try { session = JSON.parse(localStorage.getItem("wortschatz.session"))?.token ?? null; } catch { session = null; }
  if (!session) return false;
  const api = store.get("trainer_api", TRAINER_API).replace(/\/+$/, "");
  const res = await fetch(`${api}/api/talkloop/link`, { method: "POST", headers: { Authorization: `Bearer ${session}` } });
  if (!res.ok) return false; // an expired session: the form below still works
  store.set("trainer_link", { token: (await res.json()).token, api });
  return true;
}

// Log in to the trainer once and swap the session for the same read-only link the
// trainer's button hands out. The password is sent only to the trainer and not kept.
async function connectTrainer(email, password) {
  const api = store.get("trainer_api", TRAINER_API).replace(/\/+$/, "");
  const message = async (res) => (await res.json().catch(() => ({}))).message || `Vocab Trainer answered ${res.status}`;
  const login = await fetch(`${api}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (login.status === 401) throw new Error("Wrong email or password.");
  if (!login.ok) throw new Error(await message(login));
  const { token: session } = await login.json();
  const res = await fetch(`${api}/api/talkloop/link`, { method: "POST", headers: { Authorization: `Bearer ${session}` } });
  if (!res.ok) throw new Error(await message(res));
  store.set("trainer_link", { token: (await res.json()).token, api });
}

// Learnt words, the least secure first (the trainer sorts them).
async function fetchLearntWords() {
  const link = trainerLink();
  const res = await fetch(`${link.api}/api/talkloop/words`, { headers: { Authorization: `Bearer ${link.token}` } });
  if (res.status === 401) {
    store.set("trainer_link", null);
    throw new Error("The link to the Vocab Trainer has expired. Connect again.");
  }
  if (!res.ok) throw new Error(`Vocab Trainer answered ${res.status}`);
  const { words } = await res.json();
  return words.map((w) => ({ de: w.de, en: w.en ?? "", example: w.example ?? "", level: w.lvl, cat: w.cat }));
}

// In-memory state for the active session.
// Each pool rotates on its own, so a small pool keeps coming back next to a big one.
let vocabPools = []; // [{ words, pointer }]
let vocabSeen = new Set();

// The levels counted as known when linked to the trainer: all their words are used.
// Higher levels use only the words learnt in the trainer.
const KNOWN_LEVELS = ["A1", "A2"];

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// learnt (linked to the trainer): every A1/A2 word, shuffled, plus the learnt B1 words
// in the trainer's order so the shakiest come up first. Otherwise the imported list, shuffled.
async function loadVocabForSession(levels, learnt = null) {
  const all = ((await idbGet("vocab_words")) ?? []).filter((w) => levels.includes(w.level));
  if (learnt) {
    const higher = learnt.filter((w) => levels.includes(w.level) && !KNOWN_LEVELS.includes(w.level));
    const known = shuffled(all.filter((w) => KNOWN_LEVELS.includes(w.level)));
    vocabPools = [higher, known];
  } else {
    vocabPools = [shuffled(all)];
  }
  vocabPools = vocabPools.filter((words) => words.length).map((words) => ({ words, pointer: 0 }));
  vocabBatch = [];
  vocabSeen = new Set((await idbGet("vocab_seen")) ?? []);
  return vocabPools.reduce((sum, p) => sum + p.words.length, 0);
}

// The words offered to the partner, oldest first. Only a few change each turn: a whole new
// random set every turn made the partner jump from topic to topic to fit them in, while a
// steady set lets it bring each word in once the talk gets there.
let vocabBatch = [];
const VOCAB_TURNOVER = 2; // words replaced per turn

// The words for this turn: last turn's, minus the oldest few, topped up from the pools,
// shared evenly between them (the learnt B1 words first).
function nextVocabBatch(n = 12) {
  const batch = vocabBatch.slice(Math.min(VOCAB_TURNOVER, vocabBatch.length), n);
  const fresh = [];
  vocabPools.forEach((pool, i) => {
    const share = Math.ceil((n - batch.length - fresh.length) / (vocabPools.length - i));
    // Skip words already offered (a small pool comes round again quickly).
    for (let k = 0, tries = 0; k < share && tries < pool.words.length; tries++) {
      const word = pool.words[pool.pointer % pool.words.length];
      pool.pointer++;
      if (batch.includes(word) || fresh.includes(word)) continue;
      fresh.push(word);
      k++;
    }
  });
  vocabBatch = [...batch, ...fresh];
  fresh.forEach((w) => vocabSeen.add(w.de));
  idbSet("vocab_seen", [...vocabSeen]).catch(() => {});
  return vocabBatch;
}

// ---------- mistake tracker ----------
// Every correction is tagged with the kinds of mistake it fixes. The tags are kept per
// language in this browser, and the ones that keep coming back go into the prompt so the
// partner sets up sentences that test them: spaced repetition of the learner's own errors.
const MISTAKE_TYPES = {
  case_article: "articles and case (der/den/dem, ein/einen, noun gender)",
  verb_position: "verb position (verb second; verb at the end after weil, dass, wenn)",
  perfekt_auxiliary: "Perfekt auxiliary (haben or sein)",
  participle: "past participle form (gegessen, gegangen, gekauft)",
  separable_verb: "separable verbs (aufstehen: ich stehe früh auf)",
  verb_ending: "verb endings (ich habe, du hast, er hat)",
  adjective_ending: "adjective endings (ein guter Kaffee, mit dem neuen Auto)",
  preposition: "prepositions (in, auf, zu, nach, mit …)",
  negation: "negation (nicht or kein)",
  plural: "plural forms",
  word_choice: "word choice",
  tense: "tense (another tense where the one being practised was needed)",
  other: "other",
};
const MISTAKE_HALF_LIFE_DAYS = 7; // a mistake counts half as much a week later
// The same kinds, as briefly as the prompt needs them (it is sent with every turn).
const PROMPT_MISTAKES = "case_article (der/den/dem, ein/einen, gender), verb_position (verb second; last after weil/dass/wenn), perfekt_auxiliary (haben/sein), participle, separable_verb, verb_ending, adjective_ending, preposition, negation (nicht/kein), plural, word_choice, tense, other";

function recordMistakes(language, types, said, fix) {
  const log = store.get("mistakes", {});
  const at = Date.now();
  log[language] = [...(log[language] ?? []), ...types.map((type) => ({ type, at, said, fix }))].slice(-300);
  store.set("mistakes", log);
}

// Mistake types by how much they still matter: each mistake counts less as it ages, so one
// you stopped making fades out and one that keeps coming back stays on top.
function rankedMistakes(language) {
  const now = Date.now();
  const byType = new Map();
  for (const m of store.get("mistakes", {})[language] ?? []) {
    const t = byType.get(m.type) ?? { type: m.type, count: 0, weight: 0, example: m };
    t.count++;
    t.weight += 0.5 ** ((now - m.at) / 86_400_000 / MISTAKE_HALF_LIFE_DAYS);
    t.example = m; // the log is oldest first, so this ends on the newest
    byType.set(m.type, t);
  }
  return [...byType.values()].filter((t) => MISTAKE_TYPES[t.type]).sort((a, b) => b.weight - a.weight);
}

// The top 3 that recur (made at least twice), which the partner deliberately tests.
function recurringMistakes(language) {
  return rankedMistakes(language).filter((t) => t.count >= 2 && t.type !== "other").slice(0, 3);
}

// ---------- mistake log sync ----------
// With the Vocab Trainer linked, the log follows the learner across devices: the trainer
// keeps the merged log of all of them. Syncs run only when the app opens, when a call ends
// and when the page is left, and nothing ever waits for one: the prompt always reads the
// log on this device, so a slow or sleeping trainer can't delay a reply or a call.
let mistakeSync = null; // the sync in flight, if any

function syncMistakes({ keepalive = false } = {}) {
  const link = trainerLink();
  if (!link || mistakeSync) return;
  const startedAt = Date.now();
  const since = store.get("mistakes_synced_at", 0);
  const log = store.get("mistakes", {});
  const resets = store.get("mistake_resets", {});
  // Only what this device recorded since its last sync, plus its reset times.
  const languages = {};
  for (const language of new Set([...Object.keys(log), ...Object.keys(resets)])) {
    languages[language] = { resetAt: resets[language] ?? 0, entries: (log[language] ?? []).filter((m) => m.at >= since) };
  }
  const body = JSON.stringify({ languages });
  mistakeSync = fetch(`${link.api}/api/talkloop/mistakes`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}`, "Content-Type": "application/json" },
    body,
    keepalive: keepalive && body.length < 60_000, // a page being left may still send it (64 KB limit)
  })
    .then(async (res) => {
      if (!res.ok) return; // e.g. an expired link: refreshLearntWords tells the learner
      mergeMistakes((await res.json()).languages ?? {}, startedAt);
      store.set("mistakes_synced_at", startedAt);
      renderMistakes();
    })
    .catch(() => {}) // offline or asleep: what wasn't sent goes next time
    .finally(() => { mistakeSync = null; });
}

// The trainer's merged log replaces this device's, keeping anything recorded here while
// the sync was under way (it goes up with the next one).
function mergeMistakes(merged, startedAt) {
  const local = store.get("mistakes", {});
  const resets = store.get("mistake_resets", {});
  const log = { ...local };
  for (const [language, { resetAt = 0, entries = [] }] of Object.entries(merged)) {
    resets[language] = Math.max(resets[language] ?? 0, resetAt);
    const seen = new Set(entries.map((m) => `${m.at}|${m.type}|${m.said}`));
    const late = (local[language] ?? []).filter((m) => m.at >= startedAt && !seen.has(`${m.at}|${m.type}|${m.said}`));
    log[language] = [...entries, ...late].filter((m) => m.at > resets[language]).sort((a, b) => a.at - b.at).slice(-300);
  }
  store.set("mistake_resets", resets);
  store.set("mistakes", log);
}

// ---------- speaking schedule ----------
// Knowing a word in the trainer isn't the same as saying it without thinking. That comes
// from recalling it yourself, out loud, in a real sentence, again over several days. So
// each call has a few "today's words": shown in English, elicited (never said first) by
// the partner, and checked by the coach. Said correctly on a new day, a word moves up a
// stage and comes back later; at stage 4 it is automatic. Kept per word in this browser
// ("spoken": {de: {stage, due, uses, lastDay, updatedAt}}) and synced with the trainer.
const TODAY_WORDS = 5;
const SPOKEN_DAYS = [1, 3, 7, 21]; // due again this many days after reaching stage 1..4
const AUTOMATIC_RECHECK_DAYS = 60; // an automatic word said correctly again
const DONE_AFTER = 2;
const DRILL_HISTORY = 6; // messages a sentence drill sends back to the model (3 exchanges) // correct uses in one call before a word makes room for the next
let todayWords = null; // { active, waiting, status: {de: {correct, wrong, peeked}} } during a linked call

function localDay(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Due words first (the least secure first), then words never said, in the trainer's
// order (least secure first). Words not yet due, automatic ones included, wait.
// A drill (evenIfNotDue) then goes on with the rest, the soonest due first, so it never runs dry.
function pickTodayWords(learnt, { evenIfNotDue = false } = {}) {
  const spoken = store.get("spoken", {});
  const now = Date.now();
  const due = learnt.filter((w) => spoken[w.de] && spoken[w.de].due <= now)
    .sort((a, b) => spoken[a.de].stage - spoken[b.de].stage || spoken[a.de].due - spoken[b.de].due);
  const later = evenIfNotDue
    ? learnt.filter((w) => spoken[w.de] && spoken[w.de].due > now).sort((a, b) => spoken[a.de].due - spoken[b.de].due)
    : [];
  const order = [...due, ...learnt.filter((w) => !spoken[w.de]), ...later];
  todayWords = { active: order.slice(0, TODAY_WORDS), waiting: order.slice(TODAY_WORDS), status: {} };
}

function setSpoken(de, entry) {
  const spoken = store.get("spoken", {});
  spoken[de] = { ...entry, updatedAt: Date.now() };
  store.set("spoken", spoken);
}

// Said correctly without peeking: up a stage, once per day (a second use the same day only counts).
function spokenCorrect(de) {
  const prev = store.get("spoken", {})[de];
  const day = localDay();
  if (prev && prev.lastDay === day) {
    setSpoken(de, { ...prev, uses: prev.uses + 1 });
    return;
  }
  const stage = Math.min(4, (prev?.stage ?? 0) + 1);
  const days = prev?.stage === 4 ? AUTOMATIC_RECHECK_DAYS : SPOKEN_DAYS[stage - 1];
  setSpoken(de, { stage, due: Date.now() + days * 86_400_000, uses: (prev?.uses ?? 0) + 1, lastDay: day });
}

// Wrong, or needed the German shown: back to stage 1 (0 if never said), due tomorrow.
function spokenMissed(de) {
  const prev = store.get("spoken", {})[de];
  setSpoken(de, {
    stage: prev ? Math.min(prev.stage, 1) : 0,
    due: Date.now() + 86_400_000,
    uses: prev?.uses ?? 0,
    lastDay: prev?.lastDay ?? "",
  });
}

// Which of today's words the model means: it may drop or change the article.
const bareWord = (s) => normalizeSpeech(s).replace(/^(der|die|das) /, "");
// A card can hold alternatives ("zuerst / dann / danach", "dort / da"): each one counts.
const wordForms = (de) => [bareWord(de), ...de.split(/\s*[/;]\s*/).map(bareWord)].filter(Boolean);
const isTodayWord = (w, word) => wordForms(w.de).includes(bareWord(word ?? ""));
function findTodayWord(word) {
  return todayWords?.active.find((w) => isTodayWord(w, word));
}

// Whether a text contains a word or one of its alternatives (at a word start, so "gut"
// isn't found in "Mut"); a verb also by its stem, so "umtauschen" is caught in "umtauschst".
function saysWord(text, de) {
  const hay = ` ${normalizeSpeech(text ?? "")}`;
  return wordForms(de).some((word) => {
    const stem = / /.test(word) || word.length < 7 ? null : word.replace(/e?n$/, "");
    return hay.includes(` ${word}`) || Boolean(stem && hay.includes(` ${stem}`));
  });
}

// The coach's used_words for the learner's last message.
function recordUsedWords(used) {
  if (!todayWords || !Array.isArray(used)) return;
  for (const u of used) {
    const w = findTodayWord(u?.word);
    if (!w) continue;
    const s = (todayWords.status[w.de] ??= { correct: 0, wrong: 0, peeked: false });
    if (u.correct) {
      s.correct++;
      if (!s.peeked) spokenCorrect(w.de); // after a peek it counts for this call only
    } else {
      s.wrong++;
      spokenMissed(w.de);
    }
  }
  // A word said correctly often enough makes room for the next one.
  const done = todayWords.active.filter((w) => (todayWords.status[w.de]?.correct ?? 0) >= DONE_AFTER);
  for (const w of done) {
    todayWords.active.splice(todayWords.active.indexOf(w), 1, ...todayWords.waiting.splice(0, 1));
  }
}

function peekTodayWord(de) {
  const s = (todayWords.status[de] ??= { correct: 0, wrong: 0, peeked: false });
  if (s.peeked || s.correct) return; // a word already said shows its German anyway
  s.peeked = true;
  spokenMissed(de);
}

// After a call: what was said, tried and not reached, under "Start a conversation".
function renderRecap() {
  const box = $("recap");
  const status = todayWords?.status ?? {};
  const said = Object.entries(status).filter(([, s]) => s.correct && !s.peeked).map(([de]) => de);
  const tried = Object.entries(status).filter(([de]) => !said.includes(de)).map(([de]) => de);
  const missed = todayWords ? todayWords.active.map((w) => w.de).filter((de) => !status[de]) : [];
  if (!said.length && !tried.length) {
    box.hidden = true;
    return;
  }
  const automatic = Object.values(store.get("spoken", {})).filter((s) => s.stage >= 4).length;
  const line = (label, words) => {
    if (!words.length) return null;
    const p = document.createElement("p");
    const b = document.createElement("strong");
    b.textContent = `${label}: `;
    p.append(b, words.join(", "));
    return p;
  };
  const head = document.createElement("h3");
  head.textContent = "Last call";
  const total = document.createElement("p");
  total.className = "muted";
  total.textContent = `${automatic} word${automatic === 1 ? "" : "s"} automatic so far. Words come back after 1, 3, 7 and 21 days.`;
  box.replaceChildren(head, ...[line("Said ✓", said), line("Practise again", tried), line("Not reached", missed)].filter(Boolean), total);
  box.hidden = false;
}

let spokenSync = null; // the sync in flight, if any

// Like syncMistakes: sends what changed here since the last sync, keeps the newer of each word.
function syncSpoken({ keepalive = false } = {}) {
  const link = trainerLink();
  if (!link || spokenSync) return;
  const startedAt = Date.now();
  const since = store.get("spoken_synced_at", 0);
  const words = Object.fromEntries(Object.entries(store.get("spoken", {})).filter(([, s]) => s.updatedAt >= since));
  const body = JSON.stringify({ words });
  spokenSync = fetch(`${link.api}/api/talkloop/spoken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}`, "Content-Type": "application/json" },
    body,
    keepalive: keepalive && body.length < 60_000,
  })
    .then(async (res) => {
      if (!res.ok) return;
      const merged = (await res.json()).words ?? {};
      const local = store.get("spoken", {});
      for (const [de, s] of Object.entries(merged)) {
        if (!local[de] || s.updatedAt > local[de].updatedAt) local[de] = s;
      }
      store.set("spoken", local);
      store.set("spoken_synced_at", startedAt);
    })
    .catch(() => {})
    .finally(() => { spokenSync = null; });
}

// The model writes these fields in this order, so coach comes first: it judges the
// learner's message before writing its own reply and suggestions, whose words it would
// otherwise credit to the learner. (Gemini needs propertyOrdering for that; the JSON
// Schema sent to Mistral keeps the order of properties.)
const TURN_SCHEMA = {
  type: "OBJECT",
  properties: {
    coach: {
      type: "OBJECT",
      properties: {
        understood: { type: "BOOLEAN" },
        correction: { type: "STRING" },
        mistakes: { type: "ARRAY", items: { type: "STRING", enum: Object.keys(MISTAKE_TYPES) } },
        tip: { type: "STRING" },
        // Which of today's words the learner's message contains (see the speaking schedule).
        used_words: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { word: { type: "STRING" }, correct: { type: "BOOLEAN" } },
            required: ["word", "correct"],
          },
        },
      },
      required: ["understood", "correction", "mistakes", "tip", "used_words"],
      propertyOrdering: ["understood", "correction", "mistakes", "tip", "used_words"],
    },
    // How the reply is spoken (the open-source German voice has a recording per mood).
    // Before the reply, so the voice can start on it while the rest is still being written.
    mood: { type: "STRING", enum: MOODS },
    reply: { type: "STRING" },
    reply_translation: { type: "STRING" },
    suggestions: { type: "ARRAY", items: { type: "STRING" } },
    rapport_delta: { type: "INTEGER" },
    conversation_finished: { type: "BOOLEAN" },
    // Which of today's words the reply asks for (its chip is highlighted), or "".
    next_word: { type: "STRING" },
    // The sentence drill's current situation, kept by the app so it stays coherent, or "".
    situation: { type: "STRING" },
  },
  required: ["coach", "mood", "reply", "reply_translation", "suggestions", "rapport_delta", "conversation_finished", "next_word", "situation"],
  propertyOrdering: ["coach", "mood", "reply", "reply_translation", "suggestions", "rapport_delta", "conversation_finished", "next_word", "situation"],
};

const WORD_SCHEMA = {
  type: "OBJECT",
  properties: {
    word: { type: "STRING" },
    translation: { type: "STRING" },
    part_of_speech: { type: "STRING" },
    pronunciation: { type: "STRING" },
    example: { type: "STRING" },
    example_translation: { type: "STRING" },
  },
  required: ["word", "translation", "part_of_speech", "pronunciation", "example", "example_translation"],
};

function personaFor({ scenario, mode }) {
  const m = MODES[mode] ?? MODES.scene;
  return m.usesScene ? SCENARIOS[scenario] ?? SCENARIOS.cafe : PARTNER;
}

// What "at the learner's level" means, so the partner doesn't drift above it (or talk down at C1).
const LEVEL_GUIDE = {
  A1: "Use only very common everyday words and short main clauses of about 5–8 words, mostly in the present tense (in German, Perfekt only for very common verbs, e.g. war, hatte, habe gemacht). No subordinate clauses. Ask simple, concrete questions about the learner's life, often yes/no or either-or questions. Where it helps, repeat a key word from the learner's message.",
  A2: "Use common everyday words and short sentences of about 6–10 words. The present, the everyday past tense (in German, Perfekt) and the simple future are fine; at most simple because/that/when clauses (in German, weil, dass, wenn). Ask concrete questions about routines, plans, past weekends and preferences.",
  B1: "Speak naturally but plainly, in sentences of up to about 15 words. Use all common tenses, subordinate clauses (in German, e.g. weil, obwohl, dass, wenn, als) and the occasional everyday idiom. Ask the learner for opinions, reasons and short stories about experiences.",
  B2: "Speak as to a fluent learner: natural sentences with a varied vocabulary, the conditional and the passive where they fit (in German, Konjunktiv II and Passiv), and common idioms. Ask open questions that need arguing, comparing or hypothesising.",
  C1: "Speak as to a near-native speaker: natural, idiomatic language with nuanced words, complex sentences and all tenses and moods. Discuss abstract topics in depth and ask the learner to justify, nuance or take a stance. Besides real mistakes, also correct phrasing that is grammatical but unidiomatic.",
};

function turnSystemPrompt({ language, nativeLanguage, level, scenario, mode, tense }, targetWords = [], learnt = false, learnerMessage = "", weakSpots = [], today = null) {
  const m = MODES[mode] ?? MODES.scene;
  const persona = personaFor({ scenario, mode });
  const t = TENSES[tense];
  // In tense practice, an answer in another tense is a mistake too: it gets a correction,
  // so the learner says it again in the tense being practised.
  const tenseMistake = t
    ? ` or doesn't use ${t.short} where your question called for it (then rewrite their message in ${t.short}, keeping their meaning and words, as the short full sentence they meant if it is a fragment, and list tense)`
    : "";
  // Every line is sent with every turn, so the rules are kept short (each word costs tokens
  // against the AI's daily limit); none of them was dropped when they were shortened.
  const lines = [
    `You are ${persona.character}, ${persona.setting}. Stay in character; speak only ${language}.`,
    `Learner: ${language} at CEFR ${level}, native ${nativeLanguage}. Reply in one or two short sentences at their level, ending with something they can answer.`,
    ...(LEVEL_GUIDE[level] ? [`At ${level}: ${LEVEL_GUIDE[level]}`] : []),
    m.extra,
    ...(m.usesScene && persona.goal ? [`Scene goal: ${persona.goal}`] : []),
    "The learner's message comes from speech recognition: ignore missing punctuation and obvious transcription slips.",
    `Write reply_translation and coach.tip in ${nativeLanguage}; everything else in ${language}.`,
    learnerMessage
      ? `Fill coach first. It judges only the learner's last message: ${JSON.stringify(learnerMessage)}. coach.correction: only if it has a real grammar or word-choice mistake${tenseMistake}, the faulty sentence(s) rewritten correctly, no explanation; then coach.mistakes lists each kind it fixes (${PROMPT_MISTAKES}); otherwise leave both empty. coach.tip: one short sentence praising or explaining something literally in that message (never credit words or grammar it doesn't contain), or empty.`
      : "No learner message yet: leave coach.correction, coach.mistakes, coach.tip and coach.used_words empty.",
    "Your reply is read aloud: sound like a real person, with short interjections (Oh!, Ach wirklich?, Super!) and ! or ? where you mean them.",
    `mood: ${MOODS.join("|")}; amused for fun replies, surprised for amazement, angry only if the role calls for it, sleepy, whisper for secrets, else neutral.`,
  ];
  if (t) {
    lines.push(`Tense practice: ${t.form}. Use it yourself and, from your very first question on, ask things whose natural answer needs it (about ${t.ask}); write the suggestions in it too. A message in another tense, or with this tense formed wrongly, always gets a coach.correction in this tense, never only a tip; when it is right, say so briefly in coach.tip.`);
  }
  // The conversation comes first: words are brought in only where they fit the topic, never
  // by jumping to a new one (that made replies hop from work to politics in one line).
  const stayOnTopic = "Conversation first: follow on from what the learner said and stay on topic. Use a listed word only where it fits naturally; never change topic or ask something unrelated to bring one in (the list stays for the next turns). When a topic runs dry, bridge naturally to one where some fit.";
  if (targetWords.length && learnt) {
    const list = targetWords.map((w) => (w.en ? `${w.de} (${w.en})` : w.de)).join("; ");
    lines.push(`Words the learner knows and should practise saying: ${list}. ${stayOnTopic} You are not limited to them: where one fits, use it or ask a question whose natural answer needs it; never list or quiz them. If the learner's message contains one, praise it briefly in coach.tip, or fix a wrong meaning, article or form in coach.correction.`);
  } else if (targetWords.length) {
    const list = targetWords.map((w) => (w.en ? `${w.de} (${w.en})` : w.de)).join("; ");
    lines.push(`Vocabulary being practised: ${list}. ${stayOnTopic} Where they fit, weave one to three into your reply naturally so the learner can use them too.`);
  }
  // Today's words: the learner has to recall and say them, so the partner asks for them
  // but never says them first (echoing a word just heard doesn't make it stick).
  if (today?.words.length) {
    const fmt = (w) => (w.en ? `${w.de} (${w.en})` : w.de);
    const notYet = today.words.filter((w) => !today.status[w.de]?.correct);
    const said = today.words.filter((w) => today.status[w.de]?.correct);
    const neverSay = "Never say, translate or hint at one the learner hasn't said yet: they must recall it (the app shows its meaning).";
    lines.push(
      `Today's words, to be said until automatic: ${today.words.map(fmt).join("; ")}.`,
      ...(m.drill
        ? [
          today.situation
            ? `Current situation: ${JSON.stringify(today.situation)}. Continue it from where the conversation left off.`
            : "No situation yet: start one.",
          `Ask first for words not said yet${notYet.length ? ` (${notYet.map((w) => w.de).join("; ")})` : ""}, one per step, the one fitting the next moment best. ${neverSay}`,
          // Spelled out: faster models (Groq) otherwise tend to say the word in the question.
          "Most important rule: your reply must NOT contain the word you are asking for, in any form, nor a translation of it, until the learner has said it correctly. Refer to it only as \"das Wort auf deinem Bildschirm\" and describe the moment so that this word is the natural thing to say. Wrong: \"Das Handy sieht schrecklich aus. Sag einen Satz mit diesem Wort.\" Right: \"Das Display ist kaputt und voller Kratzer. Wie findest du das Handy? Nutze das Wort auf deinem Bildschirm.\"",
          ...(said.length ? [`Already said once: ${said.map((w) => w.de).join("; ")}. Bring each back at a later moment needing another form (tense, person), so they build a new sentence.`] : []),
          "If their sentence misses the word asked for or uses it wrongly, ask for it again next turn, still without saying it.",
        ]
        : [
          ...(notYet.length ? [`Not said yet: ${notYet.map((w) => w.de).join("; ")}. Get the learner to say them, one at a time, with a question on the current topic whose natural answer needs one (bridge naturally; never quiz or list). ${neverSay}`] : []),
          ...(said.length ? [`Already said: ${said.map((w) => w.de).join("; ")}. Bring each back later in another form.`] : []),
        ]),
      "next_word: the word from this list (as written) your reply asks for, else empty.",
      ...(learnerMessage ? ["coach.used_words: list every one of today's words that appears in the learner's last message, in any form (write it as in the list), with correct true only if its meaning, form and article are right; empty only if none appears. A wrong use also gets a coach.correction."] : []),
    );
  }
  if (weakSpots.length) {
    const clip = (t) => JSON.stringify(t.length > 120 ? `${t.slice(0, 117)}…` : t);
    const list = weakSpots.map((m) => `${MISTAKE_TYPES[m.type]} (said ${clip(m.example.said)}; correct ${clip(m.example.fix)})`).join("; ");
    lines.push(`Recurring mistakes, most frequent first: ${list}. About every second question, ask something on the current topic whose natural answer needs one of these, in turn; stay natural, never say you're testing, don't explain grammar (the coach corrects).`);
  }
  return lines.join("\n");
}

// The schemas above are in Gemini's format; OpenAI-style APIs want standard JSON Schema.
function toJsonSchema(s) {
  const out = { type: s.type.toLowerCase() };
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toJsonSchema(v)]));
  }
  if (s.items) out.items = toJsonSchema(s.items);
  if (s.enum) out.enum = s.enum;
  if (s.required) out.required = s.required;
  return out;
}

// A turn with every field present and of the right type. Groq and Mistral only promise
// JSON, not this shape: a missing coach or reply used to stop the turn with "Cannot read
// properties of undefined".
function normalizeTurn(raw) {
  const t = raw && typeof raw === "object" ? raw : {};
  const c = t.coach && typeof t.coach === "object" ? t.coach : {};
  const str = (v) => (typeof v === "string" ? v : "");
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    ...t,
    coach: {
      understood: c.understood !== false,
      correction: str(c.correction),
      mistakes: list(c.mistakes).filter((m) => typeof m === "string"),
      tip: str(c.tip),
      used_words: list(c.used_words).filter((u) => u && typeof u === "object"),
    },
    mood: MOODS.includes(t.mood) ? t.mood : "neutral",
    reply: str(t.reply).trim(),
    reply_translation: str(t.reply_translation),
    suggestions: list(t.suggestions).filter((s) => typeof s === "string"),
    rapport_delta: Number.isFinite(t.rapport_delta) ? t.rapport_delta : 0,
    conversation_finished: t.conversation_finished === true,
    next_word: str(t.next_word),
    situation: str(t.situation),
  };
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The model returned an unreadable response. Please try again.");
  }
}

// One request to an OpenAI-compatible chat API (Mistral, Groq). Returns the fetch Response.
// The answer format for chat APIs, which get it as text: the JSON Schema without its
// "required" lists (every field is required, said once instead), which repeated each field
// name on every turn.
function chatSystemContent(systemInstruction, schema) {
  const strip = ({ required, properties, items, ...rest }) => ({
    ...rest,
    ...(properties ? { properties: Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, strip(v)])) } : {}),
    ...(items ? { items: strip(items) } : {}),
  });
  return `${systemInstruction}\n\nAnswer with only a JSON object with every field of this JSON Schema:\n${JSON.stringify(strip(toJsonSchema(schema)))}`;
}

function chatRequest(service, key, { systemInstruction, schema, contents, temperature = 0.8 }, stream = false) {
  const messages = [
    { role: "system", content: chatSystemContent(systemInstruction, schema) },
    ...contents.map((c) => ({
      role: c.role === "model" ? "assistant" : "user",
      content: c.parts.map((p) => p.text).join(""),
    })),
  ];
  return fetch(service.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: service.model,
      messages,
      response_format: { type: "json_object" },
      temperature,
      ...(stream ? { stream: true } : {}),
      ...service.extra,
    }),
  });
}

// Reads a streamed (server-sent events) answer, calling onData with each event's JSON.
async function readSse(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try { onData(JSON.parse(data)); } catch { /* a keep-alive or partial line */ }
    }
  }
}

async function failure(res, serviceName) {
  const data = await res.json().catch(() => ({}));
  const message = data.error?.message ?? data.message ?? data.detail ?? `Request failed (${res.status})`;
  return new Error(`${serviceName ? `${serviceName}: ` : ""}${typeof message === "string" ? message : JSON.stringify(message)}`);
}

async function chatJson(request) {
  const mistralKey = getKey("mistral");
  const groqKey = getKey("groq");
  if (!mistralKey) throw new Error("Add your Mistral API key to start.");
  // With onPartial, Mistral streams its answer so the reply can be voiced before the rest is written.
  const stream = typeof request.onPartial === "function";
  let service = MISTRAL;
  let res = await chatRequest(MISTRAL, mistralKey, request, stream);
  // Mistral's free tier is rate-limited (429) and sometimes overloaded (5xx); Groq takes over.
  if ((res.status === 429 || res.status >= 500) && groqKey) {
    service = GROQ;
    res = await chatRequest(GROQ, groqKey, request);
  }
  if (!res.ok) throw await failure(res, service.name);
  if (stream && service === MISTRAL) {
    let text = "";
    await readSse(res, (event) => {
      const delta = event.choices?.[0]?.delta?.content;
      if (delta) request.onPartial((text += delta));
    });
    return parseModelJson(text);
  }
  const data = await res.json().catch(() => ({}));
  return parseModelJson(data.choices?.[0]?.message?.content ?? "");
}

// Groq as the main service: about a second per reply (measured 1.1–1.5 s for a whole turn),
// so the whole answer is fetched at once. When a key's limit is reached (429), the next
// backup Groq key (other accounts') takes over; when Groq is still busy, Mistral, if it has a key.
const GROQ_BACKUPS = ["groq2", "groq3"];
async function groqJson(request) {
  const groqKey = getKey("groq");
  const mistralKey = getKey("mistral");
  if (!groqKey) throw new Error("Add your Groq API key to start.");
  let service = GROQ;
  let res = await chatRequest(GROQ, groqKey, request);
  for (const [i, backup] of GROQ_BACKUPS.entries()) {
    if (res.status !== 429 || !getKey(backup)) continue;
    debugLog(`Groq key at its limit: using backup key ${i + 1}`);
    res = await chatRequest(GROQ, getKey(backup), request);
  }
  if ((res.status === 429 || res.status >= 500) && mistralKey) {
    service = MISTRAL;
    res = await chatRequest(MISTRAL, mistralKey, request);
  }
  if (!res.ok) throw await failure(res, service.name);
  const data = await res.json().catch(() => ({}));
  return parseModelJson(data.choices?.[0]?.message?.content ?? "");
}

function aiJson(request) {
  const provider = getProvider();
  if (provider === "groq") return groqJson(request);
  return provider === "mistral" ? chatJson(request) : geminiJson(request);
}

async function geminiJson({ systemInstruction, schema, contents, onPartial, temperature = 0.8 }) {
  const key = getKey("gemini");
  if (!key) throw new Error("Add your Gemini API key to start.");
  const stream = typeof onPartial === "function";
  const method = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
  const request = (model) =>
    fetch(`${API_BASE}/${model}:${method}key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature },
      }),
    });
  let res = await request(CONV_MODEL);
  // When one model is overloaded (503) or out of free quota (429), the other usually isn't.
  if (res.status === 503 || res.status === 429) res = await request(CONV_FALLBACK_MODEL);
  if (!res.ok) throw await failure(res);
  const textOf = (data) => data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (stream) {
    let text = "";
    await readSse(res, (event) => {
      const delta = textOf(event);
      if (delta) onPartial((text += delta));
    });
    return parseModelJson(text);
  }
  return parseModelJson(textOf(await res.json().catch(() => ({}))));
}

function historyToContents(history, userText) {
  const contents = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  contents.push({ role: "user", parts: [{ text: userText }] });
  return contents;
}

async function chatTurn(settings, history, message) {
  const mode = MODES[settings.request.mode] ?? MODES.scene;
  const userText = message.trim() || mode.opener;
  const learnt = Boolean(settings.vocab?.learnt);
  const today = todayWords ? { words: todayWords.active, status: todayWords.status, situation: todayWords.situation } : null;
  const todaySet = new Set(today?.words.map((w) => w.de));
  // A drill is only about today's words: no background words to weave in.
  const targetWords = settings.vocab?.enabled && !mode.drill ? nextVocabBatch(learnt ? 8 : 12).filter((w) => !todaySet.has(w.de)) : [];
  const startedAt = performance.now();
  let voiced = false;
  const systemInstruction = turnSystemPrompt(settings.request, targetWords, learnt, message.trim(), recurringMistakes(settings.request.language), today);
  // A drill is short, plain and only needs the last few turns: less to read and write, so
  // replies come sooner, and a low temperature keeps its questions sensible.
  const contents = historyToContents(mode.drill ? history.slice(-DRILL_HISTORY) : history, userText);
  const temperature = mode.drill ? { temperature: 0.4 } : {};
  let turn = normalizeTurn(await aiJson({
    systemInstruction,
    schema: TURN_SCHEMA,
    contents,
    ...temperature,
    // As soon as the reply is written, the voice starts on it while the translation and
    // suggestions are still coming.
    onPartial: (text) => {
      if (voiced) return;
      const mood = partialString(text, "mood");
      const reply = mood === null ? null : partialString(text, "reply");
      if (reply === null) return;
      voiced = true;
      debugLog(`reply written after ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
      prepareVoice(reply, mood);
    },
  }));
  // An answer without a reply is asked for once more rather than shown as an error.
  if (!turn.reply) {
    debugLog("answer had no reply: asking again");
    turn = normalizeTurn(await aiJson({ systemInstruction, schema: TURN_SCHEMA, contents, ...temperature }));
    if (!turn.reply) throw new Error("The AI's answer came back incomplete. Please send that again.");
  }
  debugLog(`whole answer after ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  // A drill reply that says the word it asks for gives the answer away (Groq does this when
  // it asks again), so it is written once more with that pointed out. Costs about a second.
  const asked = mode.drill && today?.words.find((w) => !today.status[w.de]?.correct && isTodayWord(w, turn.next_word));
  if (asked && saysWord(turn.reply, asked.de)) {
    debugLog(`reply said "${asked.de}": asking again`);
    const again = await aiJson({
      systemInstruction: `${systemInstruction}\nYour last draft of this reply contained the word "${asked.de}" itself, which gives the answer away. Write the reply again without that word in any form; refer to it only as "das Wort auf deinem Bildschirm".`,
      schema: TURN_SCHEMA,
      contents,
      temperature: 0.4,
    }).then(normalizeTurn).catch(() => null);
    if (again?.reply && !saysWord(again.reply, asked.de)) turn = again;
    debugLog(`answer after ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  }
  turn.focusWords = targetWords;
  // Suggested answers would give the drill's word away.
  if (mode.drill) turn.suggestions = [];
  // In open modes the conversation never ends on its own.
  if (!mode.endable) turn.conversation_finished = false;
  return { turn, userText };
}

async function wordInfo({ word, sentence, language, nativeLanguage }) {
  return aiJson({
    systemInstruction: `You are a concise ${language} dictionary for a ${nativeLanguage} speaker. Write translations in ${nativeLanguage}.`,
    schema: WORD_SCHEMA,
    contents: [{ role: "user", parts: [{ text: `Explain the word "${word}" as it is used in: "${sentence}"` }] }],
  });
}

// Gemini TTS returns base64 16-bit PCM; decode it into raw bytes.
function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Wrap PCM bytes in a WAV blob URL (fallback path for browsers without Web Audio).
function pcmToWavUrl(pcm, sampleRate = 24000) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  const blockAlign = 2;
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, pcm.length, true);
  const blob = new Blob([header, pcm], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

// The free tier allows only a few TTS requests a day. After a quota error, skip
// Gemini voice until the reset time it reports (e.g. "Please retry in 9h58m15.8s").
function blockGeminiTts(message) {
  const m = /retry in ((?:\d+h)?(?:\d+m)?(?:[\d.]+s)?)/i.exec(message);
  let ms = 60 * 60 * 1000; // no reset time given: try again in an hour
  if (m && m[1]) {
    const part = (unit) => Number(new RegExp(`([\\d.]+)${unit}`).exec(m[1])?.[1] ?? 0);
    ms = ((part("h") * 60 + part("m")) * 60 + part("s")) * 1000 || ms;
  }
  store.set("tts_blocked_until", Date.now() + ms);
}

function geminiTtsBlocked() {
  return Date.now() < store.get("tts_blocked_until", 0);
}

async function geminiTts(text) {
  const key = getKey();
  if (!key) return null;
  const res = await fetch(`${API_BASE}/${TTS_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: TTS_VOICE } } },
      },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 429) blockGeminiTts(data.error?.message ?? "");
    throw new Error(data.error?.message ?? `TTS request failed (${res.status})`);
  }
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  if (!part) throw new Error("TTS returned no audio");
  const rate = /rate=(\d+)/.exec(part.inlineData.mimeType ?? "");
  return { pcm: base64ToBytes(part.inlineData.data), sampleRate: rate ? Number(rate[1]) : 24000 };
}

// ---------- speech recognition (browser) ----------
const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
let recognizer = null;
let dropNextResult = false; // set when listening is cut short on purpose, so its result is ignored
let redoNextResult = false; // set by Delete: what was heard is dropped and the mic listens again

// iOS 17+: route speech like media (plays with the ring switch on silent).
// Listening switches it back to "auto" so the mic still works.
function setAudioSession(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch {
    // unsupported value or browser; the default session still works
  }
}

// Open the page with ?debug to see what the mic does, in a few lines at the bottom left
// (for checking speech recognition on a phone, where there is no console).
const DEBUG = new URLSearchParams(location.search).has("debug");
const debugStart = Date.now();
function debugLog(text) {
  if (!DEBUG) return;
  let box = $("debug-log");
  if (!box) {
    box = document.createElement("pre");
    box.id = "debug-log";
    box.style.cssText = "position:fixed;left:4px;bottom:4px;z-index:9;max-width:75vw;margin:0;padding:6px;"
      + "font:11px/1.3 monospace;background:rgb(0 0 0 / 0.75);color:#9f9;border-radius:6px;pointer-events:none;white-space:pre-wrap";
    document.body.append(box);
  }
  const lines = box.textContent ? box.textContent.split("\n") : [];
  lines.push(`${((Date.now() - debugStart) / 1000).toFixed(1)}s ${text}`);
  box.textContent = lines.slice(-20).join("\n");
}

// What the mic has heard so far, with Edit and Delete while it can still be changed.
function showHeard(text) {
  $("live").textContent = text;
  $("heard").hidden = !text;
}

function startListening() {
  if (!Recognition) {
    setStatus("Voice input needs Chrome or Edge. You can still type.");
    return;
  }
  stopSpeaking();
  setAudioSession("auto");
  recognizer = new Recognition();
  recognizer.lang = state.settings.locale;
  recognizer.interimResults = true;
  // Keep listening through pauses; a longer silence ends the turn.
  recognizer.continuous = true;

  let finalText = "";
  let heard = ""; // final + latest interim text: sent if stopping never turns the tail final
  let silenceTimer = null;
  const armSilence = () => {
    clearTimeout(silenceTimer);
    // Auto-stop after a pause so the turn sends hands-free. You get time to think.
    silenceTimer = setTimeout(() => recognizer?.stop(), SILENCE_MS);
  };

  recognizer.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) finalText += result[0].transcript + " ";
      else interim += result[0].transcript;
    }
    heard = (finalText + interim).trim();
    showHeard(heard);
    // Count the pause from the last words heard, final or not: iPhone marks words final
    // late, which added its own wait on top. Stopping makes the browser finalise them.
    if (heard) armSilence();
  };
  recognizer.onerror = (event) => {
    if (event.error === "no-speech") setStatus("I'm listening… take your time.");
    else if (event.error === "not-allowed") { state.handsFree = false; setStatus("Microphone permission was denied."); }
    else if (event.error !== "aborted") setStatus(`Speech recognition error: ${event.error}`);
  };
  recognizer.onend = () => {
    clearTimeout(silenceTimer);
    debugLog(`mic end, heard "${finalText.trim().slice(0, 40)}"${heard !== finalText.trim() ? " (+ unfinalised tail)" : ""}`);
    recognizer = null;
    setMic(false);
    showHeard("");
    afterListening(heard.length > finalText.trim().length ? heard : finalText.trim());
  };
  if (DEBUG) for (const type of ["audiostart", "soundstart", "speechstart", "audioend"]) recognizer.addEventListener(type, () => debugLog(`mic ${type}`));
  recognizer.start();
  debugLog("mic start");
  setMic(true);
  setStatus("Listening… just talk. Tap the mic to stop hands-free.");
}

// What to do with what was said once listening ends.
function afterListening(spoken) {
  if (dropNextResult) {
    dropNextResult = false; // cut short on purpose (e.g. "Hear it" or Skip in a drill)
    redoNextResult = false;
  } else if (redoNextResult) {
    // Deleted: nothing is sent; hands-free listens again for the new try.
    redoNextResult = false;
    maybeResumeListening();
    setStatus(recognizer ? "Deleted. Say it again." : "Deleted.");
  } else if (state.paused) {
    // Paused mid-sentence: drop it rather than sending half a thought.
  } else if (isPauseCommand(spoken)) {
    setPaused(true, { byVoice: true });
  } else if (state.drill && spoken) {
    // Saying the corrected sentence: check it; hands-free listens again after a miss.
    if (isSkipCommand(spoken)) endDrill();
    else if (!checkDrill(spoken)) maybeResumeListening();
  } else if (spoken) {
    // Hands-free: send straight away. Listening resumes after the reply is spoken.
    sendTurn(spoken);
  } else if (state.handsFree) {
    // Nothing heard but still hands-free (e.g. restarted too soon) — keep listening.
    maybeResumeListening();
  } else {
    setStatus("");
  }
}

// ---------- voice commands: "zwei Minuten" pauses the call, "zurück" / "back" resumes ----------
// Only short utterances count, so "Ich warte zwei Minuten auf den Bus" is still sent normally.
function normalizeSpeech(text) {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\b2\b/g, "zwei").replace(/\s+/g, " ").trim();
}
function isPauseCommand(text) {
  const t = normalizeSpeech(text);
  return t.split(" ").length <= 4 && /\bzwei minuten\b/.test(t);
}
function isResumeCommand(text) {
  const t = normalizeSpeech(text);
  // de-DE recognition may hear the English "back" as "Beck" or "bäck".
  // (\b doesn't treat ü as a letter, so use Unicode-aware word edges.)
  return t.split(" ").length <= 5 && /(?<!\p{L})(zurück|zurueck|back|beck|bäck|bin wieder da)(?!\p{L})/u.test(t);
}

// While paused by voice, keep a quiet listener running that only waits for the resume word.
// Speech recognition stops by itself after a while, so it restarts until the call resumes.
let wakeRecognizer = null;
let wakeEnded = null; // resolves when the wake listener has fully stopped
function startWakeListener() {
  if (!Recognition || wakeRecognizer || !state.paused) return;
  const rec = new Recognition();
  rec.lang = state.settings.locale;
  rec.interimResults = true;
  rec.continuous = true;
  let heardResume = false;
  let denied = false;
  let resolveEnded;
  wakeEnded = new Promise((r) => { resolveEnded = r; });
  rec.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (isResumeCommand(event.results[i][0].transcript)) {
        heardResume = true;
        rec.abort();
        return;
      }
    }
  };
  rec.onerror = (event) => { if (event.error === "not-allowed") denied = true; };
  rec.onend = () => {
    wakeRecognizer = null;
    setAudioSession("auto");
    resolveEnded();
    updateCallState();
    if (heardResume) setPaused(false);
    else if (state.paused && pausedByVoice && !denied) setTimeout(startWakeListener, 300);
  };
  wakeRecognizer = rec;
  setAudioSession("play-and-record");
  try {
    rec.start();
  } catch {
    setAudioSession("auto");
    wakeRecognizer = null;
    resolveEnded();
  }
  updateCallState();
}
function stopWakeListener() {
  if (!wakeRecognizer) return Promise.resolve();
  wakeRecognizer.abort();
  return wakeEnded;
}

function stopListening() {
  state.handsFree = false;
  recognizer?.stop();
  setStatus("Hands-free off.");
  updateCallState();
}

function setMic(on) {
  $("mic").setAttribute("aria-pressed", String(on));
  $("mic").querySelector(".round-label").textContent = on ? "Listening" : "Talk";
  updateCallState();
}

// ---------- speech synthesis with word highlighting ----------
// Apple's Eloquence and novelty voices sound synthetic; Safari sometimes lists them first.
const ROBOTIC_VOICES = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy)\b/;

// Rank voices so the browser's natural/neural voice for the locale wins
// over the default robotic one.
function voiceFor(locale) {
  const voices = speechSynthesis.getVoices();
  const lang = locale.split("-")[0];
  const candidates = voices.filter((v) => v.lang === locale || v.lang.replace("_", "-").startsWith(lang));
  if (candidates.length === 0) return null;

  const score = (v) => {
    let s = 0;
    const name = v.name.toLowerCase();
    if (v.lang === locale || v.lang.replace("_", "-") === locale) s += 40; // exact region
    if (!v.localService) s += 30; // online voices are the high-quality neural ones
    if (/premium/.test(name)) s += 35; // Apple's downloadable top-quality voices
    else if (/enhanced/.test(name)) s += 30;
    if (/(natural|neural|wavenet|siri|multilingual)/.test(name)) s += 25;
    if (/google|microsoft/.test(name)) s += 10;
    if (/compact|espeak|pico/.test(name)) s -= 20; // known robotic engines
    if (ROBOTIC_VOICES.test(name)) s -= 60;
    return s;
  };

  return candidates.slice().sort((a, b) => score(b) - score(a))[0];
}

// Safari loads voices lazily; wait briefly so we don't speak with the default one.
function voicesReady() {
  if (speechSynthesis.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      resolve();
    };
    speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, 1000);
  });
}

let currentAudio = null;
let currentSource = null;
let currentHighlight = null;
let speakToken = 0; // bumps on every speak/stop so a slow TTS reply can't play over a newer one

// A single AudioContext, unlocked on the first user tap. Playing generated audio
// through Web Audio is far more reliable than <audio> in Safari / on iPhone.
let audioCtx = null;
function getAudioCtx() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  return audioCtx;
}

// One shared <audio> element. On iPhone, speech recognition takes over the audio
// session and suspends Web Audio; an element primed inside a tap can still play then.
const player = new Audio();
player.setAttribute("playsinline", "");
let playerPrimed = false;

// Runs inside every user gesture so Safari lets audio play later, after network waits.
let speechPrimed = false;
function unlockAudio() {
  if (!playerPrimed) {
    playerPrimed = true;
    player.src = pcmToWavUrl(new Uint8Array(480)); // 10 ms of silence
    player.play().catch(() => { playerPrimed = false; });
  }
  const ctx = getAudioCtx();
  if (ctx && ctx.state !== "running") {
    ctx.resume().catch(() => {});
    // Safari only truly unlocks once something is started inside the gesture.
    const blip = ctx.createBufferSource();
    blip.buffer = ctx.createBuffer(1, 1, 22050);
    blip.connect(ctx.destination);
    blip.start();
  }
  // Safari's speech synthesis also needs one gesture-initiated utterance.
  if (!speechPrimed && "speechSynthesis" in window) {
    speechPrimed = true;
    speechSynthesis.speak(new SpeechSynthesisUtterance(""));
  }
}
for (const type of ["click", "touchend", "keydown"]) {
  document.addEventListener(type, unlockAudio, { capture: true });
}

// Generated audio by text, so Replay and Listen don't spend another TTS request.
const ttsCache = new Map();
const pendingTts = new Map(); // voice being prepared while the answer streams in, by cache key

// A string field of a JSON object that is still being written, once its closing quote is in.
function partialString(json, field) {
  const m = json.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return null;
  try { return JSON.parse(`"${m[1]}"`); } catch { return null; }
}

const voiceRate = () => (["A1", "A2"].includes(state.settings.level) ? 0.9 : 1);

// Start the on-device voice on a reply before the whole answer is in; speak() picks it up.
function prepareVoice(text, mood) {
  const locale = state.settings.locale;
  const key = `${locale}|${mood}|${text}`;
  if (!hasPiperVoice(locale) || !piperLoaded(locale) || ttsCache.has(key) || pendingTts.has(key)) return;
  const pending = piperSpeak(text, locale, { speed: voiceRate(), mood })
    .then((audio) => {
      rememberTts(key, { audio, note: "" });
      return audio;
    })
    .finally(() => pendingTts.delete(key));
  pending.catch(() => {}); // a failure is handled when speak() makes its own attempt
  pendingTts.set(key, pending);
}
const TTS_CACHE_MAX = 60;
function rememberTts(text, audio) {
  ttsCache.set(text, audio);
  if (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
}

// Get the open-source voice ready in the background (download the first time, then load
// it into memory), showing progress on the setup screen and in the call.
const piperLoads = new Map(); // locale -> Promise
function setVoiceStatus(text) {
  $("voice-status").textContent = text;
  const inCall = !$("conversation").hidden;
  const mine = $("status").textContent.startsWith("Voice:");
  if (inCall && !state.busy && !state.paused && (mine || !$("status").textContent)) setStatus(text);
  else if (!text && mine) setStatus("");
}
function preloadPiper(locale) {
  if (!hasPiperVoice(locale)) return Promise.reject(new Error("no open-source voice for this language"));
  if (piperLoaded(locale)) return loadPiperVoice(locale);
  if (!piperLoads.has(locale)) {
    const mb = (n) => Math.round(n / 1e6);
    setVoiceStatus("Voice: getting ready…");
    const p = loadPiperVoice(locale, (got, total) => {
      setVoiceStatus(`Voice: downloading (one time) ${mb(got)}${total ? ` / ${mb(total)}` : ""} MB…`);
    }).then(
      (voice) => {
        if ($("language").selectedOptions[0]?.dataset.locale === locale || state.settings?.locale === locale) {
          setVoiceStatus("");
          $("voice-status").textContent = "✓ Voice ready";
        }
        return voice;
      },
      (error) => {
        piperLoads.delete(locale); // allow another try later
        setVoiceStatus("Voice: download failed, using a backup voice for now.");
        throw error;
      },
    );
    piperLoads.set(locale, p);
  }
  return piperLoads.get(locale);
}

// Load the voice for the language picked on the setup screen, before the call starts.
function preloadSelectedVoice() {
  const locale = $("language").selectedOptions[0]?.dataset.locale;
  if (!locale) return;
  if (!hasPiperVoice(locale)) {
    $("voice-status").textContent = "";
    return;
  }
  preloadPiper(locale).catch((error) => console.warn("Piper voice failed to load:", error));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Voice order: Piper (open-source, runs on the device, unlimited) → Gemini (small
// daily free quota) → the browser's built-in voice.
async function speak(text, wordSpans, onDone, mood = "neutral") {
  stopSpeaking();
  const token = speakToken;
  const locale = state.settings.locale;
  const rate = voiceRate();
  // Make sure the done callback fires exactly once, whichever path plays.
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (token === speakToken) setSpeaking(false);
    if (typeof onDone === "function") onDone();
  };
  const fallback = (reason) => {
    if (token !== speakToken) return;
    console.warn("Natural voice unavailable, using the browser voice:", reason);
    noteVoice(wordSpans, `Browser voice — ${reason}`);
    setSpeaking(true);
    debugLog("reply → iPhone/browser voice");
    browserSpeak(text, rate, wordSpans, finish);
  };
  const play = (audio, note) => {
    if (token !== speakToken) return; // stopped or superseded while audio was generating
    noteVoice(wordSpans, note);
    setSpeaking(true);
    playCloudAudio(audio.pcm, audio.sampleRate, wordSpans, finish, fallback);
  };
  noteVoice(wordSpans, "");
  setAudioSession("playback");

  const cached = ttsCache.get(`${locale}|${mood}|${text}`);
  if (cached) return play(cached.audio, cached.note);
  // Already being prepared while the answer streamed in: wait for that instead of starting over.
  const pending = pendingTts.get(`${locale}|${mood}|${text}`);
  if (pending) {
    const audio = await pending.catch(() => null);
    if (token !== speakToken) return;
    if (audio) return play(audio, "");
  }

  // 1. Piper, once it's loaded. A reply never waits for a download: until the voice is
  //    ready, it starts loading and this reply uses the next voice. If it's already
  //    downloaded and only loading into memory, give it a moment first.
  let piperNote = "";
  if (hasPiperVoice(locale)) {
    if (!piperLoaded(locale)) {
      const loading = preloadPiper(locale).catch(() => null);
      if (await piperReady(locale)) await Promise.race([loading, sleep(1500)]);
      if (token !== speakToken) return;
    }
    if (piperLoaded(locale)) {
      try {
        const audio = await piperSpeak(text, locale, { speed: rate, mood });
        rememberTts(`${locale}|${mood}|${text}`, { audio, note: "" });
        return play(audio, "");
      } catch (error) {
        console.warn("Piper voice failed:", error);
        piperNote = `open-source voice failed: ${error.message}`;
      }
    } else {
      piperNote = "open-source voice still loading";
    }
  } else {
    piperNote = "no open-source voice for this language";
  }
  if (token !== speakToken) return;

  // 2. Gemini, while the free daily quota lasts.
  let reason = piperNote;
  if (!getKey()) reason += " · no API key";
  else if (geminiTtsBlocked()) reason += " · Gemini voice daily limit reached";
  else {
    try {
      const audio = await geminiTts(text);
      const note = `Gemini voice — ${piperNote}`;
      rememberTts(`${locale}|${mood}|${text}`, { audio, note });
      return play(audio, note);
    } catch (error) {
      if (token !== speakToken) return;
      reason += geminiTtsBlocked() ? " · Gemini voice daily limit reached" : ` · ${error.message}`;
    }
  }

  // 3. The browser's built-in voice.
  fallback(reason);
}

function startHighlight(wordSpans, elapsedFn, duration) {
  if (!wordSpans.length) return null;
  return setInterval(() => {
    const i = Math.min(wordSpans.length - 1, Math.floor((elapsedFn() / duration) * wordSpans.length));
    wordSpans.forEach((span, idx) => span.classList.toggle("speaking", idx === i));
  }, 80);
}

async function playCloudAudio(pcm, sampleRate, wordSpans, onDone, onFail) {
  const token = speakToken;
  const ctx = getAudioCtx();
  if (!ctx) {
    debugLog("reply → <audio> (no Web Audio)");
    playCloudAudioWav(pcm, sampleRate, wordSpans, onDone, onFail);
    return;
  }
  if (ctx.state !== "running") {
    debugLog(`Web Audio is ${ctx.state}, waking it`);
    await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
    if (token !== speakToken) return;
    // A still-suspended context (iPhone after the mic was used) would play silently
    // and never end; try the primed <audio> element instead.
    if (ctx.state !== "running") {
      debugLog(`reply → <audio> (Web Audio still ${ctx.state})`);
      playCloudAudioWav(pcm, sampleRate, wordSpans, onDone, onFail);
      return;
    }
  }
  debugLog("reply → Web Audio");

  // 16-bit little-endian mono PCM -> AudioBuffer.
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const samples = Math.floor(pcm.byteLength / 2);
  const buffer = ctx.createBuffer(1, samples, sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;

  const clear = () => {
    if (currentHighlight) { clearInterval(currentHighlight); currentHighlight = null; }
    wordSpans.forEach((span) => span.classList.remove("speaking"));
  };
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  currentSource = src;
  const startedAt = ctx.currentTime;
  currentHighlight = startHighlight(wordSpans, () => ctx.currentTime - startedAt, buffer.duration);
  src.onended = () => { currentSource = null; clear(); onDone(); };
  try {
    src.start();
  } catch (error) {
    currentSource = null;
    clear();
    onFail(error.message);
  }
}

// Plays through the shared <audio> element, for browsers without Web Audio or
// when the AudioContext is suspended.
function playCloudAudioWav(pcm, sampleRate, wordSpans, onDone, onFail) {
  const url = pcmToWavUrl(pcm, sampleRate);
  const audio = player;
  audio.src = url;
  currentAudio = audio;
  audio.ontimeupdate = () => {
    if (!audio.duration || !wordSpans.length) return;
    const i = Math.min(wordSpans.length - 1, Math.floor((audio.currentTime / audio.duration) * wordSpans.length));
    wordSpans.forEach((span, idx) => span.classList.toggle("speaking", idx === i));
  };
  const clear = () => {
    wordSpans.forEach((span) => span.classList.remove("speaking"));
    URL.revokeObjectURL(url);
  };
  audio.onended = () => { clear(); onDone(); };
  audio.onerror = () => { clear(); onFail("audio could not be played"); };
  audio.play().catch((error) => { clear(); onFail(error.message); });
}

async function browserSpeak(text, rate, wordSpans, onDone) {
  if (!("speechSynthesis" in window)) {
    if (typeof onDone === "function") onDone();
    return;
  }
  const token = speakToken;
  await voicesReady();
  if (token !== speakToken) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = state.settings.locale;
  const voice = voiceFor(state.settings.locale);
  if (voice) utterance.voice = voice;
  utterance.rate = rate;
  utterance.pitch = 1;
  utterance.onboundary = (event) => {
    if (event.name && event.name !== "word") return;
    wordSpans.forEach((span) => span.classList.toggle(
      "speaking",
      event.charIndex >= Number(span.dataset.start) && event.charIndex < Number(span.dataset.end),
    ));
  };
  const clear = () => {
    wordSpans.forEach((span) => span.classList.remove("speaking"));
    if (typeof onDone === "function") onDone();
  };
  utterance.onend = clear;
  utterance.onerror = clear;
  speechSynthesis.speak(utterance);
}

function stopSpeaking() {
  speakToken++;
  setSpeaking(false);
  if (currentHighlight) { clearInterval(currentHighlight); currentHighlight = null; }
  document.querySelectorAll(".word.speaking").forEach((span) => span.classList.remove("speaking"));
  if (currentSource) {
    try { currentSource.onended = null; currentSource.stop(); } catch { /* already stopped */ }
    currentSource = null;
  }
  if (currentAudio) {
    currentAudio.onended = currentAudio.onerror = currentAudio.ontimeupdate = null;
    currentAudio.pause();
    currentAudio = null;
  }
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}

// ---------- transcript rendering ----------
function wordify(container, text, sentence) {
  const spans = [];
  // Split into word and non-word runs while keeping character offsets for TTS boundaries.
  for (const match of text.matchAll(/[\p{L}\p{M}'’-]+|[^\p{L}\p{M}'’-]+/gu)) {
    const chunk = match[0];
    if (/\p{L}/u.test(chunk)) {
      const span = document.createElement("span");
      span.className = "word";
      span.textContent = chunk;
      span.dataset.start = String(match.index);
      span.dataset.end = String(match.index + chunk.length);
      onTap(span, () => openExplorer(chunk, sentence), { selectable: true });
      container.append(span);
      spans.push(span);
    } else {
      container.append(document.createTextNode(chunk));
    }
  }
  return spans;
}

function addCharacterMessage(turn) {
  const li = document.createElement("li");
  li.className = "msg character";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = state.settings.characterName;
  const line = document.createElement("div");
  const spans = wordify(line, turn.reply, turn.reply);

  const translation = document.createElement("div");
  translation.className = "translation";
  translation.textContent = turn.reply_translation;
  translation.hidden = true;

  const tools = document.createElement("div");
  tools.className = "tools";
  const replay = document.createElement("button");
  replay.textContent = "▶ Replay";
  // onTap so these work mid-typing without dropping the keyboard.
  onTap(replay, () => speak(turn.reply, spans, null, turn.mood));
  const translate = document.createElement("button");
  translate.textContent = "Translate";
  onTap(translate, () => {
    translation.hidden = !translation.hidden;
  });
  tools.append(replay, translate);

  li.append(who, line, translation, tools);
  $("transcript").append(li);
  scrollCallToBottom();
  // A reply that arrives while the call is paused is spoken on resume.
  if (state.paused) {
    pendingReply = { text: turn.reply, spans, mood: turn.mood };
    return;
  }
  // When hands-free, start listening again once the character finishes speaking.
  speak(turn.reply, spans, () => maybeResumeListening(), turn.mood);
}

function maybeResumeListening() {
  if (state.handsFree && !state.finished && !state.paused && !recognizer) {
    startListening();
  }
}

function addLearnerMessage(text) {
  const li = document.createElement("li");
  li.className = "msg learner";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = "You";
  li.append(who, document.createTextNode(text));
  $("transcript").append(li);
  scrollCallToBottom();
}

function renderCoach(coach) {
  const box = $("coach");
  box.replaceChildren();
  box.classList.remove("expanded");
  if (!coach.correction && !coach.tip && coach.understood) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.classList.toggle("has-correction", Boolean(coach.correction));
  if (!coach.understood) {
    const p = document.createElement("p");
    p.textContent = "That didn't quite land. Try one of the suggestions below.";
    box.append(p);
  }
  if (coach.correction) {
    const p = document.createElement("p");
    p.innerHTML = "<strong>More natural:</strong> ";
    p.append(document.createTextNode(coach.correction));
    box.append(p);
  }
  if (coach.tip) {
    const p = document.createElement("p");
    p.textContent = coach.tip;
    box.append(p);
  }
}

// Run handler on a tap without taking focus from the text box. A button would otherwise
// blur it, and on phones that drops the keyboard and reflows the dock mid-tap. iOS decides
// that at the touch level, so the tap is handled on touchend with its default prevented
// (which also cancels the synthesized click). A touch that moved is a scroll (of the chip
// row or the transcript) and a long press is text selection, so neither counts as a tap.
// click covers mouse and keyboard activation, unless the button submits the form, whose
// submit handler covers those instead. selectable keeps text selectable with the mouse.
function onTap(el, handler, { click = true, selectable = false } = {}) {
  let start = null;
  if (!selectable) el.addEventListener("mousedown", (event) => event.preventDefault());
  el.addEventListener("touchstart", (event) => {
    const t = event.touches[0];
    start = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, { passive: true });
  el.addEventListener("touchend", (event) => {
    const t = event.changedTouches[0];
    const tap = start && Math.hypot(t.clientX - start.x, t.clientY - start.y) <= 10 && Date.now() - start.at < 500;
    start = null;
    if (!tap) return;
    event.preventDefault();
    handler();
  });
  if (click) el.addEventListener("click", handler);
}

// Put a suggestion into the text box, ready to edit or send, with the caret at the end.
// The keyboard is only kept up if it already was: a suggestion never pops it open.
function useSuggestion(text) {
  const input = $("text");
  input.value = text;
  if (!document.body.classList.contains("typing")) return;
  input.focus();
  try { input.setSelectionRange(text.length, text.length); } catch { /* unsupported */ }
}

function renderSuggestions(suggestions) {
  const box = $("suggestions");
  box.replaceChildren();
  for (const text of suggestions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.textContent = text;
    onTap(chip, () => useSuggestion(text));
    box.append(chip);
  }
}

function renderFocusWords(words) {
  const box = $("focus");
  if (!box) return;
  if (todayWords) {
    renderTodayWords(box);
    return;
  }
  if (!words || !words.length) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.hidden = false;
  box.replaceChildren();
  const label = document.createElement("span");
  label.className = "focus-label";
  label.textContent = state.settings?.vocab?.learnt ? "Your words: " : "Practising: ";
  box.append(label);
  for (const w of words) {
    const chip = document.createElement("span");
    chip.className = "focus-word";
    chip.textContent = w.de;
    chip.title = w.en;
    box.append(chip);
  }
}

// Today's words as their English cue: the learner recalls the German. A tap shows it
// (and counts as a miss); a word used shows ✓ (right) or ! (try again).
function renderTodayWords(box) {
  const { active, status } = todayWords;
  box.hidden = !active.length;
  const label = document.createElement("span");
  label.className = "focus-label";
  label.textContent = "Say: ";
  box.replaceChildren(label);
  // The word being asked for comes first, highlighted, and shows only its cue (even if said
  // before), so it is recalled again rather than read off the chip.
  const current = todayWords.current;
  for (const w of [...active].sort((a, b) => (b.de === current) - (a.de === current))) {
    const s = status[w.de];
    const isCurrent = w.de === current;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "focus-word today" + (s?.correct ? " said" : s?.wrong ? " tried" : "") + (isCurrent ? " current" : "");
    const mark = s?.correct ? "✓ " : s?.wrong ? "! " : "";
    chip.textContent = mark + (s?.peeked || (s?.correct && !isCurrent) ? `${w.en} = ${w.de}` : w.en || w.de);
    chip.title = s?.peeked ? w.de : "Tap to see the German";
    onTap(chip, () => {
      peekTodayWord(w.de);
      renderTodayWords(box);
    });
    box.append(chip);
  }
}

// Small note under a message saying the browser voice played, and why (empty clears it).
function noteVoice(wordSpans, text) {
  const li = wordSpans[0]?.closest("li");
  if (!li) return;
  let note = li.querySelector(".voice-note");
  if (!text) {
    note?.remove();
    return;
  }
  if (!note) {
    note = document.createElement("div");
    note.className = "voice-note";
    li.append(note);
  }
  note.textContent = text;
}

function setStatus(text) {
  $("status").textContent = text;
}

function setBusy(busy) {
  state.busy = busy;
  // Only the buttons are disabled while a reply loads, so a second turn can't be fired
  // mid-reply. The text box stays enabled (and focused) so the keyboard — and the compact
  // typing layout — don't collapse, and the learner can start composing their next turn.
  // It's only locked once the scene is finished or the call is on hold.
  for (const el of $("composer").querySelectorAll("button")) el.disabled = busy || state.finished || state.paused;
  $("text").disabled = state.finished || state.paused;
  updateCallState();
}

// ---------- call screen ----------
// Scroll to the end of the call, but never past the start of the latest reply: with the
// keyboard up there's room for only a few lines, and the question being answered should
// read from its first line rather than be pushed off the top by the coach below it.
function scrollCallToBottom() {
  const box = $("call-scroll");
  requestAnimationFrame(() => {
    let top = box.scrollHeight - box.clientHeight;
    const reply = [...$("transcript").querySelectorAll(".msg.character")].at(-1);
    if (reply) {
      top = Math.min(top, reply.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - 8);
    }
    box.scrollTo({ top, behavior: "smooth" });
  });
}

let voiceEndedAt = 0;
function setSpeaking(on) {
  if (on !== state.speaking) debugLog(on ? "voice playing" : "voice ended");
  if (state.speaking && !on) voiceEndedAt = Date.now();
  state.speaking = on;
  updateCallState();
}

// The pill in the call header: what's happening right now.
function updateCallState() {
  let key = "idle";
  let text = state.handsFree ? "Your turn — just talk" : "Your turn";
  if (state.finished) { key = "ended"; text = "Scene complete"; }
  else if (state.paused) { key = "paused"; text = wakeRecognizer ? "Paused — say “zurück”" : "Paused"; }
  else if (state.busy) { key = "thinking"; text = "Thinking…"; }
  else if (state.speaking) { key = "speaking"; text = "Speaking…"; }
  else if (recognizer) { key = "listening"; text = "Listening…"; }
  else if (state.drill) { key = "drill"; text = "Say it again"; }
  $("conversation").dataset.state = key;
  $("call-state").textContent = text;
}

// Call timer; time spent paused doesn't count.
let callTimer = null;
let callElapsed = 0; // ms counted before the current running stretch
let callRunningSince = 0;
function tickCallTimer() {
  const ms = callElapsed + (callTimer ? Date.now() - callRunningSince : 0);
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mmss = `${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  $("call-timer").textContent = hh ? `${hh}:${mmss}` : mmss;
}
function runCallTimer() {
  if (callTimer) return;
  callRunningSince = Date.now();
  callTimer = setInterval(tickCallTimer, 1000);
  tickCallTimer();
}
function holdCallTimer() {
  if (!callTimer) return;
  callElapsed += Date.now() - callRunningSince;
  clearInterval(callTimer);
  callTimer = null;
  tickCallTimer();
}
function startCallTimer() {
  holdCallTimer();
  callElapsed = 0;
  runCallTimer();
}

// Pause = put the call on hold: stop the voice and the mic, freeze the timer.
// Paused by voice ("zwei Minuten"), the mic keeps listening only for the resume word.
let pendingReply = null; // a reply that arrived while paused, spoken on resume
let resumeHandsFree = false;
let pausedByVoice = false;
function setPaused(paused, { byVoice = false } = {}) {
  if (paused === state.paused) return;
  if (paused) {
    resumeHandsFree = state.handsFree;
    pausedByVoice = byVoice && Boolean(Recognition);
    state.paused = true; // set first so nothing restarts the mic or voice
    if (recognizer) stopListening();
    state.handsFree = false;
    stopSpeaking();
    holdCallTimer();
    setStatus(pausedByVoice
      ? "Call paused. Say “zurück” or “back” when you're ready, or tap Resume."
      : "Call paused. Tap Resume to carry on.");
    if (pausedByVoice) startWakeListener();
  } else {
    state.paused = false;
    pausedByVoice = false;
    runCallTimer();
    setStatus("");
    state.handsFree = resumeHandsFree;
    const reply = pendingReply;
    pendingReply = null;
    // The browser allows one recognizer at a time: let the resume listener stop first.
    stopWakeListener().then(() => {
      if (state.paused) return;
      if (reply) speak(reply.text, reply.spans, () => maybeResumeListening(), reply.mood);
      else maybeResumeListening();
    });
  }
  const btn = $("pause");
  btn.setAttribute("aria-pressed", String(paused));
  btn.title = paused ? "Resume the call" : "Pause the call";
  btn.querySelector(".round-label").textContent = paused ? "Resume" : "Pause";
  $("mic").disabled = paused;
  setBusy(state.busy);
}

function enterCall() {
  const { request, characterName } = state.settings;
  const mode = MODES[request.mode] ?? MODES.scene;
  $("call-avatar").textContent = characterName.split(" ").at(-1).charAt(0); // "Dr. Weber" -> W
  $("call-name").textContent = characterName;
  const tense = TENSES[request.tense];
  $("call-mode").textContent = (mode.usesScene
    ? `${$("scenario").selectedOptions[0].textContent.split(" — ")[0]} · ${request.language}`
    : `${mode.label.split(" — ")[0]} · ${request.language}`) + (tense ? ` · ${tense.short}` : "");
  document.body.classList.add("in-call");
  $("conversation").hidden = false;
  startCallTimer();
  updateCallState();
}

function leaveCall() {
  clearInterval(callTimer);
  callTimer = null;
  document.body.classList.remove("in-call");
  $("conversation").hidden = true;
}

// Keep the call screen pinned to the visible area when the phone keyboard opens.
// The keyboard shrinks the visual viewport and (on iOS) scrolls it, but a position:fixed
// layer stays anchored to the full layout viewport — so without this the dock is left
// stranded at the top with a gap above the keyboard. Size the call to the visible height
// and shift it down by the viewport's scroll offset so it lines up with what's on screen.
if (window.visualViewport) {
  const vv = window.visualViewport;
  const fit = () => {
    const root = document.documentElement.style;
    root.setProperty("--vvh", `${vv.height}px`);
    root.setProperty("--vvtop", `${vv.offsetTop}px`);
  };
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  fit();
}

// ---------- conversation turns ----------
async function sendTurn(message) {
  if (state.busy || state.finished) return;
  if (message) addLearnerMessage(message);
  setBusy(true);
  setStatus(`${state.settings.characterName} is thinking…`);
  const slowHint = setTimeout(() => setStatus("Still thinking… longer replies take a moment."), 6000);
  try {
    const { turn, userText } = await chatTurn(state.settings, state.history, message);
    state.history.push({ role: "user", content: message || userText });
    state.history.push({ role: "assistant", content: turn.reply });

    state.rapport = Math.max(0, state.rapport + Math.max(-2, Math.min(2, turn.rapport_delta)));
    renderStats();
    if (message) {
      recordUsedWords(turn.coach?.used_words);
      renderCoach(turn.coach);
      if (turn.coach?.correction) {
        const types = (turn.coach.mistakes ?? []).filter((t) => MISTAKE_TYPES[t]);
        recordMistakes(state.settings.request.language, types.length ? [...new Set(types)] : ["other"], message, turn.coach.correction);
        renderMistakes();
      }
    }
    // The word the reply asks for: its chip is highlighted.
    if (todayWords) todayWords.current = findTodayWord(turn.next_word)?.de ?? null;
    // The drill's situation is kept here and sent back each turn (only the last few turns
    // are), so the story stays coherent; the header shows it.
    if (todayWords && MODES[state.settings.request.mode]?.drill && turn.situation?.trim()) {
      todayWords.situation = turn.situation.trim().slice(0, 80);
      $("call-mode").textContent = `Sentence drill · ${todayWords.situation}`;
    }
    if (!state.paused) setStatus("");
    // After a correction the reply waits until the learner has said the fix.
    if (message && state.settings.sayAgain && drillable(turn.coach?.correction, message)) startDrill(turn, message);
    else presentReply(turn);
  } catch (error) {
    setStatus(error.message);
  } finally {
    clearTimeout(slowHint);
    setBusy(false);
  }
}

// The character's reply, its suggestions and focus words, and the end of a finished scene.
function presentReply(turn) {
  addCharacterMessage(turn);
  renderSuggestions(turn.suggestions);
  renderFocusWords(turn.focusWords);
  if (turn.conversation_finished) {
    state.finished = true;
    renderSuggestions([]);
    state.handsFree = false;
    setStatus("Scene complete! Tap End to start another.");
    setBusy(false);
  }
}

// ---------- say it again ----------
// After a correction the conversation waits: the learner says the corrected sentence (speech
// recognition checks it), or skips, before the reply comes. Reading a correction is passive;
// saying it is what makes it stick.
const drillWords = (text) => normalizeSpeech(text.replace(/ß/g, "ss")).split(" ").filter(Boolean);

function editDistance(a, b, same = (x, y) => x === y) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (same(a[i - 1], b[j - 1]) ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

// Speech recognition mishears a little, so long words may be one letter off.
const sameWord = (x, y) => x === y || (Math.min(x.length, y.length) >= 6 && editDistance([...x], [...y]) <= 1);
const similarity = (a, b, same = sameWord) => 1 - editDistance(a, b, same) / Math.max(a.length, b.length, 1);

// Worth drilling: a real change from what was said, short enough to say in one go.
function drillable(correction, said) {
  const fix = drillWords(correction ?? "");
  return fix.length > 0 && fix.length <= 30 && fix.join(" ") !== drillWords(said).join(" ");
}

// Did the attempt say the corrected sentence? It must contain, exactly, every word the
// correction changed, be close to the correction (most words, in order; this also catches
// word-order fixes), and be closer to it than to the original mistake word for word (no
// allowance for mishearing there, or "Brüder" would count as the "Bruder" it corrects).
function drillMatch(attempt, target, said) {
  const a = drillWords(attempt);
  const t = drillWords(target);
  const s = drillWords(said);
  const pool = new Map();
  for (const w of s) pool.set(w, (pool.get(w) ?? 0) + 1);
  const changed = t.filter((w) => {
    const n = pool.get(w) ?? 0;
    pool.set(w, n - 1);
    return n <= 0;
  });
  const missing = [...new Set(changed.filter((w) => !a.includes(w)))];
  const close = similarity(a, t);
  return { ok: !missing.length && close >= 0.75 && close > similarity(a, s, (x, y) => x === y), missing };
}

function startDrill(turn, said) {
  state.drill = { target: turn.coach.correction.trim(), said, turn };
  renderSuggestions([]);
  $("drill-target").textContent = state.drill.target;
  $("drill-target").lang = state.settings.locale;
  setDrillFeedback("");
  $("drill").hidden = false;
  updateCallState();
  scrollCallToBottom();
  // Hear it first; hands-free then listens for the attempt.
  speak(state.drill.target, [], () => maybeResumeListening());
}

function setDrillFeedback(text, ok = false) {
  $("drill-feedback").textContent = text;
  $("drill-feedback").classList.toggle("ok", ok);
}

// Returns whether the attempt passed.
function checkDrill(attempt) {
  const d = state.drill;
  const { ok, missing } = drillMatch(attempt, d.target, d.said);
  if (ok) {
    setDrillFeedback(`✓ That's it: “${attempt}”`, true);
    setTimeout(() => { if (state.drill === d) endDrill(); }, 1000);
  } else {
    setDrillFeedback(`Heard “${attempt}”. ${missing.length ? `Listen for: ${missing.join(", ")}. ` : ""}Try again.`);
  }
  return ok;
}

function endDrill() {
  const d = state.drill;
  if (!d) return;
  state.drill = null;
  $("drill").hidden = true;
  if (recognizer) { dropNextResult = true; recognizer.abort(); }
  stopSpeaking();
  updateCallState();
  presentReply(d.turn);
}

function isSkipCommand(text) {
  const t = normalizeSpeech(text);
  return t.split(" ").length <= 3 && /(?<!\p{L})(weiter|überspringen|skip|next)(?!\p{L})/u.test(t);
}

// ---------- word explorer & bookmarks ----------
async function openExplorer(word, sentence) {
  const panel = $("explorer");
  const body = $("explorer-body");
  panel.hidden = false;
  body.textContent = `Looking up “${word}”…`;
  try {
    const info = await wordInfo({
      word,
      sentence,
      language: state.settings.request.language,
      nativeLanguage: state.settings.request.nativeLanguage,
    });
    body.replaceChildren();
    const title = document.createElement("h2");
    title.textContent = `${info.word} — ${info.translation}`;
    const meta = document.createElement("p");
    meta.textContent = `${info.part_of_speech} · say it: ${info.pronunciation}`;
    const example = document.createElement("p");
    example.textContent = `${info.example} (${info.example_translation})`;
    const actions = document.createElement("div");
    actions.className = "tools";
    const listen = document.createElement("button");
    listen.textContent = "▶ Listen";
    onTap(listen, () => speak(info.word, []));
    const save = document.createElement("button");
    save.textContent = "★ Save word";
    onTap(save, () => {
      if (save.disabled) return; // touch events can still reach a disabled button
      saveBookmark(info);
      save.textContent = "Saved";
      save.disabled = true;
    });
    actions.append(listen, save);
    body.append(title, meta, example, actions);
  } catch (error) {
    body.textContent = error.message;
  }
}

// The mistake tracker for the language picked on the setup screen.
function renderMistakes() {
  const language = $("language").value;
  const ranked = rankedMistakes(language);
  const practised = new Set(recurringMistakes(language).map((t) => t.type));
  const list = $("mistakes");
  list.replaceChildren();
  $("reset-mistakes").hidden = !ranked.length;
  $("mistakes-sync").textContent = trainerLink()
    ? "Kept in your Vocab Trainer too, so it follows you to your other devices."
    : "Kept on this device only. Connect your Vocab Trainer above to have it on all your devices.";
  if (!ranked.length) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = `Corrections are sorted here by kind of mistake. The ones you make again and again get practised on purpose in your ${language} conversations.`;
    list.append(li);
    return;
  }
  const clip = (t) => (t.length > 90 ? `${t.slice(0, 87)}…` : t);
  for (const t of ranked) {
    const li = document.createElement("li");
    const name = MISTAKE_TYPES[t.type];
    li.append(`${name[0].toUpperCase()}${name.slice(1)} — ${t.count}×`);
    if (practised.has(t.type)) {
      const tag = document.createElement("span");
      tag.className = "mistake-focus";
      tag.textContent = "being practised";
      li.append(" ", tag);
    }
    const example = document.createElement("div");
    example.className = "muted mistake-example";
    example.textContent = `“${clip(t.example.said)}” → “${clip(t.example.fix)}”`;
    li.append(example);
    list.append(li);
  }
}

$("reset-mistakes").addEventListener("click", () => {
  const language = $("language").value;
  if (!confirm(`Forget your recorded ${language} mistakes?`)) return;
  const log = store.get("mistakes", {});
  delete log[language];
  store.set("mistakes", log);
  // Remembered, so the linked trainer clears it on the other devices too.
  store.set("mistake_resets", { ...store.get("mistake_resets", {}), [language]: Date.now() });
  renderMistakes();
  syncMistakes();
});

function saveBookmark(info) {
  const bookmarks = store.get("bookmarks", []);
  if (!bookmarks.some((b) => b.word === info.word && b.language === state.settings.request.language)) {
    bookmarks.unshift({ word: info.word, translation: info.translation, language: state.settings.request.language });
    store.set("bookmarks", bookmarks.slice(0, 200));
  }
  renderBookmarks();
}

function renderBookmarks() {
  const list = $("bookmarks");
  list.replaceChildren();
  const bookmarks = store.get("bookmarks", []);
  if (bookmarks.length === 0) {
    const li = document.createElement("li");
    li.className = "muted";
    li.textContent = "Tap any word the character says to look it up and save it.";
    list.append(li);
    return;
  }
  for (const b of bookmarks) {
    const li = document.createElement("li");
    li.textContent = `${b.word} — ${b.translation} `;
    const lang = document.createElement("span");
    lang.className = "muted";
    lang.textContent = `(${b.language})`;
    li.append(lang);
    list.append(li);
  }
}

// ---------- wiring ----------

const KEY_INPUTS = { mistral: "mistral-key", groq: "groq-key", groq2: "groq2-key", groq3: "groq3-key", gemini: "api-key" };

// Show only the key fields the chosen AI needs; saved keys show as a placeholder.
function showKeyFields() {
  const provider = $("provider").value;
  for (const el of document.querySelectorAll("#keygate [data-provider]")) {
    el.hidden = !el.dataset.provider.split(" ").includes(provider);
  }
  $("gemini-optional").hidden = provider === "gemini";
  // Mistral and Groq back each other up: the other one's key is optional.
  $("groq-optional").hidden = provider === "groq";
  $("mistral-optional").hidden = provider === "mistral";
  for (const [service, id] of Object.entries(KEY_INPUTS)) {
    $(id).placeholder = getKey(service) ? "Saved — leave blank to keep" : $(id).dataset.placeholder;
  }
}
for (const id of Object.values(KEY_INPUTS)) $(id).dataset.placeholder = $(id).placeholder;
$("provider").addEventListener("change", showKeyFields);

function keySummary() {
  if (getProvider() === "gemini") return "✓ Using Google Gemini.";
  if (getProvider() === "groq") {
    const groqBackups = GROQ_BACKUPS.filter((k) => getKey(k)).length;
    const backups = [groqBackups && (groqBackups === 1 ? "a second Groq key" : `${groqBackups} more Groq keys`), getKey("mistral") && "Mistral"].filter(Boolean);
    return backups.length ? `✓ Using Groq, with ${backups.join(" and ")} as backup.` : "✓ Using Groq.";
  }
  return getKey("groq") ? "✓ Using Mistral, with Groq as backup." : "✓ Using Mistral.";
}

// Show the key box or the setup, depending on whether the chosen AI has a key saved.
function refreshKeyGate() {
  const haveKey = Boolean(getKey(getProvider()));
  $("keygate").hidden = haveKey;
  $("setup").hidden = !haveKey;
  $("key-saved").hidden = !haveKey;
  $("key-summary").textContent = keySummary();
  $("provider").value = getProvider();
  showKeyFields();
}

$("save-key").addEventListener("click", () => {
  const provider = $("provider").value;
  const typed = Object.fromEntries(Object.entries(KEY_INPUTS).map(([service, id]) => [service, $(id).value.trim()]));
  if (!typed[provider] && !getKey(provider)) {
    $("key-status").textContent = `Paste your ${{ mistral: "Mistral", groq: "Groq", gemini: "Gemini" }[provider]} API key first.`;
    return;
  }
  for (const [service, value] of Object.entries(typed)) {
    if (value) setKey(service, value);
    $(KEY_INPUTS[service]).value = "";
  }
  setProvider(provider);
  $("key-status").textContent = "";
  refreshKeyGate();
});

$("change-key").addEventListener("click", () => {
  $("keygate").hidden = false;
  $("setup").hidden = true;
  showKeyFields();
});

$("start").addEventListener("click", async () => {
  const languageSelect = $("language");
  const scenario = $("scenario").value;
  const mode = $("mode").value;
  const usesScene = (MODES[mode] ?? MODES.scene).usesScene;
  const useVocab = $("use-vocab").checked && !$("use-vocab").disabled;
  // Vocab of the chosen level and the ones below it (the list only goes up to B1).
  const VOCAB_LEVELS = ["A1", "A2", "B1"];
  const upTo = VOCAB_LEVELS.indexOf($("level").value);
  const levels = upTo === -1 ? VOCAB_LEVELS : VOCAB_LEVELS.slice(0, upTo + 1);

  let vocab = { enabled: false };
  if (useVocab) {
    // Linked to the trainer: A1/A2 in full plus its learnt B1 words (fetched on page load, so Start never waits).
    const learnt = trainerLink() ? ((await idbGet("learnt_words").catch(() => null)) ?? []) : null;
    const loaded = await loadVocabForSession(levels, learnt);
    vocab = { enabled: loaded > 0, levels, learnt: Boolean(learnt) };
    // Linked: a few learnt words of these levels to say today (see the speaking schedule).
    todayWords = null;
    const drill = Boolean(MODES[mode]?.drill);
    if (learnt) pickTodayWords(learnt.filter((w) => levels.includes(w.level)), { evenIfNotDue: drill });
    // Not linked: the drill takes the imported words of these levels instead.
    else if (drill) pickTodayWords(shuffled(((await idbGet("vocab_words").catch(() => null)) ?? []).filter((w) => levels.includes(w.level))), { evenIfNotDue: true });
  } else {
    todayWords = null;
  }
  if (MODES[mode]?.drill && !todayWords?.active.length) {
    $("vocab-status").textContent = useVocab
      ? "The sentence drill has no words to practise yet: learn some in the Vocab Trainer, or come back when some are due."
      : "The sentence drill practises your vocabulary: tick “Weave my vocab into the conversation” first.";
    $("vocab-status").scrollIntoView({ block: "center", behavior: "smooth" });
    return;
  }

  state.settings = {
    locale: languageSelect.selectedOptions[0].dataset.locale,
    level: $("level").value,
    characterName: usesScene ? (SCENARIOS[scenario] ?? SCENARIOS.cafe).character : PARTNER.character,
    vocab,
    sayAgain: $("say-again").checked,
    request: {
      language: languageSelect.value,
      nativeLanguage: $("native").value,
      level: $("level").value,
      scenario,
      mode,
      tense: $("tense").value,
    },
  };
  bumpStreak();
  renderStats();
  $("setup").hidden = true;
  // Start hands-free, so the mic opens once the opening line is spoken — no tap needed.
  state.handsFree = Boolean(Recognition);
  enterCall();
  // The on-device voice is the default: get it ready while the first reply loads.
  if (hasPiperVoice(state.settings.locale)) {
    preloadPiper(state.settings.locale).catch((error) => console.warn("Piper download failed:", error));
  }
  sendTurn("");
});

// Import a vocab JSON file into the browser (IndexedDB).
$("vocab-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("vocab-status").textContent = "Importing…";
  try {
    const { count, levels } = await importVocab(file);
    $("vocab-status").textContent = `✓ ${count} words imported (${levels.join(", ")}).`;
    refreshVocabUI(count);
  } catch (error) {
    $("vocab-status").textContent = `Import failed: ${error.message}`;
  }
  event.target.value = "";
});

// Load a vocab JSON from a URL.
async function loadVocabUrl(url, { silent } = {}) {
  if (!url) return;
  if (!silent) $("vocab-status").textContent = "Loading from web…";
  try {
    const { count, levels } = await importVocabFromUrl(url);
    $("vocab-status").textContent = `✓ ${count} words loaded (${levels.join(", ")}).`;
    refreshVocabUI(count);
  } catch (error) {
    if (!silent) $("vocab-status").textContent = `Load failed: ${error.message}`;
  }
}

$("load-url").addEventListener("click", () => loadVocabUrl($("vocab-url").value.trim()));

// Fetch the learnt words now and keep them, so they are ready when a conversation starts.
async function refreshLearntWords() {
  if (!trainerLink()) return renderTrainerLink(null);
  $("trainer-status").textContent = "🔗 Linked to your Vocab Trainer · fetching your learnt words…";
  try {
    const words = await fetchLearntWords();
    await idbSet("learnt_words", words);
    renderTrainerLink(higherCount(words));
  } catch (error) {
    const kept = trainerLink() ? higherCount((await idbGet("learnt_words").catch(() => null)) ?? []) : null;
    renderTrainerLink(kept, error.message);
  }
}

function higherCount(words) {
  return words.filter((w) => !KNOWN_LEVELS.includes(w.level)).length;
}

// count: learnt B1 words ready (null when not linked).
function renderTrainerLink(count, problem = "") {
  const linked = Boolean(trainerLink());
  $("trainer-unlink").hidden = !linked;
  $("trainer-form").hidden = linked;
  const text = !linked
    ? "Connect your Vocab Trainer so B1 uses only the words you have learnt there:"
    : `🔗 Linked to your Vocab Trainer · your partner uses all A1 and A2 words plus ${
        count ? `the ${count} B1 words you have learnt there` : "your learnt B1 words (none yet)"}.`;
  $("trainer-status").textContent = problem ? `${problem} ${linked ? text : ""}`.trim() : text;
}

$("trainer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = $("trainer-email").value.trim();
  const password = $("trainer-password").value;
  $("trainer-connect").disabled = true;
  // The free server sleeps when unused and can take a minute to wake up.
  $("trainer-status").textContent = "Connecting… (the Vocab Trainer can take up to a minute to wake up)";
  try {
    await connectTrainer(email, password);
    $("trainer-password").value = "";
    await refreshLearntWords();
    syncMistakes();
    syncSpoken();
    renderMistakes();
  } catch (error) {
    renderTrainerLink(null, error.message === "Failed to fetch" ? "Couldn't reach the Vocab Trainer." : error.message);
  } finally {
    $("trainer-connect").disabled = false;
  }
});

$("trainer-unlink").addEventListener("click", async () => {
  store.set("trainer_link", null);
  await idbSet("learnt_words", []).catch(() => {});
  renderTrainerLink(null);
  renderMistakes();
  refreshVocabUI((await vocabMeta().catch(() => ({ count: 0 }))).count);
});

function refreshVocabUI(count) {
  const useVocab = $("use-vocab");
  const have = count > 0;
  useVocab.disabled = !have;
  if (have && !$("vocab-status").textContent) {
    $("vocab-status").textContent = `✓ ${count} words ready.`;
  }
}

// The scene only matters in scene role-play; grey it out otherwise.
$("mode").addEventListener("change", () => {
  const usesScene = (MODES[$("mode").value] ?? MODES.scene).usesScene;
  $("scenario").disabled = !usesScene;
  $("scenario").closest("label").style.opacity = usesScene ? "1" : "0.5";
});

$("language").addEventListener("change", preloadSelectedVoice);
$("language").addEventListener("change", renderMistakes);
$("say-again").checked = store.get("say_again", true);
$("say-again").addEventListener("change", () => store.set("say_again", $("say-again").checked));

function submitComposer() {
  // A reply is still loading (or the call is finished/on hold): keep what's typed.
  if (state.busy || state.finished || state.paused) return;
  const text = $("text").value.trim();
  if (!text) return;
  $("text").value = "";
  if (state.drill) {
    checkDrill(text); // typing the corrected sentence also counts
    return;
  }
  if (isPauseCommand(text)) {
    setPaused(true);
    return;
  }
  stopSpeaking();
  sendTurn(text);
}

// Submitting via Enter or the native button click (desktop).
$("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  submitComposer();
});

// On phones the on-screen keyboard covers half the screen, so while the text box is
// focused mark the body "typing": the CSS then folds away the big round call controls
// and the vocab row, leaving the input and transcript usable. Keep the latest message
// in view above the keyboard. The layout only goes back once the box has stayed blurred
// for a moment, so a brief blur during a tap can't reflow the dock and move the Send
// button out from under the finger.
let typingTimer = null;
$("text").addEventListener("focus", () => {
  clearTimeout(typingTimer);
  document.body.classList.add("typing");
  scrollCallToBottom();
});
$("text").addEventListener("blur", () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (document.activeElement !== $("text")) document.body.classList.remove("typing");
  }, 300);
});

// Send without dropping the keyboard (see onTap), so you can type the next turn straight
// away. If the browser blurred the box anyway, focusing it again inside the tap keeps
// the keyboard up. Mouse clicks and Enter go through the form's submit handler.
onTap($("composer").querySelector("button[type='submit']"), () => {
  const keepKeyboard = document.body.classList.contains("typing");
  submitComposer();
  if (keepKeyboard) $("text").focus();
}, { click: false });

$("mic").addEventListener("click", () => {
  if (state.handsFree || $("mic").getAttribute("aria-pressed") === "true") {
    stopListening();
  } else {
    state.handsFree = true; // hands-free loop: talk, auto-send on pause, resume after each reply
    startListening();
  }
});

$("pause").addEventListener("click", () => setPaused(!state.paused));

// While typing on a phone the coach shows only its first two lines (CSS); tap it for the rest.
onTap($("coach"), () => {
  $("coach").classList.toggle("expanded");
  $("coach").scrollIntoView({ block: "nearest", behavior: "smooth" });
}, { selectable: true });

// Say-it-again panel: speak the correction (or type it), hear it again, or move on.
onTap($("drill-say"), () => {
  if (!state.drill || recognizer) return;
  $("text").blur(); // speaking, not typing: let the keyboard go
  setDrillFeedback("");
  startListening();
});
onTap($("drill-hear"), () => {
  if (!state.drill) return;
  if (recognizer) { dropNextResult = true; recognizer.abort(); }
  speak(state.drill.target, [], () => maybeResumeListening());
});
onTap($("drill-skip"), () => endDrill());

// Before what was heard is sent (it goes after the pause): fix it in the text box, or drop it
// and say it again.
onTap($("heard-edit"), () => {
  if (!recognizer) return;
  const text = $("live").textContent;
  dropNextResult = true; // the text box has it now: stop the mic without sending
  recognizer.abort();
  showHeard("");
  // Focused inside the tap, so the phone keyboard opens.
  const input = $("text");
  input.value = text;
  input.focus();
  try { input.setSelectionRange(text.length, text.length); } catch { /* unsupported */ }
  setStatus("Fix it, then tap Send.");
});
onTap($("heard-delete"), () => {
  if (!recognizer) return;
  redoNextResult = true;
  recognizer.abort();
  showHeard("");
});

onTap($("explorer-close"), () => {
  $("explorer").hidden = true;
});

// Quit the current conversation and return to the start screen.
$("end").addEventListener("click", () => {
  stopListening();
  stopSpeaking();
  state.history = [];
  state.drill = null;
  $("drill").hidden = true;
  state.rapport = 0;
  state.finished = false;
  state.handsFree = false;
  pendingReply = null;
  resumeHandsFree = false;
  setPaused(false);
  $("transcript").replaceChildren();
  $("coach").hidden = true;
  $("suggestions").replaceChildren();
  showHeard("");
  $("text").value = "";
  setStatus("");
  renderStats();
  renderRecap();
  todayWords = null;
  renderFocusWords([]);
  setBusy(false);
  leaveCall();
  $("setup").hidden = false;
  syncMistakes(); // the call is over: send its mistakes
  syncSpoken();
});

// Voices load asynchronously in Chrome.
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

// With ?debug: which build this phone runs (a cached old one would explain old behaviour).
debugLog(`Talkloop v42 · speech recognition ${Recognition ? "yes" : "no"}`);
refreshKeyGate();
renderStats();
renderBookmarks();
renderMistakes();
// Get the voice ready while the learner picks their settings, so the first reply doesn't wait.
preloadSelectedVoice();
// Show any already-imported vocab; if none, fetch the default URL in the background.
// Then the learnt words from the Vocab Trainer, if linked (or just linked via the URL).
takeTrainerLinkFromUrl();
vocabMeta()
  .then((m) => {
    refreshVocabUI(m.count);
    if (m.count === 0) loadVocabUrl(DEFAULT_VOCAB_URL, { silent: true });
  })
  .catch(() => {})
  .finally(async () => {
    await linkFromTrainerSession().catch(() => false);
    refreshLearntWords();
    syncMistakes();
    syncSpoken();
  });
// Leaving the page (closing the tab, switching apps) sends what this device recorded.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    syncMistakes({ keepalive: true });
    syncSpoken({ keepalive: true });
  }
});
