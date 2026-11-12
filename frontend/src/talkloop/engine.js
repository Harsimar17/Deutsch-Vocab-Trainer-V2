// Talkloop client: speech in, AI character turn out, spoken back with word highlighting.
import { hasPiperVoice, piperLoaded, piperReady, loadPiperVoice, piperSpeak, MOODS } from "@static/talkloop/piper.js";
import { ui, addMessage, updateMessage, clearTranscript, WordTrack, NO_WORDS, refs } from "./ui.js";
import { LANGUAGES, SCENE_OPTIONS, PROVIDERS } from "./options.js";

// The locale of the language picked on the setup screen.
const selectedLocale = () => LANGUAGES.find((l) => l.value === ui.get().form.language)?.locale;

const state = {
  settings: null,
  history: [],
  rapport: 0,
  busy: false,
  finished: false,
  autoSend: true, // per chat: true sends what you said after a pause; false collects it in the text box until you tap Send
  handsFree: false, // when true, the mic listens, auto-sends on a pause, and resumes after each reply
  speaking: false,
  paused: false, // call on hold: no voice, no mic, timer stopped
  drill: null, // { target, said, turn } while the learner says a correction again before the reply
};

let live = null; // the running live call (see startLive): { ws, stream, tap, ready, muted, heard, reply, sources, … }
let liveWorkletCtx = null; // the audio context the live call's mic worklet was added to

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
  ui.merge("stats", { streak: store.get("streak", { count: 0 }).count, rapport: state.rapport });
}

// ---------- AI services (called directly from the browser with the user's own keys) ----------
// Conversation runs on Groq (with Mistral as a backup when Groq is busy), OpenAI, Cloudflare
// or Gemini. Gemini is also the backup voice when Piper can't speak.
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

// OpenAI (GPT-6 Luna by default; another model ID can be typed in with the key). Its newer
// models only take the default temperature, so none is sent.
const OPENAI_DEFAULT_MODEL = "gpt-6-luna";
const OPENAI = {
  name: "OpenAI",
  url: "https://api.openai.com/v1/chat/completions",
  get model() { return store.get("openai_model", "") || OPENAI_DEFAULT_MODEL; },
  noTemperature: true,
};

// AI keys live only in memory. The Vocab Trainer hands them over with the link on every page
// load (serverKeys, from its environment); one typed in lasts only until the page closes.
// None is ever written to localStorage.
let serverKeys = {};
const memoryKeys = {};
const KEY_SERVICES = ["openai", "mistral", "groq", "groq2", "groq3", "cfAccount", "cfToken", "gemini", "gemini2", "geminiLive"];
// Keys an older Talkloop saved in this browser: used for now, moved into the learner's
// account once linked (moveBrowserKeysToAccount), and only then wiped from the browser.
try {
  for (const s of KEY_SERVICES) {
    const k = localStorage.getItem(`${s}_key`);
    if (k) memoryKeys[s] = k;
  }
} catch { /* storage blocked */ }
function forgetBrowserKeys() {
  try { for (const s of KEY_SERVICES) localStorage.removeItem(`${s}_key`); } catch { /* storage blocked */ }
}
// Saves the old browser keys the account doesn't have yet, then wipes them from the browser.
async function moveBrowserKeysToAccount() {
  const missing = Object.fromEntries(Object.entries(memoryKeys).filter(([s, k]) => KEY_SERVICES.includes(s) && k && !serverKeys[s]));
  if (Object.keys(missing).length) await saveKeysToAccount(missing);
  forgetBrowserKeys();
}
function getKey(service = "gemini") {
  return serverKeys[service] || memoryKeys[service] || "";
}
const hasServerKeys = () => Object.keys(serverKeys).length > 0;

// Which service runs the conversation. People who only ever saved a Gemini key stay on Gemini;
// Mistral is no longer a choice of its own, so it moves to Groq (its backup stays).
function getProvider() {
  let saved = "";
  try {
    saved = localStorage.getItem("talkloop_provider") || "";
  } catch {
    saved = memoryKeys.provider || "";
  }
  const providers = ["groq", "gemini", "openai", "cloudflare"];
  // The saved choice, unless it has no key while another one does.
  if (providers.includes(saved) && (providerReady(saved) || !providers.some((p) => providerReady(p)))) return saved;
  return providers.find((p) => providerReady(p)) ?? "groq";
}
// Whether the chosen service has what it needs: one key, or Cloudflare's account ID and token.
function providerReady(provider = getProvider()) {
  return provider === "cloudflare" ? Boolean(getKey("cfAccount") && getKey("cfToken")) : Boolean(getKey(provider));
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

// Topics for "Discuss a topic": each has two sides, so there is something to have an opinion
// on and give reasons for. A1/A2 get everyday choices; B1 and up also get bigger questions.
const TOPICS = {
  easy: [
    "Lieber Kaffee oder lieber Tee?",
    "Wohnen in der Stadt oder auf dem Land",
    "Sommer oder Winter: Welche Jahreszeit ist besser?",
    "Hund oder Katze als Haustier",
    "Mit dem Auto oder mit dem Fahrrad zur Arbeit",
    "Zu Hause kochen oder im Restaurant essen",
    "Urlaub am Meer oder in den Bergen",
    "Früh aufstehen oder lange schlafen",
    "Allein wohnen oder in einer WG",
    "Ein Buch lesen oder einen Film sehen",
  ],
  harder: [
    "Homeoffice oder Büro: Was ist besser?",
    "Sind soziale Medien gut oder schlecht für Freundschaften?",
    "Sollten Kinder schon in der Grundschule ein Handy haben?",
    "Fleisch essen oder vegetarisch leben",
    "Sollte man Autos in der Innenstadt verbieten?",
    "Online einkaufen oder im Laden?",
    "Wie lernt man eine Fremdsprache am besten?",
    "Macht Geld glücklich?",
    "Eine Vier-Tage-Woche: eine gute Idee?",
    "Reisen mit dem Flugzeug oder mit dem Zug",
  ],
};

// Role cards for "Rollenkarte": the learner plays someone else, so there is always something to
// say and no "I don't know". A card is put together at random from these facts.
const ROLE_CARD = {
  names: ["Lukas", "Anna", "Jonas", "Lena", "Felix", "Mia", "David", "Sara", "Tim", "Julia"],
  jobs: ["a cook in a restaurant", "a nurse in a hospital", "a bus driver", "a primary school teacher", "IT support at a bank", "a baker", "a hairdresser", "an architecture student", "a police officer", "a salesperson in a bike shop"],
  cities: ["Hamburg", "Munich", "Berlin", "Cologne", "Leipzig", "Freiburg", "Dresden", "Bremen"],
  homes: ["lives alone in a small flat", "lives in a shared flat with two friends", "lives with their partner and a cat", "still lives with their parents", "has a house with a garden and two children"],
  hobbies: ["plays the guitar", "goes running every morning", "cooks for friends at weekends", "plays football in a club", "reads crime novels", "takes photos of the city", "goes hiking in the mountains", "plays video games", "is learning Spanish", "goes swimming twice a week"],
  events: ["was on holiday in Italy last summer", "moved to a new flat last month", "had a big birthday party last weekend", "started a new job two weeks ago", "broke their arm skiing last winter", "won a cooking competition last year", "got a dog in the spring"],
  plans: ["wants to visit Japan next year", "dreams of opening their own café", "is saving for a car", "wants to run a marathon", "plans to learn to sail", "wants to move to the countryside"],
};
// Each part is picked from those not on the last few cards (on any device), so cards don't repeat.
function makeRoleCard() {
  const recent = recentlyUsed("role-cards", 6);
  const pick = (list, not = []) => {
    const fresh = list.filter((x) => !not.includes(x) && !recent.some((card) => card.includes(x)));
    const from = fresh.length ? fresh : list.filter((x) => !not.includes(x));
    return from[Math.floor(Math.random() * from.length)];
  };
  const c = ROLE_CARD;
  const first = pick(c.hobbies);
  const second = pick(c.hobbies, [first]);
  const age = 20 + Math.floor(Math.random() * 40);
  const card = `${pick(c.names)}, ${age}, ${pick(c.jobs)} in ${pick(c.cities)}; ${pick(c.homes)}; ${first} and ${second}; ${pick(c.events)}; ${pick(c.plans)}`;
  noteUsed("role-cards", card);
  return card;
}

// "Discuss a topic" kept asking the same question (and drifted to other subjects) because the
// AI had nothing but the chat to go by. So each turn it is told the topic again, shown the
// questions it already asked, and given a new angle on the topic to ask about.
const TOPIC_ANGLES = [
  "the learner's own experience with it",
  "one concrete advantage, with an example",
  "one concrete disadvantage or risk",
  // Only angles anyone can answer from their own life: "another country or years ago" and
  // "the opposite view" asked for things learners often don't know.
  "which option the learner would choose for themselves, and why",
  "whether the learner agrees with your opinion, and why",
  "what the learner would do or advise a friend in a specific situation",
  "how it affects the learner's daily life or the people around them",
  "what the learner would change about it if they could",
];
function topicHints(history, topic = "") {
  const replies = history.filter((m) => m.role === "assistant").map((m) => m.content);
  // The last question of each of the last few replies.
  const asked = replies.slice(-6).map((r) => (r.match(/[^.!?]*\?/g) ?? []).pop()?.trim()).filter(Boolean);
  // The opening turn has its own instructions; the angles start with the second.
  return { topic, asked, angle: replies.length ? TOPIC_ANGLES[replies.length % TOPIC_ANGLES.length] : null };
}

// A word already asked about in this chat without the learner saying it rests for a few turns
// and is asked about once more at most: asking again at once is what made the same question
// come back whatever the learner answered. `asked` maps a word to the turns that asked for it.
function wordResting(asked, de, turn) {
  const turns = asked?.[de] ?? [];
  return turns.length >= 2 || (turns.length === 1 && turn - turns[0] < 5);
}

// A random topic for the level that the learner hasn't had yet: `recent` lists the topics
// of earlier chats, newest first. Once every topic has been used, one of those used longest ago.
function pickTopic(level, recent = []) {
  const pool = ["A1", "A2"].includes(level) ? TOPICS.easy : [...TOPICS.harder, ...TOPICS.easy.slice(0, 3)];
  const used = Array.isArray(recent) ? recent : [recent].filter(Boolean);
  const fresh = pool.filter((t) => !used.includes(t));
  if (fresh.length) return fresh[Math.floor(Math.random() * fresh.length)];
  return leastRecentFirst(pool, (t) => used.indexOf(t))[0];
}

// Free chat and interview open with "an easy question", and the AI's easy question is nearly
// always about free time or the weekend. So "Mein Leben" (and "Erzähl mal") starts from a theme
// the app picks, one about the learner's own life that takes a lot to tell, and the partner is
// told which theme comes next when a subject runs dry. `name` is also the chat's subject.
const THEMES = {
  talk: [
    { name: "your hometown", ask: "the town or city where they grew up: what it is like, what people do there, what they miss and what has changed" },
    { name: "yesterday in detail", ask: "what they did yesterday, from getting up to going to bed, with the small details" },
    { name: "your work or studies", ask: "what they actually do all day at work or in their studies, what they like about it and what annoys them" },
    { name: "your family", ask: "the people in their family: who they are, what they do, who they are closest to, how they spend time together" },
    { name: "food from your country", ask: "a dish from where they come from: what is in it, how it is made, when people eat it" },
    { name: "learning german", ask: "why they learn German, how they learn it, what is hard, and a funny mistake they have made" },
    { name: "your home", ask: "where they live: the rooms, their favourite place in it, the neighbours, what they would change" },
    { name: "your best friend", ask: "their best friend: how they met, what this person is like, what they do together" },
    { name: "your childhood", ask: "what they were like as a child: where they lived, what they played, what school was like" },
    { name: "your city now", ask: "the place they live now: what they like and don't like, how they get around, which place they would show a visitor" },
    { name: "shopping and money", ask: "how they shop for food and clothes: where, what is expensive, how they save money" },
    { name: "health and sleep", ask: "how they stay healthy: sleep, sport, food, what they do when they are ill" },
    { name: "festivals and traditions", ask: "a festival or tradition from their culture: what happens, what people eat, how their family celebrates it" },
    { name: "plans for the future", ask: "where they want to be in five years: work, home, family, a dream they have" },
    { name: "your last trip", ask: "their last trip: where they went, with whom, what they did, what went well or wrong" },
    { name: "phone and internet", ask: "how they use their phone: which apps, how many hours, what they read or watch, whether it is too much" },
    { name: "cooking at home", ask: "what they cook at home, what they cook well, and one recipe step by step" },
    { name: "getting around", ask: "how they get to work or around town, how long it takes, what happens on the way" },
    { name: "habits", ask: "a habit they are proud of and one they would like to change, and why" },
    { name: "a perfect day", ask: "what their perfect day would look like, from morning to night" },
    { name: "a big decision", ask: "a big decision in their life (a move, a job, studies): why they made it, how it went, whether they would do it again" },
    { name: "a person you admire", ask: "a person they admire, from their life or not: who it is and why" },
    { name: "life in germany", ask: "what surprises them about Germany or German people, what they like and what they find strange" },
    { name: "your daily routine", ask: "a normal workday for them, step by step, and how a good day differs from a bad one" },
  ],
  // "Erzähl mal": real stories from the learner's life, told in the past.
  story: [
    { name: "something went wrong", ask: "the last time something went really wrong" },
    { name: "first day somewhere new", ask: "their first day at a new job, school or course" },
    { name: "an unforgettable trip", ask: "a trip they will never forget" },
    { name: "getting lost", ask: "a time they got lost or missed a train, bus or flight" },
    { name: "a memorable meal", ask: "the best (or worst) meal they ever had" },
    { name: "helping someone", ask: "a time they helped someone, or someone helped them" },
    { name: "a funny misunderstanding", ask: "a funny misunderstanding, maybe because of a language" },
    { name: "meeting a friend", ask: "how they met their best friend or partner" },
    { name: "a perfect day remembered", ask: "a day when everything went right" },
    { name: "a big surprise", ask: "the last time they were really surprised" },
    { name: "a childhood memory", ask: "a memory from their childhood that they still think about" },
    { name: "moving house", ask: "a move to a new flat, city or country" },
    { name: "a celebration", ask: "a birthday, wedding or festival they remember well" },
    { name: "a scary moment", ask: "a time they were really scared" },
    { name: "a problem solved", ask: "a problem with a shop, an office or a landlord, and how it ended" },
    { name: "a proud moment", ask: "a moment they were really proud of" },
    { name: "an embarrassing moment", ask: "a slightly embarrassing moment they can laugh about now" },
    { name: "a lucky day", ask: "a time they were very lucky" },
  ],
};
const themeByName = (name) => [...THEMES.talk, ...THEMES.story].find((t) => t.name === name);

// The chat's themes in the order to bring them up: ones not had lately first, shuffled.
// `used` lists the subjects of earlier chats, newest first.
// Once every theme has been had, the ones had longest ago come first (a few of the oldest
// shuffled), not a random one: that brought back a theme from the last chat or two.
function pickThemes(pool, used = []) {
  const shuffle = (list) => list.map((t) => [Math.random(), t]).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  const fresh = shuffle(pool.filter((t) => !used.includes(t.name)));
  const had = leastRecentFirst(pool.filter((t) => used.includes(t.name)), (t) => used.indexOf(t.name));
  return [...fresh, ...had].map((t) => t.name);
}

// Items already had, the one had longest ago first: `age` is its place in a newest-first list.
// The oldest three are shuffled, so the order isn't the same every time.
function leastRecentFirst(items, age) {
  const sorted = [...items].sort((a, b) => age(b) - age(a));
  const head = sorted.slice(0, 3).map((t) => [Math.random(), t]).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
  return [...head, ...sorted.slice(3)];
}

// Conversation modes. Open modes never end on their own — they run until you quit.
const MODES = {
  lead: {
    label: "Free chat — the partner leads",
    usesScene: false,
    endable: false,
    subjects: true, // saved as a chat; the subjects talked about aren't brought up again (see subjectHints)
    opener: "(Start the conversation. Greet the learner warmly and ask one easy opening question.)",
    extra: "You lead the whole conversation. Always finish your reply with a question that keeps it going. Follow up on what the learner says, gently change topic when one runs dry, and keep it light and encouraging. Never end the conversation: always set conversation_finished to false.",
  },
  interview: {
    label: "Interview me",
    usesScene: false,
    endable: false,
    subjects: true,
    opener: "(Greet the learner and ask their name or how their day is going.)",
    extra: "Interview the learner about their life, day, hobbies, work and opinions. Ask one question at a time, react to the answer, then ask a natural follow-up. Never end: always set conversation_finished to false.",
  },
  life: {
    label: "Mein Leben — talk about my life",
    usesScene: false,
    endable: false,
    subjects: true,
    themes: "talk", // starts on a theme the app picks, and moves on to the next one (see pickThemes)
    opener: (theme) => `(Greet the learner in one short line, then ask an open question about ${theme.ask}. No small talk about the weather, free time or the weekend.)`,
    extra: "Get the learner talking about their own life, like a curious friend. Ask one question at a time, react to the answer, then dig deeper with a natural follow-up before moving on; now and then add a short line about yourself. Never end: always set conversation_finished to false.",
  },
  story: {
    label: "Erzähl mal — tell a story",
    usesScene: false,
    endable: false,
    subjects: true,
    themes: "story",
    opener: (theme) => `(Greet the learner in one short line, then ask them to tell you about ${theme.ask}.)`,
    extra: "The learner tells real stories from their own life and you are the curious listener. Take one story at a time and get it out of them piece by piece: when and where it happened, who was there, what happened first, then, and in the end, and how they felt. React like a friend (Echt? Und dann?) in one or two short sentences, so they do the talking. Get them to tell it in the past (Perfekt, and war, hatte) with words like zuerst, dann, plötzlich, am Ende, als and weil. Once a story is told (about six exchanges), say in a few words what you liked about it and ask for the next one. If they have no story like that, offer a small variation they might have. Never end: always set conversation_finished to false.",
  },
  topic: {
    label: "Discuss a topic",
    usesScene: false,
    endable: false,
    topics: true, // the app picks the topic (see pickTopic): left to itself the AI chose weather and picnics
    opener: (topic) => `(Today's topic: "${topic}". In one or two short sentences, name this topic and give your own opinion on it, then ask the learner what they think and why. Go straight to the topic: no weather, no greeting chat, no plans of your own.)`,
    extra: "You and the learner are discussing one topic, like two people with different opinions: the topic is named in the first message. Stay on it. Each turn: react to what the learner said, add a short opinion, reason or example of your own, then ask one easy question on this turn's angle that they can answer from their own life or taste; if they don't know, offer two options to pick from. Keep the opinion you gave in your first message: you may add to it or soften it, but never switch to the other side. Where the learner holds the other view, disagree politely, so they have to defend it. Don't change to small talk or another topic until this one is clearly used up (about eight exchanges); then say so in a few words and name a new topic the same way. Never end: always set conversation_finished to false.",
  },
  // Fluency without having to think up content: the app gives what to say, the learner says it.
  interpret: {
    label: "Dolmetscher — say it in German",
    usesScene: false,
    endable: false,
    interpreter: true, // the sentence to say comes in turn.situation and shows above the chips
    opener: "(Start the interpreter drill: say in one short sentence that you will give the learner everyday sentences to say, then put the first one in situation.)",
    extra: "This is an interpreter drill: each turn you give one everyday sentence for the learner to say, and check their version. Keep your own reply very short, so they do the talking. Never end: always set conversation_finished to false.",
  },
  // The trainer's Connectors tab, spoken: two short sentences to join with a connector
  // (static/data/connectors.json), the word order checked each time.
  connectors: {
    label: "Konnektoren — join two sentences",
    usesScene: false,
    endable: false,
    joiner: true, // the two sentences to join come in turn.situation and show above the chips
    opener: "(Start the connector drill: say in one short sentence that the learner will join two sentences with a connector, then put the first pair in situation.)",
    extra: "This is a connector drill: each turn you give two short sentences for the learner to join into one with a given connector, and check their sentence, above all its word order. Keep your own reply very short, so they do the talking. Never end: always set conversation_finished to false.",
  },
  rolecard: {
    label: "Rollenkarte — play a character",
    usesScene: false,
    endable: false,
    roleCard: true, // the card is made when the call starts and shown in the header
    opener: "(The learner plays the character on their role card. Greet them warmly and ask their name.)",
    extra: "Interview the learner, who plays the character on their role card. Ask one question at a time about one detail of the card, in a natural order, react briefly, and ask small follow-ups; they may invent extra details that fit the card. If an answer contradicts the card, point it out kindly. Never end: always set conversation_finished to false.",
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
  // Büro: the learner works; now and then a colleague drops by for a short real conversation
  // (always a Gemini Live call, connected only for the visit: see officeVisit).
  office: {
    label: "Büro — colleagues drop by while I work",
    usesScene: false,
    endable: false,
    office: true,
    opener: "(Walk over to the learner's desk and start talking.)",
    extra: "",
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

// ---------- the trainer's login ----------
// Talkloop opens only for a learner logged in to the Vocab Trainer. It is the same site, so
// the trainer's login is right here: on every load it is renewed (it ends after a day without
// use) and swapped for a fresh link, so there is no password to type and no link to run out.
const TRAINER_SESSION_KEY = "wortschatz.session";

// The trainer's login, or null when there is none or it has expired.
function trainerSession() {
  try {
    const session = JSON.parse(localStorage.getItem(TRAINER_SESSION_KEY));
    const payload = JSON.parse(atob(session.token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.exp * 1000 > Date.now() ? session : null;
  } catch {
    return null;
  }
}

// The trainer's login screen, which comes back here once logged in.
// Talkloop is part of the Vocab Trainer app: without a login it shows the app's login screen,
// which brings the learner back here (see setLoggedOutHandler).
let onLoggedOut = () => location.replace("/#talkloop");
export function setLoggedOutHandler(fn) { onLoggedOut = fn; }
function goToLogin() {
  try { localStorage.removeItem(TRAINER_SESSION_KEY); } catch { /* storage blocked */ }
  onLoggedOut();
}

async function linkFromTrainerSession() {
  const session = trainerSession();
  if (!session) return goToLogin();
  const api = store.get("trainer_api", TRAINER_API).replace(/\/+$/, "");
  // Offline or the free server asleep: the link from last time still works.
  const res = await fetch(`${api}/api/talkloop/link`, { method: "POST", headers: { Authorization: `Bearer ${session.token}` } });
  if (res.status === 401) return goToLogin(); // the trainer no longer knows this login
  if (!res.ok) return;
  const renewed = res.headers.get("X-Auth-Token");
  if (renewed) localStorage.setItem(TRAINER_SESSION_KEY, JSON.stringify({ ...session, token: renewed }));
  store.set("trainer_link", { token: (await res.json()).token, api });
  if (await fetchSavedKeys()) await moveBrowserKeysToAccount().catch((error) => console.warn("Couldn't move the keys:", error));
}

// The AI keys saved in the learner's Firebase record, fetched on every load and held in
// memory only.
async function fetchSavedKeys() {
  const link = trainerLink();
  if (!link) return false;
  const res = await fetch(`${link.api}/api/talkloop/keys`, { headers: { Authorization: `Bearer ${link.token}` }, cache: "no-store" });
  if (!res.ok) return false;
  const { keys } = await res.json();
  serverKeys = keys && typeof keys === "object" ? keys : {};
  return true;
}

// Saves keys (name → key; "" removes one) to the learner's Firebase record.
async function saveKeysToAccount(keys) {
  const link = trainerLink();
  if (!link) throw new Error("Not linked to the Vocab Trainer: log in again.");
  const res = await fetch(`${link.api}/api/talkloop/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ keys }),
  });
  if (!res.ok) throw new Error(`Couldn't save the keys (${res.status}).`);
  serverKeys = (await res.json()).keys ?? {};
}

// Learnt words, the least secure first (the trainer sorts them).
async function fetchLearntWords() {
  const link = trainerLink();
  const res = await fetch(`${link.api}/api/talkloop/words`, { headers: { Authorization: `Bearer ${link.token}` } });
  if (res.status === 401) {
    store.set("trainer_link", null);
    goToLogin();
    throw new Error("Your Vocab Trainer login has ended: log in again.");
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

// ---------- topic words ----------
// Every conversation has a subject (the topic, the scene, the theme, the role card, the
// colleague's matter). The learner's own words that fit it are shown in a panel beside the
// call, the partner gets openings for them, and each one is ticked once the learner says it.
// Nothing here ever holds up the call: a local match fills the panel at once, the AI's better
// pick replaces it whenever it arrives, and if it never does the local one simply stays.
// Kept in state.settings.topicWords, so it is saved with the call:
// { subject, gen, source: "local" | "ai", words: [{ de, en, example, angle, fit, status: "open" | "used" }],
//   reserve: [same, not shown yet], owed: words still to add once more are found }
// Each word the learner says brings the next one in from the reserve, so there is always
// something left to use; when the reserve runs low, the AI picks more from where the
// conversation has got to (refillTopicWords).
const TOPIC_WORDS_MAX = 10; // shown at first
const TOPIC_WORDS_RESERVE = 10; // kept back, to replace the words the learner uses
const TOPIC_WORDS_MISSED_KEY = "topic_words_missed"; // offered last time but not used: they get a head start
const TOPIC_STOP = new Set("aber alle auch eine einem einen einer eines oder sein sind sollte sollten soll wird werden wurde haben hast hatte nicht noch schon sehr viel mehr dann wenn weil dass denn doch kann können könnte muss müssen ihre ihren seine deine meine mein dein unser euer über unter durch gegen ohne zwischen wie was wer wann warum welche welcher lieber besser gute guter gutes eine ist the and for with your what when where which their about from that this they them into than then have has had are was were will would could should over some other more most very just like make made does did".split(" "));

const topicTokens = (text) => normalizeSpeech(text ?? "").split(" ").filter((t) => t.length >= 4 && !TOPIC_STOP.has(t));

// The conversation's subject in a few words, or "" when there is none yet (a free chat before
// its first subject). Drills have no subject: they bring their own words or sentences.
function conversationSubject(settings) {
  const m = MODES[settings?.request?.mode];
  if (!m || m.drill || m.interpreter || m.joiner) return "";
  if (m.office) {
    const c = settings.colleague;
    return c ? `${c.role}: ${c.reason}` : "";
  }
  if (m.topics) return settings.topic ?? "";
  if (m.roleCard) return settings.roleCard ? `introducing yourself as: ${settings.roleCard}` : "";
  if (m.usesScene) {
    const s = SCENARIOS[settings.request.scenario] ?? SCENARIOS.cafe;
    return `${s.setting}. ${s.goal}`;
  }
  if (m.subjects) {
    const latest = settings.subjects?.at(-1);
    if (latest) return themeByName(latest)?.ask ?? latest;
    // A live call has no subject field to follow, so it gets the kind of chat it is.
    return settings.live ? "everyday life: work, home, family, free time and plans" : "";
  }
  return "";
}

// Every word to choose from, once: the learnt B1 words and the known A1/A2 ones. The panel is
// about the learner's own words, so it doesn't need "Weave my vocab" ticked: without it, they
// are read from the browser's copy (the trainer's learnt words, else the imported list).
async function topicWordPool(settings) {
  const seen = new Set();
  const pool = [];
  const add = (w) => { if (w?.de && !seen.has(w.de)) { seen.add(w.de); pool.push(w); } };
  if (settings.vocab?.enabled) {
    for (const p of vocabPools) p.words.forEach(add);
    return pool;
  }
  const VOCAB_LEVELS = ["A1", "A2", "B1"];
  const upTo = VOCAB_LEVELS.indexOf(settings.level);
  const levels = upTo === -1 ? VOCAB_LEVELS : VOCAB_LEVELS.slice(0, upTo + 1);
  const learnt = trainerLink() ? ((await idbGet("learnt_words").catch(() => null)) ?? []) : [];
  const all = (await idbGet("vocab_words").catch(() => null)) ?? [];
  learnt.filter((w) => levels.includes(w.level) && !KNOWN_LEVELS.includes(w.level)).forEach(add);
  // Linked: A1/A2 count as known, as in a call with the box ticked. Not linked: the imported list.
  all.filter((w) => levels.includes(w.level) && (!learnt.length || KNOWN_LEVELS.includes(w.level))).forEach(add);
  return pool;
}
let topicWordsLoading = null; // { settings, subject } while the words are being read

// A quick local guess: words whose German, English, example or category share a stem with the
// subject. Rough, but instant and free; learnt (B1) words and last time's unused ones go first.
function scoreTopicWord(w, subjectTokens, missed) {
  const match = (t) => subjectTokens.some((s) => s === t || (s.startsWith(t) && s.length - t.length <= 2) || (t.length >= 5 && s.length >= 5 && (s.startsWith(t.slice(0, 5)) || t.startsWith(s.slice(0, 5)))) || (t.length >= 5 && s.includes(t)));
  let score = 0;
  for (const t of topicTokens(bareWord(w.de))) if (match(t)) score += 3;
  for (const t of topicTokens(w.en)) if (match(t)) score += 2;
  for (const t of topicTokens(w.cat)) if (match(t)) score += 1;
  for (const t of new Set(topicTokens(w.example))) if (match(t)) score += 1;
  if (!score) return 0;
  return score + (KNOWN_LEVELS.includes(w.level) ? 0 : 1.5) + (missed.has(w.de) ? 1 : 0);
}

function localTopicWords(subject, pool, max = TOPIC_WORDS_MAX + TOPIC_WORDS_RESERVE) {
  const tokens = topicTokens(subject);
  const missed = new Set(store.get(TOPIC_WORDS_MISSED_KEY, []));
  return pool
    .map((w) => [scoreTopicWord(w, tokens, missed), w])
    .filter(([s]) => s >= 3)
    .sort((a, b) => b[0] - a[0])
    .slice(0, max)
    .map(([, w]) => w);
}

const TOPIC_WORDS_SCHEMA = {
  type: "OBJECT",
  properties: {
    words: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { de: { type: "STRING" }, fit: { type: "INTEGER" }, angle: { type: "STRING" } },
        required: ["de", "fit", "angle"],
        propertyOrdering: ["de", "fit", "angle"],
      },
    },
  },
  required: ["words"],
  propertyOrdering: ["words"],
};

// The AI's pick: from the learner's words, only the ones a native speaker would really use on
// this subject, each with an angle (a question whose natural answer needs it). With
// `conversation` (the last lines of the call) it picks for where the talk has got to, and
// `exclude` (German words) are words already shown or kept back.
async function aiTopicWords(subject, pool, local, language, { conversation = "", exclude = new Set(), max = TOPIC_WORDS_MAX + TOPIC_WORDS_RESERVE } = {}) {
  pool = pool.filter((w) => !exclude.has(w.de));
  local = local.filter((w) => !exclude.has(w.de));
  const learnt = pool.filter((w) => !KNOWN_LEVELS.includes(w.level));
  const known = pool.filter((w) => KNOWN_LEVELS.includes(w.level));
  const tokens = topicTokens(subject);
  const missed = new Set(store.get(TOPIC_WORDS_MISSED_KEY, []));
  // All learnt words (the point of it), the best local matches, then a few known words to choose from.
  const candidates = [...new Set([
    ...local,
    ...learnt.slice(0, 220),
    ...known.map((w) => [scoreTopicWord(w, tokens, missed), w]).filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, 60).map(([, w]) => w),
    ...shuffled(known).slice(0, Math.max(0, 120 - learnt.length)),
  ])].slice(0, 320);
  if (!candidates.length) return [];
  const following = conversation
    ? " The conversation so far is given too: prefer words that fit where it is now and where it could naturally go next, still on the subject."
    : "";
  const raw = await aiJson({
    systemInstruction: `You help a ${language} learner practise their own vocabulary in a real conversation. From the candidate list, choose only the words a native speaker would naturally use when talking about the subject.${following} fit: 3 = central to the subject, 2 = comes up naturally, 1 = would need forcing (leave those out). Choose at most ${max}, best first, fewer if few fit; an empty list is fine. Prefer words marked *. angle: in English, at most 10 words, a question about the subject itself whose natural answer uses the word (e.g. "ask about the disadvantages of a car ban"). Write de exactly as in the list.`,
    schema: TOPIC_WORDS_SCHEMA,
    contents: [{ role: "user", parts: [{ text: `Subject: ${subject}\n${conversation ? `Conversation so far:\n${conversation}\n` : ""}Candidates (* = learnt recently):\n${candidates.map((w) => `${KNOWN_LEVELS.includes(w.level) ? "" : "*"}${w.de}${w.en ? ` — ${w.en}` : ""}`).join("\n")}` }] }],
    temperature: 0.3,
  });
  const picked = [];
  for (const p of Array.isArray(raw?.words) ? raw.words : []) {
    if (!(Number(p?.fit) >= 2)) continue;
    const w = candidates.find((c) => c.de === p.de) ?? candidates.find((c) => bareWord(c.de) === bareWord(p.de ?? ""));
    if (w && !picked.some((x) => x.w === w)) picked.push({ w, fit: Number(p.fit), angle: String(p.angle ?? "").slice(0, 120) });
  }
  return picked.sort((a, b) => b.fit - a.fit).slice(0, max);
}

const topicWordEntry = (w, extra = {}) => ({ de: w.de, en: w.en ?? "", example: w.example ?? "", angle: "", fit: 0, status: "open", ...extra });

// Picks the words for the conversation's current subject: the local list at once, the AI's
// in the background. Called when a call starts, a subject changes or a colleague comes over.
function prepareTopicWords(settings = state.settings) {
  if (!settings?.request) return;
  const subject = conversationSubject(settings);
  if (!subject) { renderTopicWords(); return; }
  if (settings.topicWords?.subject === subject) { renderTopicWords(); return; }
  if (topicWordsLoading?.settings === settings && topicWordsLoading.subject === subject) return;
  const loading = (topicWordsLoading = { settings, subject });
  // Reading the words takes a few milliseconds and is never waited for.
  topicWordPool(settings)
    .then((pool) => {
      if (topicWordsLoading !== loading) return; // a newer subject came along meanwhile
      topicWordsLoading = null;
      topicPool = { settings, pool };
      if (pool.length && state.settings === settings) pickTopicWords(settings, subject, pool);
    })
    .catch((error) => { topicWordsLoading = null; debugLog(`topic words: no words (${error.message})`); });
}

// The panel's first words, the rest kept back; used words stay (ticked) at the top.
function splitTopicWords(used, entries) {
  const fresh = entries.filter((e) => !used.some((u) => u.de === e.de));
  return { words: [...used, ...fresh.slice(0, TOPIC_WORDS_MAX)], reserve: fresh.slice(TOPIC_WORDS_MAX) };
}

function pickTopicWords(settings, subject, pool) {
  const prev = settings.topicWords;
  // Words already said in this call stay (ticked) when the subject moves on.
  const kept = (prev?.words ?? []).filter((w) => w.status === "used");
  const local = localTopicWords(subject, pool);
  const gen = (prev?.gen ?? 0) + 1;
  settings.topicWords = { subject, gen, source: "local", owed: 0, ...splitTopicWords(kept, local.map((w) => topicWordEntry(w))) };
  renderTopicWords();
  aiTopicWords(subject, pool, local, settings.request.language)
    .then((picked) => {
      const tw = settings.topicWords;
      if (!tw || tw.gen !== gen || state.settings !== settings) return; // the subject moved on meanwhile
      const used = tw.words.filter((w) => w.status === "used");
      Object.assign(tw, splitTopicWords(used, picked.map((p) => topicWordEntry(p.w, { fit: p.fit, angle: p.angle }))));
      tw.source = "ai";
      tw.owed = 0;
      renderTopicWords();
      liveQueueTopicWords();
      saveCall();
    })
    .catch((error) => debugLog(`topic words: kept the quick list (${error.message})`));
}

// The learner's sentence: every panel word in it is ticked, and each one brings the next word
// in from the reserve. Returns the words newly used.
function markTopicWords(text) {
  const tw = state.settings?.topicWords;
  if (!tw || !text) return [];
  const fresh = tw.words.filter((w) => w.status !== "used" && saysWord(text, w.de));
  if (!fresh.length) return fresh;
  for (const w of fresh) { w.status = "used"; w.usedAt = Date.now(); }
  tw.reserve ??= [];
  const added = [];
  for (let i = 0; i < fresh.length; i++) {
    const next = takeReserveWord(tw);
    if (next) added.push(next);
    else tw.owed = (tw.owed ?? 0) + 1;
  }
  tw.words.push(...added);
  renderTopicWords([...fresh, ...added].map((w) => w.de));
  if (added.length) liveQueueTopicWords();
  if (tw.reserve.length < 3) refillTopicWords();
  return fresh;
}

// The next kept-back word not already on the panel (the subject may have moved on meanwhile).
function takeReserveWord(tw) {
  while (tw.reserve?.length) {
    const next = tw.reserve.shift();
    if (!tw.words.some((w) => w.de === next.de)) return next;
  }
  return null;
}

// The last few lines of the call, for picking words that fit where the talk is now.
function recentConversation(lines = 8) {
  return callLog
    .slice(-lines)
    .map((e) => (e.you ? `Learner: ${e.you}` : e.reply ? `Partner: ${e.reply}` : ""))
    .filter(Boolean)
    .join("\n")
    .slice(-1500);
}

// More words for the reserve, from the subject and what has been said so far: the AI's pick,
// else a local match on the subject and the latest lines. Words owed to the panel (used ones
// that had nothing to replace them) are added at once; the rest are kept back.
let topicRefill = null; // the settings a refill is running for
let topicPool = null; // { settings, pool }: the words read for this call
function refillTopicWords() {
  const settings = state.settings;
  const tw = settings?.topicWords;
  if (!tw || topicRefill === settings) return;
  topicRefill = settings;
  const { gen, subject } = tw;
  const conversation = recentConversation();
  const poolReady = topicPool?.settings === settings ? Promise.resolve(topicPool.pool) : topicWordPool(settings);
  poolReady
    .then(async (pool) => {
      topicPool = { settings, pool };
      const exclude = new Set([...tw.words, ...(tw.reserve ?? [])].map((w) => w.de));
      const local = localTopicWords(`${subject} ${conversation}`, pool.filter((w) => !exclude.has(w.de)));
      let entries;
      try {
        const picked = await aiTopicWords(subject, pool, local, settings.request.language, { conversation, exclude, max: TOPIC_WORDS_RESERVE });
        entries = picked.map((p) => topicWordEntry(p.w, { fit: p.fit, angle: p.angle }));
      } catch (error) {
        debugLog(`topic words: more from a quick match (${error.message})`);
        entries = local.slice(0, TOPIC_WORDS_RESERVE).map((w) => topicWordEntry(w));
      }
      const now = settings.topicWords;
      if (!now || now.gen !== gen || state.settings !== settings) return; // the subject moved on meanwhile
      const have = new Set([...now.words, ...(now.reserve ?? [])].map((w) => w.de));
      now.reserve = [...(now.reserve ?? []), ...entries.filter((e) => !have.has(e.de))];
      const added = [];
      while (now.owed > 0) {
        const next = takeReserveWord(now);
        if (!next) break;
        added.push(next);
        now.owed--;
      }
      if (added.length) {
        now.words.push(...added);
        liveQueueTopicWords();
      }
      now.owed = 0; // none left that fit: nothing more is waited for
      renderTopicWords(added.map((w) => w.de));
      saveCall();
    })
    .catch((error) => debugLog(`topic words: no more words (${error.message})`))
    .finally(() => { if (topicRefill === settings) topicRefill = null; });
}

// The partner's instructions for the panel's words: conversation first, words only as openings.
function topicWordLines(settings, { live: isLive = false } = {}) {
  const tw = settings?.topicWords;
  if (!tw?.words.length) return [];
  const open = tw.words.filter((w) => w.status !== "used");
  const used = tw.words.filter((w) => w.status === "used");
  const fmt = (w) => `${w.de}${w.en ? ` (${w.en})` : ""}${w.angle ? ` [opening: ${w.angle}]` : ""}`;
  const lines = [];
  if (open.length) {
    lines.push(
      `Words the learner has learnt that fit this conversation (the app shows them in a side panel): ${open.map(fmt).join("; ")}.`,
      `The conversation always comes first. Have a real one: build on what the learner just said, give your own opinion or experience, and disagree now and then. Bring in at most one of these words per ${isLive ? "turn, and not on every turn" : "reply, and not in every reply"}, and only when it is the natural next thing to talk about here; if none fits right now, use none. Prefer asking a question whose natural answer needs the word (its opening says how) over saying it yourself. Never change the subject to fit one in, never quiz ("Kennst du das Wort…?"), never list them. Not in your first ${isLive ? "lines" : "reply"}: let the conversation get going first. It is fine if some stay unused.`,
    );
  }
  if (used.length) lines.push(`The learner has already used: ${used.map((w) => w.de).join("; ")}; don't steer towards these again.`);
  return lines;
}

// A live call got its instructions when it connected: the AI's better pick reaches it as a quiet
// note once the partner's current turn is over (see liveMessage), never cutting it off.
function liveQueueTopicWords() {
  if (!live?.ready) return;
  const lines = topicWordLines(state.settings, { live: true });
  if (lines.length) live.wordsNote = `(Coach, not the learner: an updated word list for this conversation, nothing to say about it now. ${lines.join(" ")})`;
}

// The panel beside the call. `flash` lists words just ticked, for a short highlight.
// The panel beside the call (components/CallScreen.jsx, TopicWords). `flash` lists words just
// ticked, for a short highlight.
function renderTopicWords(flash = []) {
  const tw = state.settings?.topicWords;
  const subjectless = !tw && (state.settings?.vocab?.enabled || Boolean(trainerLink())) && MODES[state.settings?.request?.mode]?.subjects;
  if (!tw && !subjectless) { ui.set({ topicWords: null }); return; }
  const words = tw?.words ?? [];
  const used = words.filter((w) => w.status === "used").length;
  ui.set({
    topicWords: {
      count: words.length ? `${used} / ${words.length}` : "",
      sub: !tw
        ? "Words appear once a subject comes up."
        : !words.length
          ? tw.source === "ai" ? "None of your words fit this one: just talk!" : "Looking for your words that fit…"
          : used === words.length && tw.owed > 0
            ? "All used! Finding more of your words for where the talk is going…"
            : tw.source === "ai" ? "Your learnt words that fit. Each one you use brings in another." : "Quick match: refining…",
      lang: state.settings?.locale ?? "de-DE",
      words: words.map((w) => ({
        de: w.de,
        en: w.en,
        status: w.status,
        more: [w.angle && `💬 ${w.angle}`, w.example && `„${w.example}“`].filter(Boolean).join("  "),
      })),
      flash,
      flashAt: flash.length ? Date.now() : ui.get().topicWords?.flashAt ?? 0,
    },
  });
}

// After a call: which panel words were used, and the unused ones get a head start next time.
function topicWordsRecap() {
  const tw = state.settings?.topicWords;
  if (!tw?.words.length) return null;
  const used = tw.words.filter((w) => w.status === "used").map((w) => w.de);
  const unused = tw.words.filter((w) => w.status !== "used").map((w) => w.de);
  store.set(TOPIC_WORDS_MISSED_KEY, [...new Set([...unused, ...store.get(TOPIC_WORDS_MISSED_KEY, [])])].filter((de) => !used.includes(de)).slice(0, 60));
  return { used, unused, total: tw.words.length };
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
  todayWords = { active: order.slice(0, TODAY_WORDS), waiting: order.slice(TODAY_WORDS), status: {}, asked: {} };
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
  const status = todayWords?.status ?? {};
  const said = Object.entries(status).filter(([, s]) => s.correct && !s.peeked).map(([de]) => de);
  const tried = Object.entries(status).filter(([de]) => !said.includes(de)).map(([de]) => de);
  const missed = todayWords ? todayWords.active.map((w) => w.de).filter((de) => !status[de]) : [];
  // A Dolmetscher call: its sentences instead (one said wrong, then right, counts as right).
  const sentences = state.settings?.sayStats;
  if (sentences && (sentences.right.length || sentences.again.length)) {
    renderSentenceRecap(null, sentences.right, sentences.again.filter((s) => !sentences.right.includes(s)));
    return;
  }
  const topic = topicWordsRecap();
  if (!said.length && !tried.length && !topic) {
    ui.set({ recap: null });
    return;
  }
  const automatic = Object.values(store.get("spoken", {})).filter((s) => s.stage >= 4).length;
  ui.set({ recap: { kind: "words", said, tried, missed, automatic, topic } });
}

function renderSentenceRecap(box, right, again) {
  const learnt = Object.values(store.get("sentences", {})).filter((s) => s.stage >= 4).length;
  ui.set({ recap: { kind: "sentences", right, again, learnt } });
}

const scheduleSyncs = {}; // the sync in flight per schedule, if any

// Like syncMistakes: sends what changed here since the last sync, keeps the newer of each
// entry. `name` is the stored schedule and its route ("spoken", "sentences"), `field` the
// object the route sends and answers with.
function syncSchedule(name, field, { keepalive = false } = {}) {
  const link = trainerLink();
  if (!link || scheduleSyncs[name]) return;
  const startedAt = Date.now();
  const since = store.get(`${name}_synced_at`, 0);
  const changed = Object.fromEntries(Object.entries(store.get(name, {})).filter(([, s]) => s.updatedAt >= since));
  const body = JSON.stringify({ [field]: changed });
  scheduleSyncs[name] = fetch(`${link.api}/api/talkloop/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}`, "Content-Type": "application/json" },
    body,
    keepalive: keepalive && body.length < 60_000,
  })
    .then(async (res) => {
      if (!res.ok) return;
      const merged = (await res.json())[field] ?? {};
      const local = store.get(name, {});
      for (const [key, s] of Object.entries(merged)) {
        if (!local[key] || s.updatedAt > local[key].updatedAt) local[key] = s;
      }
      store.set(name, local);
      store.set(`${name}_synced_at`, startedAt);
    })
    .catch(() => {})
    .finally(() => { scheduleSyncs[name] = null; });
}
const syncSpoken = (options) => syncSchedule("spoken", "words", options);
const syncSentences = (options) => syncSchedule("sentences", "sentences", options);

// ---------- what calls have had lately ----------
// Left to itself the AI picks the same situation, scene opening or subject call after call. So
// each mode's recent material is kept, newest first per kind, and the next call is told to
// steer clear of it: the sentence drill's situations, the connector drill's tasks, the role
// cards, how each scene opened, the Büro's visitors and their reasons. Kept here and in the
// trainer's Firebase record (/api/talkloop/used), so it holds on every device and after the
// browser's storage is cleared. (Topics and free-chat subjects have their own record: the
// saved chats, see syncChats.)
const USED_KEY = "used_by_kind"; // { kind: [item, …] }, newest first
const USED_UNSENT_KEY = "used_unsent"; // { kind: [item, …] } in the order they came up, not in the trainer yet
const USED_MAX = 60;
let usedSync = null;

const usedKind = (kind) => String(kind).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40);
const recentlyUsed = (kind, n = USED_MAX) => (store.get(USED_KEY, {})[usedKind(kind)] ?? []).slice(0, n);

function noteUsed(kind, item) {
  const text = String(item ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return;
  const k = usedKind(kind);
  const all = store.get(USED_KEY, {});
  all[k] = [text, ...(all[k] ?? []).filter((t) => t !== text)].slice(0, USED_MAX);
  store.set(USED_KEY, all);
  const unsent = store.get(USED_UNSENT_KEY, {});
  unsent[k] = [...(unsent[k] ?? []).filter((t) => t !== text), text].slice(-USED_MAX);
  store.set(USED_UNSENT_KEY, unsent);
}

// Sends what came up here since the last sync and takes the trainer's whole record.
function syncUsed({ keepalive = false } = {}) {
  const link = trainerLink();
  if (!link || usedSync) return;
  const sent = store.get(USED_UNSENT_KEY, {});
  const body = JSON.stringify({ used: sent });
  usedSync = fetch(`${link.api}/api/talkloop/used`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}`, "Content-Type": "application/json" },
    body,
    keepalive: keepalive && body.length < 60_000,
  })
    .then(async (res) => {
      if (!res.ok) return;
      const remote = (await res.json()).used ?? {};
      // What came up here while this was on its way stays unsent.
      const unsent = store.get(USED_UNSENT_KEY, {});
      for (const [k, items] of Object.entries(sent)) {
        unsent[k] = (unsent[k] ?? []).filter((t) => !items.includes(t));
        if (!unsent[k].length) delete unsent[k];
      }
      store.set(USED_UNSENT_KEY, unsent);
      const local = store.get(USED_KEY, {});
      const merged = {};
      for (const k of new Set([...Object.keys(remote), ...Object.keys(local)])) {
        merged[k] = [...new Set([...[...(unsent[k] ?? [])].reverse(), ...(remote[k] ?? []), ...(local[k] ?? [])])].slice(0, USED_MAX);
      }
      store.set(USED_KEY, merged);
    })
    .catch(() => {})
    .finally(() => { usedSync = null; });
}

// A line for the partner: what earlier calls had, to be left alone ("" when nothing yet).
function usedLine(kind, n, what) {
  const items = recentlyUsed(kind, n);
  return items.length ? `${what}: ${items.map((t) => JSON.stringify(t)).join(", ")}.` : "";
}

// ---------- the Dolmetscher's sentence deck ----------
// Every sentence the learner is given to say is kept with its right version and comes back
// like a word in the speaking schedule: said right, it moves up a stage and is due again after
// 1, 3, 7 and 21 days (stage 4 = learnt); said wrong, it goes back to stage 0, comes up again a
// few sentences later in the same call, and is due tomorrow. Each call mixes the due ones in
// with the partner's new ones. Kept in this browser ("sentences": {key: {say, de, stage, due,
// misses, updatedAt}}) and synced with the trainer.
const SENTENCE_AGAIN_AFTER = 3; // a sentence said wrong comes back after this many others
const sentenceKey = (say) => (say ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 200);

// The learner's try at the sentence on screen, as the coach judged it.
function recordSentence(settings, message, coach) {
  const say = settings.sayThis;
  const key = sentenceKey(say);
  if (!key) return;
  const deck = store.get("sentences", {});
  const prev = deck[key];
  const stats = (settings.sayStats ??= { right: [], again: [] });
  const now = Date.now();
  // A "correction" that only changes capital letters isn't one.
  const correction = coach.correction.trim().toLowerCase() === message.trim().toLowerCase() ? "" : coach.correction.trim();
  if (coach.understood && !correction) {
    const stage = Math.min(4, (prev?.stage ?? 0) + 1);
    deck[key] = { say, de: message.trim(), stage, due: now + SPOKEN_DAYS[stage - 1] * 86_400_000, misses: prev?.misses ?? 0, updatedAt: now };
    if (!stats.right.includes(say)) stats.right.push(say);
  } else {
    deck[key] = { say, de: correction || prev?.de || "", stage: 0, due: now + 86_400_000, misses: (prev?.misses ?? 0) + 1, updatedAt: now };
    (settings.sayRetry ??= []).push({ say, at: (settings.sayTurn ?? 0) + SENTENCE_AGAIN_AFTER });
    if (!stats.again.includes(say)) stats.again.push(say);
  }
  store.set("sentences", deck);
}

// The next sentence to say: one said wrong earlier in this call once its turn has come, else
// on every other turn a due one from the deck, else the partner's new one. A sentence already
// given in this call never comes back otherwise, so if the partner repeats one (or gives none)
// the deck's next sentence takes its place. `kind` labels it: "new", "review" or "again".
function nextSentence(settings, offered) {
  const turn = (settings.sayTurn = (settings.sayTurn ?? 0) + 1);
  const given = new Set([...(settings.sayThisDone ?? []), settings.sayThis].map(sentenceKey).filter(Boolean));
  const deck = Object.values(store.get("sentences", {})).filter((s) => !given.has(sentenceKey(s.say))).sort((a, b) => a.due - b.due);
  const due = deck.find((s) => s.due <= Date.now());
  const fresh = (offered ?? "").trim().slice(0, 200);
  const retry = (settings.sayRetry ??= []).findIndex((r) => r.at <= turn);
  let pick = null;
  if (retry >= 0) pick = { say: settings.sayRetry.splice(retry, 1)[0].say, kind: "again" };
  else if (due && turn % 2 === 1) pick = { say: due.say, kind: "review" };
  else if (fresh && !given.has(sentenceKey(fresh))) pick = { say: fresh, kind: store.get("sentences", {})[sentenceKey(fresh)] ? "review" : "new" };
  else if (deck.length) pick = { say: deck[0].say, kind: "review" };
  if (!pick) return; // nothing new at all: the sentence on screen stays
  if (settings.sayThis) (settings.sayThisDone ??= []).push(settings.sayThis);
  settings.sayThis = pick.say;
  settings.sayKind = pick.kind;
}

// What the partner must not give again: this call's sentences, then the deck's newest.
function sentencesGiven(settings) {
  const recent = Object.values(store.get("sentences", {})).sort((a, b) => b.updatedAt - a.updatedAt).map((s) => s.say);
  return [...new Set([...(settings.sayThisDone ?? []), ...recent])].slice(0, 40);
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
    // In a free chat or interview: what the reply's question is about, in a few English words.
    // Not required: other modes leave it out.
    subject: { type: "STRING" },
  },
  required: ["coach", "mood", "reply", "reply_translation", "suggestions", "rapport_delta", "conversation_finished", "next_word", "situation"],
  propertyOrdering: ["coach", "mood", "reply", "reply_translation", "suggestions", "rapport_delta", "conversation_finished", "next_word", "situation", "subject"],
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

// ---------- connectors (the trainer's static/data/connectors.json) ----------
// What each kind of connector does to the word order, as the trainer's Connectors tab says it.
const CONNECTOR_TYPES = {
  pos0: "position 0: both halves keep their normal order, verb second",
  pos1: "an adverb in position 1: the verb comes right after it, then the subject",
  end: "starts a side sentence: its conjugated verb goes to the end; if that part comes first, the main sentence starts with its verb",
  zu: "zu + infinitive at the end, when both parts have the same subject: no subject and no conjugated verb in that part",
  pair: "a two-part connector: check the word order in each half",
};
let connectorList = null; // loaded once (see loadConnectors)

async function loadConnectors() {
  if (connectorList) return connectorList;
  const api = store.get("trainer_api", TRAINER_API).replace(/\/+$/, "");
  const res = await fetch(`${api}/data/connectors.json`);
  if (!res.ok) throw new Error(`Couldn't load the connectors (${res.status}).`);
  connectorList = await res.json();
  return connectorList;
}

// The connectors a call practises, kept with the call: one chosen with its rule, or for a
// mix every one up to the level (names only: their rules are the kinds in CONNECTOR_TYPES).
function connectorPool(list, key, level) {
  const one = list.find((c) => c.key === key);
  const pairs = (c) => (c.exercises ?? []).map((e) => [e.a, e.b]); // the tab's own tasks, for when the AI gives none
  if (one) return [{ name: one.name, en: one.en, type: one.type, rule: one.rule, example: one.examples?.[0]?.de.replace(/[[\]]/g, "") ?? "", pairs: pairs(one) }];
  const levels = ["A1", "A2", "B1"].slice(0, ["A1", "A2", "B1"].indexOf(level) + 1 || 3);
  return list.filter((c) => levels.includes(c.level)).map((c) => ({ name: c.name, en: c.en, type: c.type, pairs: pairs(c) }));
}

// A connector task as the drill shows it: "Verbinde mit „weil“: Ich bleibe zu Hause. + Ich bin krank."
const isConnectorTask = (text) => /verbinde mit\b[^:]*:.+\+.+/i.test(text);
const connectorTaskIn = (text) => text.match(/verbinde mit\b[^:\n]*:[^\n]*\+[^\n]*/i)?.[0].trim() ?? "";

// One of the Connectors tab's own tasks, not the one just given.
function fallbackConnectorTask(pool, last = "") {
  // A call started before the pairs were kept with it finds them in the loaded list.
  const pairsOf = (c) => c.pairs ?? (connectorList?.find((x) => x.name === c.name)?.exercises ?? []).map((e) => [e.a, e.b]);
  const tasks = pool.flatMap((c) => pairsOf(c).map(([a, b]) => `Verbinde mit „${c.name}“: ${a} + ${b}`)).filter((t) => t !== last);
  return tasks.length ? tasks[Math.floor(Math.random() * tasks.length)] : "";
}

function connectorsLine(pool) {
  if (pool.length === 1) {
    const c = pool[0];
    return `Connector to practise in every task: „${c.name}“ (${c.en}). Rule: ${c.rule}${c.example ? ` Example: ${c.example}` : ""}`;
  }
  const kinds = Object.entries(CONNECTOR_TYPES).map(([type, rule]) => {
    const names = pool.filter((c) => c.type === type).map((c) => `„${c.name}“ (${c.en})`);
    return names.length ? `${names.join(", ")}: ${rule}.` : "";
  }).filter(Boolean);
  return `Connectors to practise, a different one each task, going through all of them: ${kinds.join(" ")}`;
}

// Free chat, interview, "Mein Leben" and "Erzähl mal": the learner's vocab never chooses the subject.
const SUBJECTS_NOT_FROM_WORDS = "When a subject runs dry, choose the next one from the learner's own life and what they said, never to fit these words.";

function turnSystemPrompt({ language, nativeLanguage, level, scenario, mode, tense }, targetWords = [], learnt = false, learnerMessage = "", weakSpots = [], today = null, hints = null) {
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
    ...(m.usesScene ? sceneVariety(scenario) : []),
    "The learner's message comes from speech recognition: ignore missing punctuation and obvious transcription slips.",
    // Said once, briefly: without it, models that get the schema only as text left suggestions empty.
    `Write reply_translation and coach.tip in ${nativeLanguage}; everything else in ${language}. suggestions: 2-3 short answers the learner could give.`,
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
  // In the chats about the learner's own life the words never pick the next subject either:
  // a word list from one unit (society, media, technology) pulled every chat to that unit.
  const stayOnTopic = `Conversation first: follow on from what the learner said and stay on topic. Use a listed word only where it fits naturally; never change topic or ask something unrelated to bring one in (the list stays for the next turns). ${m.subjects ? SUBJECTS_NOT_FROM_WORDS : "When a topic runs dry, bridge naturally to one where some fit."}`;
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
    const resting = (w) => wordResting(today.asked, w.de, today.turn ?? 0);
    const askable = notYet.filter((w) => m.drill || !resting(w));
    const waiting = m.drill ? [] : notYet.filter(resting);
    lines.push(
      `Today's words, to be said until automatic: ${today.words.map(fmt).join("; ")}.`,
      ...(m.drill
        ? [
          today.situation
            ? `Current situation: ${JSON.stringify(today.situation)}. Continue it from where the conversation left off.`
            : "No situation yet: start one.",
          ...[usedLine("drill-situations", 25, "Situations of earlier drills: whenever you start a new situation, choose one clearly different from all of these")].filter(Boolean),
          `Ask first for words not said yet${notYet.length ? ` (${notYet.map((w) => w.de).join("; ")})` : ""}, one per step, the one fitting the next moment best. ${neverSay}`,
          // Spelled out: faster models (Groq) otherwise tend to say the word in the question.
          "Most important rule: your reply must NOT contain the word you are asking for, in any form, nor a translation of it, until the learner has said it correctly. Refer to it only as \"das Wort auf deinem Bildschirm\" and describe the moment so that this word is the natural thing to say. Wrong: \"Das Handy sieht schrecklich aus. Sag einen Satz mit diesem Wort.\" Right: \"Das Display ist kaputt und voller Kratzer. Wie findest du das Handy? Nutze das Wort auf deinem Bildschirm.\"",
          ...(said.length ? [`Already said once: ${said.map((w) => w.de).join("; ")}. Bring each back at a later moment needing another form (tense, person), so they build a new sentence.`] : []),
          "If their sentence misses the word asked for or uses it wrongly, ask for it again next turn, still without saying it.",
        ]
        : [
          ...(askable.length
            ? [m.topics
              // In a topic chat the topic is fixed: a word is asked for only where it is the
              // natural thing to say about it, otherwise the discussion just goes on.
              ? `Not said yet: ${askable.map((w) => w.de).join("; ")}. Only where one of these is the natural thing to say about the current topic, ask a question whose answer needs it, without naming it. If none fits at this point, ask for none and keep discussing the topic: never change the topic or bridge to another one to bring a word in, and don't force a word in. ${neverSay}`
              : `Not said yet: ${askable.map((w) => w.de).join("; ")}. Get the learner to say them, one at a time, with a question on the current topic whose natural answer needs one (${m.subjects ? `if none fits, ask for none: ${SUBJECTS_NOT_FROM_WORDS}` : "bridge naturally"}; never quiz or list). ${neverSay}`]
            : []),
          ...(waiting.length ? [`Asked about already without success, so leave these alone for now: ${waiting.map((w) => w.de).join("; ")}.`] : []),
          ...(said.length ? [`Already said: ${said.map((w) => w.de).join("; ")}. Bring each back later in another form.`] : []),
        ]),
      "next_word: the word from this list (as written) your reply asks for, else empty.",
      ...(learnerMessage ? ["coach.used_words: list every one of today's words that appears in the learner's last message, in any form (write it as in the list), with correct true only if its meaning, form and article are right; empty only if none appears. A wrong use also gets a coach.correction."] : []),
    );
  }
  if (m.topics && hints) {
    lines.push(`Stay on the topic "${hints.topic}": every question is about it itself, never about something the learner only mentioned in passing, and never about another subject.${hints.asked.length ? ` You have already asked: ${hints.asked.map((q) => JSON.stringify(q)).join(" ")}. Never ask any of these, or a question that starts or means the same, again.` : ""}${hints.angle ? ` This turn, ask about ${hints.angle}.` : ""}`);
  }
  if (m.roleCard && hints?.card) lines.push(`The learner's role card (they play this person): ${hints.card}.`);
  if (m.interpreter) {
    const given = hints?.given?.length ? ` Already given, never again: ${hints.given.map((g) => JSON.stringify(g)).join(" ")}.` : "";
    const judge = hints?.target ? ` They were asked to say: ${JSON.stringify(hints.target)}; coach judges whether their message says that correctly in ${language}, meaning included.` : "";
    lines.push(`situation: the next sentence for the learner to say in ${language}, written in ${nativeLanguage}: short and everyday, at their level, a new situation or pattern each time (shopping, work, friends, travel, home, plans, problems). Always a new one, also after a wrong try: the app brings that sentence back itself later.${given}${judge} reply: one short ${language} reaction to their try; never say the ${language} version of the new sentence.`);
  }
  if (m.joiner) {
    const judge = hints?.target ? ` Their task was: ${JSON.stringify(hints.target)}; coach judges whether their message joins those two sentences into one correct sentence with that connector: the connector used, the verb in the right place in each half, nothing changed in meaning. Either order of the halves is right where the connector allows it. A wrong or missing connector or word order gets a coach.correction with the right joined sentence (verb position goes in mistakes as verb_position).` : "";
    lines.push(`${connectorsLine(hints?.pool ?? [])} situation: the next task, written exactly as: Verbinde mit „<connector>“: <sentence one> + <sentence two>. situation holds that whole task and nothing else, never a topic word. Two short everyday ${language} sentences at their level that make sense joined with it, about something new each time; also after a wrong try give a new one.${connectorTasksLine()}${judge} reply: one short ${language} reaction to their try (praise, or the rule in a few words); never write the joined sentence of the new task. Every reply gives a new task, without exception: the drill goes on, task after task, until the learner ends the call; never ask whether they want to go on, never sum up or say goodbye. ${hints?.pool?.length === 1 ? `Every task uses „${hints.pool[0].name}“ and nothing else, with new sentences each time.` : "When every connector has had a task, start again from the first with new sentences."}`);
  }
  if (m.subjects && hints) {
    const quote = (list) => list.map((s) => JSON.stringify(s)).join(", ");
    if (hints.next) {
      const next = m.themes === "story" ? `When the current story is told, ask for this one next: ${hints.next.ask}` : `When the current subject runs dry (after about five or six exchanges on it), move on to ${hints.next.ask}`;
      lines.push(`Ask open questions that take a few sentences to answer (Erzähl mal…, Wie war das…, Warum…, Beschreib mal…), not yes/no ones; when an answer is short, ask for one concrete detail (who, where, what exactly, how it felt). Never bring up hobbies, free time (Freizeit) or the weekend yourself. ${next}, and then set subject to exactly ${JSON.stringify(hints.next.name)}.`);
    }
    lines.push(`subject: what the question in your reply is about, in two to four English words (e.g. "weekend plans"); keep it the same while you stay on it.${hints.covered.length ? ` Talked about in earlier chats, so never bring these up yourself (follow the learner if they do): ${quote(hints.covered)}.` : ""}${hints.current.length ? ` Already talked about in this chat: ${quote(hints.current)}; when the current one runs dry, move on to a new subject, not back to one of these.` : ""}`);
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
    // Plain strings, or objects such as {"text": …} from models that wrap each one.
    suggestions: list(t.suggestions)
      .map((s) => (typeof s === "string" ? s : s && typeof s === "object" ? Object.values(s).find((v) => typeof v === "string") ?? "" : ""))
      .map((s) => s.trim())
      .filter(Boolean),
    rapport_delta: Number.isFinite(t.rapport_delta) ? t.rapport_delta : 0,
    conversation_finished: t.conversation_finished === true,
    next_word: str(t.next_word),
    situation: str(t.situation),
    subject: str(t.subject).trim().toLowerCase().slice(0, 60),
  };
}

function parseModelJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Some models put a sentence or a code fence around the JSON: take the object itself.
    try {
      return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    } catch {
      throw new Error("The model returned an unreadable response. Please try again.");
    }
  }
}

// One request to an OpenAI-compatible chat API (OpenAI, Groq, Mistral). Returns the fetch Response.
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

function chatMessages({ systemInstruction, schema, contents }) {
  return [
    { role: "system", content: chatSystemContent(systemInstruction, schema) },
    ...contents.map((c) => ({
      role: c.role === "model" ? "assistant" : "user",
      content: c.parts.map((p) => p.text).join(""),
    })),
  ];
}

function chatRequest(service, key, request, stream = false) {
  const { temperature = 0.8 } = request;
  const messages = chatMessages(request);
  return fetch(service.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: service.model,
      messages,
      response_format: { type: "json_object" },
      ...(service.noTemperature ? {} : { temperature }),
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

// OpenAI as the main service, streamed so the reply can be voiced before the rest is written.
// When it is busy or at its limit, Groq takes over, if it has a key.
async function openaiJson(request) {
  const openaiKey = getKey("openai");
  if (!openaiKey) throw new Error("Add your OpenAI API key to start.");
  const stream = typeof request.onPartial === "function";
  let service = OPENAI;
  let res = await chatRequest(OPENAI, openaiKey, request, stream);
  if ((res.status === 429 || res.status >= 500) && getKey("groq")) {
    debugLog("OpenAI busy: using Groq");
    service = GROQ;
    res = await chatRequest(GROQ, getKey("groq"), request);
  }
  if (!res.ok) throw await failure(res, `${service.name}${service === OPENAI ? ` (${OPENAI.model})` : ""}`);
  if (stream && service === OPENAI) {
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

// Cloudflare Workers AI (the same gpt-oss-120b, a few seconds per reply) as the last backup.
// Its API refuses calls from web pages, so the request goes through the trainer
// (POST /api/talkloop/cloudflare, with the Talkloop link), which forwards it with the
// learner's account ID and token; neither is stored there.
const CLOUDFLARE = { name: "Cloudflare" };
const hasCloudflare = () => Boolean(getKey("cfAccount") && getKey("cfToken") && trainerLink());
function cloudflareRequest(request) {
  const link = trainerLink();
  return fetch(`${link.api}/api/talkloop/cloudflare`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${link.token}`,
      "content-type": "application/json",
      "x-cloudflare-account": getKey("cfAccount"),
      "x-cloudflare-token": getKey("cfToken"),
    },
    body: JSON.stringify({
      messages: chatMessages(request),
      response_format: { type: "json_object" },
      temperature: request.temperature ?? 0.8,
      max_tokens: 2000,
      reasoning_effort: "low",
    }),
  });
}
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
  if ((res.status === 429 || res.status >= 500) && hasCloudflare()) {
    debugLog("Groq at its limit: using Cloudflare");
    service = CLOUDFLARE;
    res = await cloudflareRequest(request);
  }
  if ((res.status === 429 || res.status >= 500) && mistralKey) {
    service = MISTRAL;
    res = await chatRequest(MISTRAL, mistralKey, request);
  }
  if (!res.ok) throw await failure(res, service.name);
  const data = await res.json().catch(() => ({}));
  return parseModelJson(data.choices?.[0]?.message?.content ?? "");
}

// Cloudflare Workers AI as the main service (through the trainer, see cloudflareRequest).
// When it is busy or at its limit, Groq takes over if it has a key.
async function cloudflareJson(request) {
  if (!getKey("cfAccount") || !getKey("cfToken")) throw new Error("Add your Cloudflare account ID and API token to start.");
  if (!trainerLink()) throw new Error("Cloudflare goes through the Vocab Trainer: log in there first.");
  let service = CLOUDFLARE;
  let res = await cloudflareRequest(request);
  if ((res.status === 429 || res.status >= 500) && getKey("groq")) {
    debugLog("Cloudflare busy: using Groq");
    service = GROQ;
    res = await chatRequest(GROQ, getKey("groq"), request);
  }
  if (!res.ok) throw await failure(res, service.name);
  const data = await res.json().catch(() => ({}));
  return parseModelJson(data.choices?.[0]?.message?.content ?? "");
}

function aiJson(request) {
  const provider = getProvider();
  if (provider === "groq") return groqJson(request);
  if (provider === "cloudflare") return cloudflareJson(request);
  if (provider === "openai") return openaiJson(request);
  return geminiJson(request);
}

async function geminiJson({ systemInstruction, schema, contents, onPartial, temperature = 0.8 }) {
  const key = getKey("gemini");
  if (!key) throw new Error("Add your Gemini API key to start.");
  const stream = typeof onPartial === "function";
  const method = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
  const request = (model, key = getKey("gemini")) =>
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
  // When the key is out of free quota on both, the backup Gemini key (another account's) takes over.
  if (res.status === 429 && getKey("gemini2")) {
    debugLog("Gemini key at its limit: using the backup key");
    res = await request(CONV_MODEL, getKey("gemini2"));
    if (res.status === 503 || res.status === 429) res = await request(CONV_FALLBACK_MODEL, getKey("gemini2"));
  }
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
  let userText = message.trim();
  if (!userText) {
    // The opening turn: in "Discuss a topic" the app has chosen the topic.
    if (mode.topics) {
      const topic = settings.topic ?? pickTopic(settings.request.level, recentTopics());
      userText = mode.opener(topic);
    } else if (mode.themes) {
      userText = mode.opener(themeByName(chatThemes(settings)[0]));
    } else {
      userText = mode.opener;
    }
  }
  const learnt = Boolean(settings.vocab?.learnt);
  const today = todayWords ? { words: todayWords.active, status: todayWords.status, situation: todayWords.situation, asked: todayWords.asked ?? {}, turn: Math.floor(history.length / 2) } : null;
  const todaySet = new Set(today?.words.map((w) => w.de));
  // A drill is only about today's words: no background words to weave in. With topic words
  // (the words that fit this conversation, see prepareTopicWords) they replace the random batch.
  const topicWordsOn = Boolean(settings.topicWords);
  const targetWords = settings.vocab?.enabled && !mode.drill && !topicWordsOn ? nextVocabBatch(learnt ? 8 : 12).filter((w) => !todaySet.has(w.de)) : [];
  const startedAt = performance.now();
  let voiced = false;
  const hints = mode.topics ? topicHints(history, settings.topic ?? "")
    : mode.subjects ? subjectHints(settings.subjects ?? [], mode.themes ? chatThemes(settings) : [])
    : mode.roleCard ? { card: settings.roleCard ?? "" }
    : mode.interpreter ? { target: settings.sayThis ?? "", given: sentencesGiven(settings) }
    : mode.joiner ? { target: settings.joinThis ?? "", pool: settings.connectors ?? [] }
    : null;
  // Topic words only once the conversation is going (never in the opening reply).
  const wordLines = history.length >= 2 ? topicWordLines(settings) : [];
  const systemInstruction = [turnSystemPrompt(settings.request, targetWords, learnt, message.trim(), recurringMistakes(settings.request.language), today, hints), ...wordLines].join("\n");
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
  // The connector drill runs until the learner ends it, so every turn must bring the next pair.
  // Models put a topic word ("travel") in situation, or the task only in the reply: the task is
  // taken from the reply then, asked for once more, and else one of the tab's own is given.
  if (mode.joiner && !isConnectorTask(turn.situation)) {
    let task = connectorTaskIn(turn.reply);
    if (!task) {
      debugLog(`connector drill answer had no task (situation ${JSON.stringify(turn.situation)}): asking again`);
      const again = await aiJson({
        systemInstruction: `${systemInstruction}\nYour last draft had no task in situation: every reply must put the next task there, written as Verbinde mit „…“: … + …`,
        schema: TURN_SCHEMA,
        contents,
      }).then(normalizeTurn).catch(() => null);
      if (again?.reply && isConnectorTask(again.situation)) turn = again;
      task = isConnectorTask(turn.situation) ? turn.situation.trim() : fallbackConnectorTask(settings.connectors ?? [], settings.joinThis);
    }
    turn.situation = task;
  }
  debugLog(`whole answer after ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  // A reply that says the word it asks for gives the answer away (a drill on Groq does this
  // when it asks again; in a topic chat some models name the word while asking about it), so
  // it is written once more with that pointed out. Costs about a second.
  const asked = (mode.drill || mode.topics) && today?.words.find((w) => !today.status[w.de]?.correct && isTodayWord(w, turn.next_word));
  if (asked && saysWord(turn.reply, asked.de)) {
    debugLog(`reply said "${asked.de}": asking again`);
    const how = mode.drill
      ? 'refer to it only as "das Wort auf deinem Bildschirm"'
      : "ask the same kind of question in other words, so that the learner has to find the word, or ask for no word at all";
    const again = await aiJson({
      systemInstruction: `${systemInstruction}\nYour last draft of this reply contained the word "${asked.de}" itself, which gives the answer away. Write the reply again without that word in any form; ${how}.`,
      schema: TURN_SCHEMA,
      contents,
      ...(mode.drill ? { temperature: 0.4 } : {}),
    }).then(normalizeTurn).catch(() => null);
    if (again?.reply && !saysWord(again.reply, asked.de)) turn = again;
    debugLog(`answer after ${((performance.now() - startedAt) / 1000).toFixed(1)}s`);
  }
  turn.focusWords = targetWords;
  // Suggested answers would give the drill's word, the interpreter's sentence or the joined one away.
  if (mode.drill || mode.interpreter || mode.joiner) turn.suggestions = [];
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
  const request = (key) => fetch(`${API_BASE}/${TTS_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
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
  let res = await request(key);
  // At the key's daily limit, the backup Gemini key speaks instead.
  if (res.status === 429 && getKey("gemini2")) res = await request(getKey("gemini2"));
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
  let box = document.getElementById("debug-log");
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
  ui.set({ heard: text });
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
  } else if (spoken && !state.autoSend) {
    // Manual send: collect what was said in the text box and keep listening for more.
    // It goes out when the Send button is tapped.
    const input = refs.text;
    if (input) input.value = `${input.value.trim()} ${spoken}`.trim();
    setStatus("Tap Send when you're done.");
    maybeResumeListening();
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
  ui.merge("mic", { on, label: on ? "Listening" : "Talk" });
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
const TTS_CACHE_MAX = 20; // decoded voice clips kept for Replay; fewer keeps a long call light on a phone
function rememberTts(text, audio) {
  ttsCache.set(text, audio);
  if (ttsCache.size > TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value);
}

// Get the open-source voice ready in the background (download the first time, then load
// it into memory), showing progress on the setup screen and in the call.
const piperLoads = new Map(); // locale -> Promise
function setVoiceStatus(text) {
  ui.set({ voiceStatus: text });
  const inCall = ui.get().view.call;
  const status = ui.get().status;
  const mine = status.startsWith("Voice:");
  if (inCall && !state.busy && !state.paused && (mine || !status)) setStatus(text);
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
        if (selectedLocale() === locale || state.settings?.locale === locale) {
          setVoiceStatus("");
          ui.set({ voiceStatus: "✓ Voice ready" });
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
  const locale = selectedLocale();
  if (!locale) return;
  if (!hasPiperVoice(locale)) {
    ui.set({ voiceStatus: "" });
    return;
  }
  preloadPiper(locale).catch((error) => console.warn("Piper voice failed to load:", error));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Voice order: Piper (open-source, runs on the device, unlimited) → Gemini (small
// daily free quota) → the browser's built-in voice.
async function speak(text, wordSpans, onDone, mood = "neutral") {
  if (!wordSpans || Array.isArray(wordSpans)) wordSpans = NO_WORDS; // [] used to mean "no words to highlight"
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
    wordSpans.highlight(Math.min(wordSpans.length - 1, Math.floor((elapsedFn() / duration) * wordSpans.length)));
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
    wordSpans.clear();
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
    wordSpans.highlight(Math.min(wordSpans.length - 1, Math.floor((audio.currentTime / audio.duration) * wordSpans.length)));
  };
  const clear = () => {
    wordSpans.clear();
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
    wordSpans.highlightAt(event.charIndex);
  };
  const clear = () => {
    wordSpans.clear();
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
  ui.set((s) => ({ transcript: s.transcript.map((m) => (m.speaking === -1 ? m : { ...m, speaking: -1 })) }));
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

// ---------- surviving a reload ----------
// A phone browser may reload the page mid-call (to free memory, or after the screen was
// locked), which used to drop the whole conversation back to the setup screen. So the call
// is saved after every message and restored when the page loads again; End clears it.
const CALL_KEY = "call_snapshot";
const CALL_MAX_AGE = 3 * 60 * 60 * 1000; // an older call is not resumed
let callLog = []; // [{ you: text } | { reply, reply_translation, mood }] as shown

// ---------- saved chats ----------
// Every "Discuss a topic", free chat and interview call is also kept as a chat (what was
// said, and its topic or the subjects it covered), so it can be read or carried on later, and
// a new chat picks a topic, or brings up subjects, that no earlier chat has had.
// The words come from the speaking schedule as in any call: when a chat is reopened on a
// later day, it gets a fresh batch of the words that are due.
const CHATS_KEY = "topic_chats";
const MAX_CHATS = 20;
let chatId = null;
let chatStarted = 0;
let restoringCall = false; // while a saved call is put back, saving is paused

const TOPICS_KEY = "used_topics"; // every topic discussed, newest first, deleted chats' too
const SUBJECTS_KEY = "used_subjects"; // every subject of a free chat or interview, newest first
const MAX_SUBJECT_HINTS = 80; // the most recent ones the partner is told to leave alone
const topicChats = () => store.get(CHATS_KEY, []);
// Topics of the saved topic chats, newest first, then every other topic discussed and the last one used.
const recentTopics = () => [...new Set([...topicChats().map((c) => c.settings?.topic), ...store.get(TOPICS_KEY, []), store.get("last_topic", "")])].filter(Boolean);

function rememberTopic(topic) {
  store.set(TOPICS_KEY, [topic, ...store.get(TOPICS_KEY, []).filter((t) => t !== topic)].slice(0, 200));
}

// A subject the partner's latest question is about, added to this chat's (in order).
function noteSubject(subject) {
  const subjects = (state.settings.subjects ??= []);
  if (subject && !subjects.includes(subject)) subjects.push(subject);
}

// The chat's themes in order (see pickThemes), picked when it starts; a chat saved before
// themes existed gets them on its next turn.
function chatThemes(settings) {
  const mode = MODES[settings.request.mode];
  return (settings.themes ??= pickThemes(THEMES[mode?.themes] ?? THEMES.talk, store.get(SUBJECTS_KEY, [])));
}

// The free chat's, interview's, "Mein Leben" or story chat's subjects: earlier chats' to leave alone, this
// chat's own, and the next theme not had in this chat yet.
function subjectHints(current, themes = []) {
  const next = themeByName(themes.find((t) => !current.includes(t)));
  const covered = store.get(SUBJECTS_KEY, []).filter((s) => !current.includes(s) && s !== next?.name).slice(0, MAX_SUBJECT_HINTS);
  return { covered, current, next };
}

// A saved chat's title: its topic, or the kind of chat and its first subjects.
function chatTitle(settings) {
  if (settings.topic) return settings.topic;
  const kind = { interview: "Interview", life: "Mein Leben", story: "Erzähl mal" }[settings.request.mode] ?? "Free chat";
  const subjects = settings.subjects ?? [];
  return subjects.length ? `${kind}: ${subjects.slice(0, 3).join(", ")}` : kind;
}

// ---------- topic chats in the Vocab Trainer ----------
// The chats and the topics discussed are kept in the trainer's database too, so they are
// still there after the browser's storage is cleared, and on other devices. A chat goes up
// a few seconds after it last changed (or when the page is left); on load the trainer's
// chats are merged with this device's, the newer copy of each winning.
const CHATS_DELETED_KEY = "topic_chats_deleted"; // ids deleted here, until the trainer has deleted them too
const CHAT_UPLOAD_DELAY = 4000;
const unsentChats = new Set();
let chatUploadTimer = null;

function uploadChat(chat, { keepalive = false } = {}) {
  const link = trainerLink();
  if (!link) return;
  const body = JSON.stringify({
    topic: chat.topic,
    at: chat.at,
    mode: chat.settings?.request?.mode ?? "topic",
    subjects: chat.settings?.subjects ?? [],
    data: JSON.stringify(chat),
  });
  fetch(`${link.api}/api/talkloop/chats/${encodeURIComponent(chat.id)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${link.token}`, "Content-Type": "application/json" },
    body,
    keepalive: keepalive && body.length < 60_000,
  }).catch(() => {}); // offline: the next load sends it (it is newer than the trainer's copy)
}

function queueChatUpload(id) {
  unsentChats.add(id);
  clearTimeout(chatUploadTimer);
  chatUploadTimer = setTimeout(flushChatUploads, CHAT_UPLOAD_DELAY);
}

function flushChatUploads({ keepalive = false } = {}) {
  clearTimeout(chatUploadTimer);
  const chats = topicChats();
  for (const id of unsentChats) {
    const chat = chats.find((c) => c.id === id);
    if (chat) uploadChat(chat, { keepalive });
  }
  unsentChats.clear();
}

function deleteChatInTrainer(id) {
  const link = trainerLink();
  if (!link) return;
  fetch(`${link.api}/api/talkloop/chats/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${link.token}` },
  })
    .then((res) => {
      if (res.ok) store.set(CHATS_DELETED_KEY, store.get(CHATS_DELETED_KEY, []).filter((d) => d !== id));
    })
    .catch(() => {});
}

async function syncChats() {
  const link = trainerLink();
  if (!link) return;
  const res = await fetch(`${link.api}/api/talkloop/chats`, { headers: { Authorization: `Bearer ${link.token}` } });
  if (!res.ok) return;
  const { chats: remote = [], topics = [], subjects = [] } = await res.json();
  const deleted = store.get(CHATS_DELETED_KEY, []);
  const local = topicChats();
  const byId = new Map(local.map((c) => [c.id, c]));
  for (const r of remote) {
    if (deleted.includes(r.id)) continue;
    let chat;
    try { chat = JSON.parse(r.data); } catch { continue; }
    if (!byId.has(r.id) || r.at > byId.get(r.id).at) byId.set(r.id, { ...chat, id: r.id, topic: r.topic, at: r.at });
  }
  // What only this device has, or has newer (chats from before this sync existed too), goes up.
  const remoteAt = new Map(remote.map((r) => [r.id, r.at]));
  for (const chat of local) if (!(remoteAt.get(chat.id) >= chat.at)) uploadChat(chat);
  deleted.forEach(deleteChatInTrainer);
  store.set(CHATS_KEY, [...byId.values()].sort((a, b) => b.at - a.at).slice(0, MAX_CHATS));
  store.set(TOPICS_KEY, [...new Set([...store.get(TOPICS_KEY, []), ...topics])].slice(0, 200));
  store.set(SUBJECTS_KEY, [...new Set([...store.get(SUBJECTS_KEY, []), ...subjects])].slice(0, 300));
  renderChats();
}

function saveCall() {
  if (!state.settings || restoringCall) return;
  const snap = {
    at: Date.now(),
    chatId,
    started: chatStarted,
    settings: state.settings,
    history: state.history,
    rapport: state.rapport,
    log: callLog,
    // Only the next few waiting words: the rest would make every save large.
    today: todayWords ? { ...todayWords, waiting: todayWords.waiting.slice(0, 50) } : null,
  };
  store.set(CALL_KEY, snap);
  if (chatId && callLog.length) {
    const chats = topicChats().filter((c) => c.id !== chatId);
    chats.unshift({ ...snap, id: chatId, topic: chatTitle(state.settings) });
    // This chat's subjects count as talked about from now on (the trainer keeps them too).
    const current = state.settings.subjects ?? [];
    if (current.length) store.set(SUBJECTS_KEY, [...new Set([...[...current].reverse(), ...store.get(SUBJECTS_KEY, [])])].slice(0, 300));
    store.set(CHATS_KEY, chats.slice(0, MAX_CHATS));
    queueChatUpload(chatId);
  }
}

// Puts a saved call back on screen: after a page reload, or when a chat is reopened.
async function resumeCall(snap, { note, refreshWords = false } = {}) {
  restoringCall = true;
  try {
    state.settings = snap.settings;
    state.history = snap.history ?? [];
    state.rapport = snap.rapport ?? 0;
    chatId = snap.chatId ?? snap.id ?? null;
    chatStarted = snap.started ?? snap.at;
    state.autoSend = true; // each chat starts on auto-send (the switch in the call changes it for that chat only)
    ui.set({ autoSend: true });
    todayWords = snap.today ?? null;
    callLog = [];
    const { vocab } = state.settings;
    let learnt = null;
    if (vocab?.enabled) {
      learnt = vocab.learnt ? ((await idbGet("learnt_words").catch(() => null)) ?? []) : null;
      await loadVocabForSession(vocab.levels, learnt).catch(() => 0);
    }
    // A chat reopened on a later day: the schedule has moved on, so today's words are picked again.
    if (refreshWords && learnt && localDay(snap.at) !== localDay()) {
      pickTodayWords(learnt.filter((w) => vocab.levels.includes(w.level)));
    }
    ui.merge("view", { setup: false, keygate: false });
    enterCall();
    if (todayWords?.situation) ui.merge("call", { mode: `Sentence drill · ${todayWords.situation}` });
    for (const entry of snap.log) {
      if ("you" in entry) addLearnerMessage(entry.you);
      else addCharacterMessage(entry, { silent: true });
    }
  } finally {
    restoringCall = false;
  }
  saveCall();
  renderStats();
  renderFocusWords([]);
  // The panel as it was (saved with the call); a call from before it existed gets one now.
  if (!MODES[state.settings.request.mode]?.office) prepareTopicWords(state.settings);
  else renderTopicWords();
  setStatus(note);
}

async function restoreCall() {
  const snap = store.get(CALL_KEY, null);
  if (!snap?.settings || !snap.log?.length || Date.now() - snap.at > CALL_MAX_AGE || !providerReady()) return;
  const nav = performance.getEntriesByType?.("navigation")[0]?.type ?? "?";
  debugLog(`restoring the call (page ${nav}${document.wasDiscarded ? ", discarded" : ""})`);
  store.set("last_restore", { at: Date.now(), nav, discarded: Boolean(document.wasDiscarded) });
  if (MODES[snap.settings.request?.mode]?.office) { // the Büro carries on: the next colleague comes by later
    await resumeCall(snap, { note: "" });
    getAudioCtx()?.resume();
    officeScheduleNext();
    return;
  }
  await resumeCall(snap, { note: snap.settings.live
    ? "Your live call is back after the page reloaded. Tap 🎤 to reconnect."
    : "Your conversation is back after the page reloaded. Tap the mic or type to go on." });
}

async function openChat(id) {
  const chat = topicChats().find((c) => c.id === id);
  if (!chat) return;
  clearLiveHandle(); // the saved handle is the last call's, not this chat's
  await resumeCall(chat, { note: "Chat reopened. Tap the mic or type to go on.", refreshWords: true });
}

function deleteChat(id) {
  store.set(CHATS_KEY, topicChats().filter((c) => c.id !== id));
  unsentChats.delete(id);
  store.set(CHATS_DELETED_KEY, [...store.get(CHATS_DELETED_KEY, []), id]);
  deleteChatInTrainer(id);
  renderChats();
}

// The list on the setup screen, newest first.
// The list on the setup screen (components/Chats.jsx reads topicChats()).
function renderChats() {
  ui.bump("chatsVersion");
}

// A reply's translation, for one that came without (a Gemini Live call speaks, it writes none).
async function translateReply(text) {
  const { language, nativeLanguage } = state.settings.request;
  const raw = await aiJson({
    systemInstruction: `You translate ${language} into ${nativeLanguage}, naturally and briefly.`,
    schema: { type: "OBJECT", properties: { translation: { type: "STRING" } }, required: ["translation"] },
    contents: [{ role: "user", parts: [{ text: `Translate into ${nativeLanguage}: ${JSON.stringify(text)}` }] }],
    temperature: 0.2,
  });
  return typeof raw?.translation === "string" ? raw.translation : "";
}

const messageEntries = new Map(); // message id -> its callLog entry (Translate keeps the translation with the call)
function addCharacterMessage(turn, { silent = false } = {}) {
  const entry = { reply: turn.reply, reply_translation: turn.reply_translation, mood: turn.mood };
  // A scene's opening line says how this call goes (what is ordered, what the problem is):
  // kept, so the next call in this scene goes differently.
  if (MODES[state.settings?.request?.mode]?.usesScene && !restoringCall && turn.reply && !callLog.some((e) => "reply" in e)) {
    noteUsed(`scene-${state.settings.request.scenario}`, turn.reply.slice(0, 200));
  }
  callLog.push(entry);
  saveCall();
  const id = addMessage({
    kind: "character",
    who: state.settings.characterName,
    text: turn.reply,
    translation: turn.reply_translation ?? "",
    showTranslation: false,
    translating: false,
    mood: turn.mood,
  });
  messageEntries.set(id, entry);
  const spans = new WordTrack(id, turn.reply);
  scrollCallToBottom();
  if (silent) return; // restored after a reload: shown, not spoken again
  // A reply that arrives while the call is paused is spoken on resume.
  if (state.paused) {
    pendingReply = { text: turn.reply, spans, mood: turn.mood };
    return;
  }
  // When hands-free, start listening again once the character finishes speaking.
  speak(turn.reply, spans, () => maybeResumeListening(), turn.mood);
}

// ▶ Replay under a reply.
function replayMessage(id) {
  const m = ui.get().transcript.find((x) => x.id === id);
  if (m) speak(m.text, new WordTrack(id, m.text), null, m.mood);
}

// Translate under a reply: translated on the first tap and kept with the call; later taps
// show or hide it.
async function translateMessage(id) {
  const m = ui.get().transcript.find((x) => x.id === id);
  if (!m || m.translating) return;
  if (m.showTranslation || m.translation) {
    updateMessage(id, { showTranslation: !m.showTranslation });
    return;
  }
  updateMessage(id, { translating: true });
  try {
    const translation = await translateReply(m.text);
    const entry = messageEntries.get(id);
    if (entry) entry.reply_translation = translation;
    updateMessage(id, { translation, showTranslation: Boolean(translation) });
    saveCall();
  } catch (error) {
    debugLog(`translate: ${error.message}`);
  }
  updateMessage(id, { translating: false });
}

function maybeResumeListening() {
  if (state.handsFree && !state.finished && !state.paused && !recognizer) {
    startListening();
  }
}

function addLearnerMessage(text) {
  callLog.push({ you: text });
  saveCall();
  addMessage({ kind: "learner", who: "You", text });
  scrollCallToBottom();
}

function renderCoach(coach) {
  if (!coach.correction && !coach.tip && coach.understood) {
    ui.set({ coach: null });
    return;
  }
  ui.set({ coach: { understood: coach.understood, correction: coach.correction ?? "", tip: coach.tip ?? "", notes: [], expanded: false } });
}

// Run handler on a tap without taking focus from the text box. A button would otherwise
// blur it, and on phones that drops the keyboard and reflows the dock mid-tap. iOS decides
// that at the touch level, so the tap is handled on touchend with its default prevented
// (which also cancels the synthesized click). A touch that moved is a scroll (of the chip
// row or the transcript) and a long press is text selection, so neither counts as a tap.
// click covers mouse and keyboard activation, unless the button submits the form, whose
// submit handler covers those instead. selectable keeps text selectable with the mouse.

// Put a suggestion into the text box, ready to edit or send, with the caret at the end.
// The keyboard is only kept up if it already was: a suggestion never pops it open.
function useSuggestion(text) {
  const input = refs.text;
  if (!input) return;
  input.value = text;
  if (!document.body.classList.contains("typing")) return;
  input.focus();
  try { input.setSelectionRange(text.length, text.length); } catch { /* unsupported */ }
}

function renderSuggestions(suggestions) {
  ui.set({ suggestions: [...(suggestions ?? [])] });
}

function renderFocusWords(words) {
  if (todayWords) {
    renderTodayWords();
    return;
  }
  if (!words || !words.length) {
    ui.set({ focus: null });
    return;
  }
  ui.set({
    focus: {
      label: state.settings?.vocab?.learnt ? "Your words: " : "Practising: ",
      today: false,
      words: words.map((w) => ({ key: w.de, text: w.de, title: w.en, cls: "" })),
    },
  });
}

// Today's words as their English cue: the learner recalls the German. A tap shows it
// (and counts as a miss); a word used shows ✓ (right) or ! (try again).
function renderTodayWords() {
  const { active, status } = todayWords;
  if (!active.length) {
    ui.set({ focus: null });
    return;
  }
  // The word being asked for comes first, highlighted, and shows only its cue (even if said
  // before), so it is recalled again rather than read off the chip.
  const current = todayWords.current;
  const words = [...active].sort((a, b) => (b.de === current) - (a.de === current)).map((w) => {
    const s = status[w.de];
    const isCurrent = w.de === current;
    const mark = s?.correct ? "✓ " : s?.wrong ? "! " : "";
    return {
      key: w.de,
      text: mark + (s?.peeked || (s?.correct && !isCurrent) ? `${w.en} = ${w.de}` : w.en || w.de),
      title: s?.peeked ? w.de : "Tap to see the German",
      cls: (s?.correct ? " said" : s?.wrong ? " tried" : "") + (isCurrent ? " current" : ""),
    };
  });
  ui.set({ focus: { label: "Say: ", today: true, words } });
}

// A tap on one of today's words shows its German (and counts as a miss).
function peekWord(de) {
  if (!todayWords) return;
  peekTodayWord(de);
  renderTodayWords();
}

// Small note under a message saying the browser voice played, and why (empty clears it).
let lastVoiceNote = ""; // the reason last shown under a reply; it is only shown again when it changes
function noteVoice(wordSpans, text) {
  const id = wordSpans?.id;
  if (id == null) return;
  if (!text) {
    updateMessage(id, { voiceNote: "" });
    return;
  }
  if (text === lastVoiceNote) return; // the same reason again: no need under every reply
  lastVoiceNote = text;
  updateMessage(id, { voiceNote: text });
}

function setStatus(text) {
  ui.set({ status: text ?? "" });
}

function setBusy(busy) {
  state.busy = busy;
  // Only the buttons are disabled while a reply loads, so a second turn can't be fired
  // mid-reply. The text box stays enabled (and focused) so the keyboard — and the compact
  // typing layout — don't collapse, and the learner can start composing their next turn.
  // It's only locked once the scene is finished or the call is on hold.
  ui.set({ composer: { buttonsDisabled: busy || state.finished || state.paused, textDisabled: state.finished || state.paused } });
  updateCallState();
}

// ---------- call screen ----------
// Scroll to the end of the call, but never past the start of the latest reply: with the
// keyboard up there's room for only a few lines, and the question being answered should
// read from its first line rather than be pushed off the top by the coach below it.
function scrollCallToBottom() {
  requestAnimationFrame(() => {
    const box = refs.callScroll;
    if (!box) return;
    let top = box.scrollHeight - box.clientHeight;
    const reply = [...box.querySelectorAll(".msg.character")].at(-1);
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
  else if (live) {
    key = !live.ready ? "thinking" : live.speaking ? "speaking" : live.muted ? "idle" : "listening";
    text = !live.ready ? "Connecting…" : live.speaking ? "Speaking…" : live.muted ? "Muted" : "Live — just talk";
    if (live.ready && !live.speaking && !live.muted && state.drill) { key = "drill"; text = "Say it again"; }
  }
  else if (isOffice()) { key = "idle"; text = "Working… 💻"; }
  else if (state.busy) { key = "thinking"; text = "Thinking…"; }
  else if (state.speaking) { key = "speaking"; text = "Speaking…"; }
  else if (recognizer) { key = "listening"; text = "Listening…"; }
  else if (state.drill) { key = "drill"; text = "Say it again"; }
  ui.merge("call", { state: key, stateText: text });
  officeSceneUpdate();
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
  ui.merge("call", { timer: hh ? `${hh}:${mmss}` : mmss });
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
  // A live call stays connected while paused: the mic sends nothing and the voice stops.
  if (live) {
    live.muted = paused;
    if (paused) liveStopVoice();
    byVoice = false;
  }
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
    // The live call dropped while on hold: carry it on (Gemini still has it, with its handle).
    if (state.settings?.live && !live && (!isOffice() || officeVisitAt)) startLive(); // the Büro between visits stays quiet
    const reply = pendingReply;
    pendingReply = null;
    // The browser allows one recognizer at a time: let the resume listener stop first.
    stopWakeListener().then(() => {
      if (state.paused) return;
      if (reply) speak(reply.text, reply.spans, () => maybeResumeListening(), reply.mood);
      else maybeResumeListening();
    });
  }
  ui.merge("pause", { on: paused });
  ui.merge("mic", { disabled: paused });
  setBusy(state.busy);
}

function enterCall() {
  const { request, characterName } = state.settings;
  const mode = MODES[request.mode] ?? MODES.scene;
  const tense = TENSES[request.tense];
  const sceneLabel = (SCENE_OPTIONS.flatMap((g) => g.options).find((o) => o.value === request.scenario)?.label ?? "").split(" — ")[0];
  // The topic being discussed, under the name (also after a reload: it is part of the saved call).
  // A role card is shown the same way, in full from the start (the learner needs all of it).
  const topic = state.settings.topic ?? "";
  const card = state.settings.roleCard ?? "";
  // A connector drill on one connector shows it with its rule (one line on a phone; a tap shows all).
  const one = mode.joiner && state.settings.connectors?.length === 1 ? state.settings.connectors[0] : null;
  const connector = one ? `„${one.name}“ (${one.en}) — ${one.rule}` : "";
  ui.merge("call", {
    avatar: characterName.split(" ").at(-1).charAt(0), // "Dr. Weber" -> W
    name: characterName,
    mode: (mode.usesScene ? `${sceneLabel} · ${request.language}` : `${mode.label.split(" — ")[0]} · ${request.language}`) + (tense ? ` · ${tense.short}` : ""),
    topic: topic ? `Topic: ${topic}` : card ? `You are: ${card}` : connector,
    topicOpen: Boolean(card), // on a phone it is one line; a tap shows all of it
  });
  renderSayThis();
  officeSceneShow(Boolean(mode.office));
  lastVoiceNote = "";
  document.body.classList.add("in-call");
  ui.merge("view", { call: true });
  startCallTimer();
  updateCallState();
}




function leaveCall() {
  officeSceneShow(false);
  clearInterval(callTimer);
  callTimer = null;
  document.body.classList.remove("in-call");
  ui.merge("view", { call: false });
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

// ---------- live voice (Gemini Live) ----------
// With "Live voice" ticked, the call is a real one: Gemini hears the learner's voice and
// answers in its own, over one WebSocket (the Live API), so a reply starts in about a second
// and the learner can interrupt it. Nothing waits for a JSON turn: the coach checks each
// sentence on the side (liveCoach, with the conversation AI and LanguageTool) and its
// correction shows up under the call. It needs the Gemini key; Google's free tier covers it.
const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const LIVE_MODEL_KEY = "live_model"; // { name, at, key }: the model found for this key, for a day
const LIVE_PREFERRED = /gemini-3\.8[^/]*live/; // Gemini 3.8 Live, whenever the key has it
// The key for live calls: the Gemini 3.8 Live key, else the ordinary Gemini key.
const liveKey = () => getKey("geminiLive") || getKey("gemini");
const LIVE_IN_RATE = 16000; // what the Live API wants from the mic: 16-bit PCM, mono
const LIVE_CHUNK = 1600; // 100 ms of mic audio per message
const LIVE_RECAP = 30; // lines of the call sent again when it reconnects without a resumption handle
// Gemini keeps a live call's conversation on its side and hands out a resumption handle for it.
// A paused call's socket sits idle, and a phone in the background drops it: reconnecting with
// the handle carries on the same conversation, with all it knows, instead of starting over from
// a short recap. Google keeps a handle for about two hours; it is saved with the current call
// only (a new call or a reopened chat clears it), so a reload can use it too.
const LIVE_HANDLE_KEY = "live_handle"; // { handle, at }
const LIVE_HANDLE_AGE = 2 * 60 * 60 * 1000;
const liveHandle = () => {
  const saved = store.get(LIVE_HANDLE_KEY, null);
  return saved?.handle && Date.now() - saved.at < LIVE_HANDLE_AGE ? saved.handle : null;
};
const clearLiveHandle = () => store.set(LIVE_HANDLE_KEY, null);
// Hands the mic's samples from the audio thread to the page.
const LIVE_WORKLET = `class LiveTap extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; if (ch) this.port.postMessage(ch.slice(0)); return true; }
}
registerProcessor("live-tap", LiveTap);`;

const liveVoiceOn = () => store.get("live_voice", false);

// The Live model this key can use: Gemini 3.8 Live if the key has it, else the newest one
// that takes a live (bidi) session. Model names change often, so they are looked up rather
// than written here.
async function liveModel(key) {
  const saved = store.get(LIVE_MODEL_KEY, null);
  if (saved?.name && saved.key === key.slice(-6) && Date.now() - saved.at < 86_400_000) return saved.name;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(`Gemini didn't list its models (${res.status}): check the Gemini 3.8 Live key.`);
  const models = ((await res.json()).models ?? []).filter((m) => m.supportedGenerationMethods?.includes("bidiGenerateContent"));
  const version = (name) => Number(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
  const rank = (name) => (LIVE_PREFERRED.test(name) ? 1000 : 0) + version(name) * 10 + (/native-audio|live/.test(name) ? 1 : 0);
  const best = models.map((m) => m.name).sort((a, b) => rank(b) - rank(a))[0];
  if (!best) throw new Error("This Gemini key has no live voice model.");
  if (!LIVE_PREFERRED.test(best)) debugLog(`no Gemini 3.8 Live for this key: using ${best}`);
  store.set(LIVE_MODEL_KEY, { name: best, at: Date.now(), key: key.slice(-6) });
  return best;
}

// The connector drill's tasks from earlier calls, never to be given again.
function connectorTasksLine() {
  const line = usedLine("connector-tasks", 30, "Tasks given in earlier drills, never again (new sentences on new everyday subjects)");
  return line ? ` ${line}` : "";
}

// How earlier calls in this scene opened, so this one goes differently.
function sceneVariety(scenario) {
  const line = usedLine(`scene-${scenario}`, 6, "Earlier calls in this scene opened like this");
  return line ? [`${line} Make this call go differently: another request, item, detail or small problem, and open with other words.`] : [];
}

// A live free chat's subjects: earlier calls' to leave alone, this call's own so far.
function liveSubjectLines(settings, m) {
  const hints = subjectHints(settings.subjects ?? [], m.themes ? chatThemes(settings) : []);
  const quote = (list) => list.map((s) => JSON.stringify(s)).join(", ");
  const lines = [];
  if (hints.covered.length) lines.push(`Talked about in earlier calls, so never bring these up yourself (follow the learner if they do): ${quote(hints.covered)}.`);
  if (hints.current.length) lines.push(`Already talked about in this call: ${quote(hints.current)}; when the current subject runs dry, move on to a new one, not back to one of these.`);
  return lines;
}

// A live call has no subject field, so every few turns (and when it ends) the AI names the
// subjects talked about from the transcript. They go into the chat's subjects like a
// turn-based chat's: saved with it in the trainer, left alone by the next calls, and the
// topic-words panel follows the latest one.
const LIVE_SUBJECTS_EVERY = 6; // learner turns
const LIVE_SUBJECTS_SCHEMA = {
  type: "OBJECT",
  properties: { subjects: { type: "ARRAY", items: { type: "STRING" } } },
  required: ["subjects"],
};

async function liveSubjectsFrom(conversation, known) {
  const raw = await aiJson({
    systemInstruction: `Name the subjects talked about in this part of a language-practice conversation, in the order they came up: each in two to four English words (e.g. "weekend plans", "his new job"), at most five, only real subjects (no greetings or small talk). Where one is the same as a subject already known, write it exactly as known.`,
    schema: LIVE_SUBJECTS_SCHEMA,
    contents: [{ role: "user", parts: [{ text: `${known.length ? `Subjects already known: ${known.map((s) => JSON.stringify(s)).join(", ")}\n` : ""}Conversation:\n${conversation}` }] }],
    temperature: 0.2,
  });
  return [...new Set((Array.isArray(raw?.subjects) ? raw.subjects : []).map((s) => String(s).trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, 5);
}

function noteLiveSubjects() {
  const settings = state.settings;
  const id = chatId;
  if (!settings?.live || !id || !MODES[settings.request.mode]?.subjects || MODES[settings.request.mode]?.office) return;
  if (callLog.filter((e) => "you" in e).length < 2) return; // too short to have a subject
  const conversation = recentConversation(14);
  liveSubjectsFrom(conversation, settings.subjects ?? [])
    .then((subjects) => {
      if (!subjects.length) return;
      if (state.settings === settings) { // still in the call
        subjects.forEach(noteSubject);
        saveCall();
        prepareTopicWords();
        return;
      }
      // The call has ended meanwhile: its saved chat gets them.
      const chats = topicChats();
      const chat = chats.find((c) => c.id === id);
      if (!chat?.settings) return;
      const current = (chat.settings.subjects ??= []);
      for (const s of subjects) if (!current.includes(s)) current.push(s);
      chat.topic = chatTitle(chat.settings);
      store.set(CHATS_KEY, chats);
      store.set(SUBJECTS_KEY, [...new Set([...[...subjects].reverse(), ...store.get(SUBJECTS_KEY, [])])].slice(0, 300));
      queueChatUpload(id);
    })
    .catch((error) => debugLog(`live call: no subjects (${error.message})`));
}

// The partner's instructions for a spoken call: as turnSystemPrompt, without its JSON fields.
const LIVE_DRILLS = {
  interpret: ({ language, nativeLanguage }) => ({
    extra: `This is an interpreter drill. Each turn, say one short everyday sentence in ${nativeLanguage} for the learner to say in ${language}, a new situation each time. Check their version: if it is wrong, say the correct ${language} sentence once, then give the next one. Keep your own words very short, so they do the talking. Never stop giving sentences.${sentencesGiven({}).length ? ` Given in earlier drills, never again: ${sentencesGiven({}).slice(0, 30).map((g) => JSON.stringify(g)).join(" ")}.` : ""}`,
    opener: "(Start the interpreter drill: say in one short sentence what you will do, then give the first sentence.)",
  }),
  connectors: ({ language }, settings) => ({
    extra: `This is a connector drill. ${connectorsLine(settings.connectors ?? [])} Each turn, say the task aloud: "Verbinde mit" and the connector, then two short everyday ${language} sentences that make sense joined with it, something new each time. The learner says them as one sentence. Check the connector and the word order: if it is wrong, say the correct sentence and the rule in a few words; if it is right, praise it in two or three words. Then give the next task at once. Never stop giving tasks and never ask whether they want to go on.${connectorTasksLine()}`,
    opener: "(Start the connector drill: say in one short sentence what you will do, then give the first task.)",
  }),
};

function liveSystemPrompt(settings, recap = []) {
  const { language, nativeLanguage, level, scenario, mode, tense } = settings.request;
  const m = MODES[mode] ?? MODES.scene;
  const persona = personaFor({ scenario, mode });
  const drill = LIVE_DRILLS[mode]?.(settings.request, settings);
  const extra = drill?.extra ?? m.extra
    .replace(/Never end: always set conversation_finished to false\./g, "Never end the conversation yourself.")
    .replace(/Set conversation_finished to true only once/g, "Close the scene only once");
  const lines = [
    `You are ${persona.character}, ${persona.setting}. This is a live voice call: speak only ${language}, like a real person on the phone, in short natural sentences with small reactions (Mhm, Ach so!, Echt?), and let the learner do most of the talking.`,
    `Learner: ${language} at CEFR ${level}, native ${nativeLanguage}. Speak at their level.${LEVEL_GUIDE[level] ? ` At ${level}: ${LEVEL_GUIDE[level]}` : ""}`,
    extra,
    ...(m.usesScene && persona.goal ? [`Scene goal: ${persona.goal}`] : []),
    ...(m.usesScene ? sceneVariety(scenario) : []),
    ...(settings.topic ? [`Today's topic: "${settings.topic}". Stay on it.`] : []),
    ...(m.themes && settings.subjects?.length ? [`Start with ${themeByName(settings.subjects[0])?.ask ?? settings.subjects[0]}.`] : []),
    ...(m.subjects && !m.office ? liveSubjectLines(settings, m) : []),
    ...(settings.roleCard ? [`The learner's role card (they play this person): ${settings.roleCard}.`] : []),
    "The learner may pause to think: wait for them.",
    "A message in brackets starting \"(Coach, not the learner:\" comes from the learning app: do what it says, in your own voice and in character, and never mention a coach or an app.",
    // A drill says its corrections out loud; a conversation only recasts, like a native speaker would.
    ...(settings.sayAgain
      // Say it again: Gemini runs it in its one reply, so a correction never costs a second answer.
      ? ["If their sentence has a real grammar or word-choice mistake (not pronunciation), don't answer it yet: say the correct sentence and briefly ask them to say it once more. When they repeat it, judge it yourself: if it's right (ignore small pronunciation slips), praise it in two or three words and answer it as you normally would; if not, say what's still wrong in a few words, say the correct sentence again and let them try once more. After two misses, just carry on."]
      : drill ? [] : ["If they make a mistake, repeat the right form naturally in your answer, like a friendly native speaker would, without a grammar lesson: the app shows written corrections itself."]),
  ];
  const t = TENSES[tense];
  if (t) lines.push(`Tense practice: ${t.form}. Use it yourself and ask things whose natural answer needs it (about ${t.ask}).`);
  const weak = recurringMistakes(language);
  if (weak.length) lines.push(`The learner's recurring mistakes: ${weak.map((w) => MISTAKE_TYPES[w.type]).join("; ")}. Now and then ask something whose natural answer needs one of these; never say you're testing.`);
  lines.push(...liveVocabLines(settings, m));
  if (recap.length) lines.push(`The call was cut off and has just reconnected. The end of it so far:\n${recap.join("\n")}\nCarry on from there in one short line, without greeting again.`);
  return lines.join("\n");
}

// "Weave my vocab into the conversation" for a live call. The instructions are sent once,
// when the call connects (a turn-based call gets a new list every turn), so the partner gets
// a longer list to draw on; a reconnect brings the next words.
const LIVE_VOCAB_WORDS = 20;

function liveVocabLines(settings, m) {
  if (!settings.vocab?.enabled || m.drill || m.joiner) return [];
  const fmt = (w) => (w.en ? `${w.de} (${w.en})` : w.de);
  const today = todayWords?.active ?? [];
  const todaySet = new Set(today.map((w) => w.de));
  // With topic words (see prepareTopicWords), only those: they fit the conversation.
  if (settings.topicWords) {
    const lines = topicWordLines(settings, { live: true });
    if (today.length) lines.push(`Today's words, which the learner must recall and say: ${today.map(fmt).join("; ")}. Only where one is the natural thing to say on the current subject, ask a question whose answer needs it. Never say, translate or hint at one before they have said it.`);
    return lines;
  }
  const words = nextVocabBatch(LIVE_VOCAB_WORDS).filter((w) => !todaySet.has(w.de));
  const lines = [];
  if (words.length) {
    lines.push(`${settings.vocab.learnt ? "Words the learner knows and should practise saying" : "Vocabulary being practised"}: ${words.map(fmt).join("; ")}. Conversation first: stay on topic and bring these in only where they fit naturally, a few at a time over the call${m.subjects ? `; never change the subject to bring one in. ${SUBJECTS_NOT_FROM_WORDS}` : ""}; use them yourself and ask questions whose natural answer needs one. Never list or quiz them.`);
  }
  if (today.length) {
    lines.push(`Today's words, which the learner must recall and say: ${today.map(fmt).join("; ")}. Over the call, get them to say each one, one at a time, with a question on the current topic whose natural answer needs it${m.subjects ? ", only where one fits it" : ""}. Never say, translate or hint at one before they have said it.`);
  }
  return lines;
}

function liveOpener(settings) {
  const m = MODES[settings.request.mode] ?? MODES.scene;
  if (m.office) return "(You are now standing at the learner's desk. Get their attention and ask whether they have a moment, in one short line, and then wait for their answer.)";
  const drill = LIVE_DRILLS[settings.request.mode]?.(settings.request, settings);
  if (drill) return drill.opener;
  if (m.topics) return m.opener(settings.topic ?? "");
  if (m.themes) return m.opener(themeByName(chatThemes(settings)[0]));
  return typeof m.opener === "string" ? m.opener : "(Greet the learner and start.)";
}

function liveSend(message) {
  if (live?.ws?.readyState === WebSocket.OPEN) live.ws.send(JSON.stringify(message));
}

function bytesToBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// The mic's samples, at the audio context's rate, down to 16 kHz 16-bit PCM in 100 ms messages.
function liveMicSamples(samples, rate) {
  if (live?.muted && live.talking) { // muted or paused mid-sentence: end the stream there
    live.talking = false;
    liveSend({ realtimeInput: { audioStreamEnd: true } });
  }
  if (!live || live.muted || !live.ready) return;
  const step = rate / LIVE_IN_RATE;
  let pos = live.micPos;
  for (; pos < samples.length; pos += step) {
    const v = Math.max(-1, Math.min(1, samples[Math.floor(pos)]));
    live.micBuf[live.micLen++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    if (live.micLen === LIVE_CHUNK) {
      liveGate(new Int16Array(live.micBuf));
      live.micLen = 0;
    }
  }
  live.micPos = pos - samples.length; // where the next block's first sample falls
}

// Only speech goes to Gemini: the Live API bills every second of audio it is sent, silence
// included, so while the learner says nothing (thinking, working, listening) nothing is sent.
// A chunk counts as speech when it is clearly louder than the room's noise floor. The 300 ms
// before it go too (so the first sound isn't cut off), and 1.2 s after it (so Gemini hears the
// pause and answers); then audioStreamEnd tells Gemini the stream has stopped.
const LIVE_PREROLL = 3; // chunks (100 ms each) sent from just before speech starts
const LIVE_HANGOVER = 15; // chunks still sent after the last loud one (a short thinking pause)
const LIVE_MIN_LEVEL = 0.006;
const LIVE_BARGE_IN_LEVEL = 0.04; // the same, while Gemini is speaking // RMS (0–1) below which nothing counts as speech, however quiet the room

function liveGate(chunk) {
  let sum = 0;
  for (const v of chunk) sum += v * v;
  const rms = Math.sqrt(sum / chunk.length) / 0x8000;
  live.micTotal++;
  // The noise floor follows quiet stretches quickly and loud ones only slowly. It stays put while
  // Gemini speaks: what's left of its voice after echo cancellation would raise it, and the
  // learner's answer right after would then pass for silence.
  if (!live.speaking) live.floor = live.floor == null ? rms : rms < live.floor ? live.floor * 0.7 + rms * 0.3 : live.floor * 0.995 + rms * 0.005;
  const send = (c) => {
    liveSend({ realtimeInput: { audio: { data: bytesToBase64(new Uint8Array(c.buffer)), mimeType: `audio/pcm;rate=${LIVE_IN_RATE}` } } });
    live.micSent++;
  };
  // While Gemini speaks, only a clearly raised voice counts (the learner cutting in), not the
  // remains of Gemini's own voice in the mic.
  const level = live.speaking ? LIVE_BARGE_IN_LEVEL : LIVE_MIN_LEVEL;
  if (rms > Math.max(level, (live.floor ?? 0) * 2.5)) {
    live.activeAt = Date.now(); // the learner is talking (the Büro doesn't wait for Gemini's transcript)
    if (!live.talking) {
      live.talking = true;
      officeSceneUpdate();
      live.preroll.forEach(send);
      live.preroll = [];
    }
    live.quiet = 0;
    send(chunk);
  } else if (live.talking) {
    send(chunk);
    if (++live.quiet >= LIVE_HANGOVER) {
      live.talking = false;
      officeSceneUpdate();
      liveSend({ realtimeInput: { audioStreamEnd: true } });
    }
  } else {
    live.preroll.push(chunk);
    if (live.preroll.length > LIVE_PREROLL) live.preroll.shift();
  }
}

// Gemini's voice goes out through an analyser: how loud it is right now moves the Büro
// colleague's mouth.
let liveOut = null; // { ctx, node, analyser, buf }
function liveOutput(ctx) {
  if (liveOut?.ctx !== ctx) {
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.connect(ctx.destination);
    liveOut = { ctx, node: analyser, analyser, buf: new Float32Array(analyser.fftSize) };
  }
  return liveOut.node;
}
function liveVoiceLevel() {
  if (!liveOut) return 0;
  liveOut.analyser.getFloatTimeDomainData(liveOut.buf);
  let sum = 0;
  for (const v of liveOut.buf) sum += v * v;
  return Math.min(1, Math.sqrt(sum / liveOut.buf.length) * 4);
}

// Gemini's voice, played gap-free as its chunks arrive.
function livePlay(b64, mimeType) {
  const ctx = getAudioCtx();
  const rate = Number(mimeType?.match(/rate=(\d+)/)?.[1] ?? 24000);
  const pcm = new Int16Array(base64ToBytes(b64).buffer);
  const buffer = ctx.createBuffer(1, pcm.length, rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) data[i] = pcm[i] / 0x8000;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(liveOutput(ctx));
  const at = Math.max(ctx.currentTime + 0.04, live.playHead);
  src.start(at);
  live.playHead = at + buffer.duration;
  live.sources.add(src);
  live.speaking = true;
  updateCallState();
  src.onended = () => {
    live?.sources.delete(src);
    if (live && !live.sources.size) { live.speaking = false; live.activeAt = Date.now(); updateCallState(); }
  };
}

function liveStopVoice() {
  if (!live) return;
  for (const src of live.sources) { try { src.stop(); } catch { /* already ended */ } }
  live.sources.clear();
  live.playHead = 0;
  live.speaking = false;
  updateCallState();
}

// What the learner said, as Gemini heard it: shown, saved and checked once their turn is over.
function liveFlushLearner() {
  const said = live?.heard.trim();
  if (!said) return;
  live.heard = "";
  setStatus("");
  addLearnerMessage(said);
  state.history.push({ role: "user", content: said });
  markTopicWords(said);
  live.learnerTurns = (live.learnerTurns ?? 0) + 1;
  if (live.learnerTurns % LIVE_SUBJECTS_EVERY === 0) noteLiveSubjects();
  if (state.drill?.live) liveDrillAttempt(said);
  else liveCoach(said, live.lastReply ?? "");
}

// Say it again in a live call: Gemini asks for the corrected sentence in its own voice, and the
// learner's next sentence (as Gemini heard it, or typed) is checked against it, not coached.
function startLiveDrill(said, correction) {
  state.drill = { target: correction.trim(), said, turn: null, live: true };
  ui.set({ drill: { target: state.drill.target, lang: state.settings.locale, feedback: "", ok: false } });
  // No note to Gemini: its system prompt already has it ask for the repeat in the same reply.
  scrollCallToBottom();
}

// A note to Gemini from the app (not the learner): it cuts off what it was saying.
function liveNote(text) {
  liveFlushReply();
  liveStopVoice();
  liveSend({ clientContent: { turns: [{ role: "user", parts: [{ text: `(Coach, not the learner: ${text})` }] }], turnComplete: true } });
}

// Gemini heard the attempt and answers it itself; the app only decides when to put the panel
// away: once the attempt matches, or once the learner has clearly moved on to something else.
function liveDrillAttempt(attempt) {
  const d = state.drill;
  if (isSkipCommand(attempt)) { skipDrill(); return; }
  d.tries = (d.tries ?? 0) + 1;
  const { ok } = drillMatch(attempt, d.target, d.said);
  if (ok) {
    setDrillFeedback(`✓ “${attempt}”`, true);
    setTimeout(() => { if (state.drill === d) endDrill(); }, 1000);
  } else if (d.tries >= 3 || similarity(drillWords(attempt), drillWords(d.target)) < 0.5) {
    endDrill();
  }
}

// The partner's words so far, in a bubble that grows while it speaks; saved once its turn is done.
function liveShowReply() {
  if (!live.replyId) {
    live.replyId = addMessage({ kind: "character", who: state.settings.characterName, text: "", plain: true });
  }
  updateMessage(live.replyId, { text: live.reply });
  scrollCallToBottom();
}

function liveFlushReply() {
  const reply = live?.reply.trim();
  if (live?.replyId) ui.set((s) => ({ transcript: s.transcript.filter((m) => m.id !== live.replyId) }));
  if (!live) return;
  live.replyId = null;
  live.reply = "";
  if (!reply) return;
  live.lastReply = reply;
  addCharacterMessage({ reply, reply_translation: "", mood: "neutral" }, { silent: true });
  state.history.push({ role: "assistant", content: reply });
}

function liveMessage(msg) {
  if (msg.setupComplete) {
    live.ready = true;
    setStatus("");
    updateCallState();
    // The partner speaks first, as in every call; resumed, it carries on where the call was.
    const start = live.resumed
      ? "(The call was on hold or the line dropped, and it is back now: carry on from where we were in one short line, without greeting again.)"
      : live.recap.length ? "(The call reconnected: carry on.)" : liveOpener(state.settings);
    liveSend({ clientContent: { turns: [{ role: "user", parts: [{ text: start }] }], turnComplete: true } });
    return;
  }
  const update = msg.sessionResumptionUpdate;
  if (update?.resumable && update.newHandle) store.set(LIVE_HANDLE_KEY, { handle: update.newHandle, at: Date.now() });
  if (msg.goAway) {
    // Google is about to close this connection: it will reconnect on its own with the handle.
    debugLog(`live call ends in ${msg.goAway.timeLeft ?? "?"}`);
    live.goingAway = true;
  }
  // The Büro colleague says goodbye and walks off.
  const leave = msg.toolCall?.functionCalls?.find((f) => f.name === "leave");
  if (leave) {
    // Gemini often calls leave before it has said goodbye: the reply asks for the goodbye out
    // loud, and the colleague walks off once that turn is over (or after 12 s at the latest).
    liveSend({ toolResponse: { functionResponses: msg.toolCall.functionCalls.map((f) => ({ id: f.id, name: f.name, response: { result: "If you haven't said goodbye out loud yet, say it now in one short line (and, if you'll come back, when). If you already have, say nothing more." } })) } });
    const comeBack = leave.args?.come_back_later === true;
    live.leaveAfterTurn = { comeBack };
    setTimeout(() => officeLeave({ comeBack }), 12_000);
    return;
  }
  const c = msg.serverContent;
  if (!c) return;
  if (c.inputTranscription?.text || c.outputTranscription?.text || c.modelTurn) live.activeAt = Date.now();
  if (c.inputTranscription?.text) {
    live.heard += c.inputTranscription.text; // not shown above the text box; it goes to the chat when the turn ends
  }
  const parts = c.modelTurn?.parts ?? [];
  if (c.outputTranscription?.text || parts.length) liveFlushLearner(); // the learner's turn is over
  for (const p of parts) if (p.inlineData?.data) livePlay(p.inlineData.data, p.inlineData.mimeType);
  if (c.outputTranscription?.text) {
    live.reply += c.outputTranscription.text;
    liveShowReply();
  }
  if (c.interrupted) liveStopVoice(); // the learner talked over it
  if (c.turnComplete) {
    liveFlushLearner();
    liveFlushReply();
    // The AI's word pick, as context only (turnComplete false: no reply is asked for).
    if (live.wordsNote) {
      liveSend({ clientContent: { turns: [{ role: "user", parts: [{ text: live.wordsNote }] }], turnComplete: false } });
      live.wordsNote = null;
    }
    if (live.leaveAfterTurn) officeLeave(live.leaveAfterTurn); // waits for the goodbye to finish playing
  }
}

// The coach for a live call: the learner's sentence checked on the side, never holding up the call.
const LIVE_COACH_SCHEMA = {
  type: "OBJECT",
  properties: {
    correction: { type: "STRING" },
    mistakes: { type: "ARRAY", items: { type: "STRING", enum: Object.keys(MISTAKE_TYPES) } },
    tip: { type: "STRING" },
  },
  required: ["correction", "mistakes", "tip"],
  propertyOrdering: ["correction", "mistakes", "tip"],
};

async function liveCoach(said, partner) {
  const { language, nativeLanguage, level, tense, mode } = state.settings.request;
  const t = TENSES[tense];
  const task = MODES[mode]?.joiner ? " The learner was asked to join two sentences with a connector: a wrong connector or word order is a mistake (verb_position)." : "";
  const check = grammarCheckOn() ? languageToolCheck(said, state.settings.locale) : null;
  try {
    const raw = await aiJson({
      systemInstruction: `You check one spoken sentence of a ${language} learner (CEFR ${level}, native ${nativeLanguage}) from a phone call. It comes from speech recognition: ignore punctuation, capital letters and obvious transcription slips.${task} correction: only if it has a real grammar or word-choice mistake${t ? ` or isn't in ${t.short} where that was asked for` : ""}, the sentence rewritten correctly, keeping its meaning; else empty. mistakes: each kind it fixes (${PROMPT_MISTAKES}). tip: one short sentence in ${nativeLanguage} explaining the main fix, or praising something literally in the sentence, or empty.`,
      schema: LIVE_COACH_SCHEMA,
      contents: [{ role: "user", parts: [{ text: `The partner said: ${JSON.stringify(partner)}\nThe learner said: ${JSON.stringify(said)}` }] }],
      temperature: 0.2,
    });
    const turn = { coach: { understood: true, correction: typeof raw?.correction === "string" ? raw.correction : "", mistakes: Array.isArray(raw?.mistakes) ? raw.mistakes : [], tip: typeof raw?.tip === "string" ? raw.tip : "" } };
    await addGrammarCheck(turn, said, check);
    if (!live) return; // the call ended meanwhile
    renderCoach(turn.coach);
    if (turn.coach.correction) {
      const types = turn.coach.mistakes.filter((x) => MISTAKE_TYPES[x]);
      recordMistakes(language, types.length ? [...new Set(types)] : ["other"], said, turn.coach.correction);
      renderMistakes();
      if (state.settings.sayAgain && !state.drill && drillable(turn.coach.correction, said)) startLiveDrill(said, turn.coach.correction);
    }
  } catch (error) {
    debugLog(`live coach: ${error.message}`);
  }
}

let liveRetries = 0; // reconnects in a row that didn't get the call going again
let liveReconnectPending = false; // the call dropped while paused or in the background: reconnect on return

async function startLive() {
  if (live) return;
  liveReconnectPending = false;
  const key = liveKey();
  if (!key) {
    setStatus("Gemini 3.8 Live needs its key: add it with “Change” on the start screen.");
    return;
  }
  const office = isOffice();
  if (office && !officeVisitAt) { officeVisit(); return; } // the 🎤 between visits calls someone over
  // Gemini's own copy of the call, if it still has it; else the partner gets the end of the call,
  // so it carries on rather than starting over. In the Büro both only ever hold this visit: the
  // handle is cleared when a colleague comes over, and earlier visits are in its memory.
  const handle = callLog.length ? liveHandle() : null;
  const recap = handle ? [] : callLog.slice(office ? state.settings.visitLogStart ?? 0 : 0).slice(-LIVE_RECAP).map((e) => ("you" in e ? `Learner: ${e.you}` : `You: ${e.reply}`));
  live = { ws: null, stream: null, tap: null, ready: false, muted: false, heard: "", reply: "", replyId: null, lastReply: "", sources: new Set(), playHead: 0, speaking: false, recap, resumed: Boolean(handle), goingAway: false, micBuf: new Int16Array(LIVE_CHUNK), micLen: 0, micPos: 0, ending: false, floor: null, talking: false, quiet: 0, preroll: [], micSent: 0, micTotal: 0 };
  setMic(true);
  setStatus(handle ? "Reconnecting the live call…" : "Connecting the live call…");
  try {
    const model = await liveModel(key);
    const ctx = getAudioCtx();
    if (!ctx?.audioWorklet) throw new Error("this browser can't record for a live call");
    await ctx.resume();
    setAudioSession("play-and-record");
    live.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    if (!live) { return; } // ended while the mic was asked for
    if (liveWorkletCtx !== ctx) {
      await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([LIVE_WORKLET], { type: "text/javascript" })));
      liveWorkletCtx = ctx;
    }
    const source = ctx.createMediaStreamSource(live.stream);
    live.tap = new AudioWorkletNode(ctx, "live-tap");
    live.tap.port.onmessage = (e) => liveMicSamples(e.data, ctx.sampleRate);
    source.connect(live.tap);
    live.source = source;

    const ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(key)}`);
    live.ws = ws;
    ws.onopen = () => liveSend({
      setup: {
        model,
        generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: office ? state.settings.colleague?.voice ?? "Puck" : "Puck" } } } },
        systemInstruction: { parts: [{ text: office ? officeSystemPrompt(state.settings, recap) : liveSystemPrompt(state.settings, recap) }] },
        ...(office ? { tools: OFFICE_TOOLS } : {}),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        // Handles to carry the call on after a dropped connection, and no 15-minute limit on a call.
        sessionResumption: handle ? { handle } : {},
        contextWindowCompression: { slidingWindow: {} },
      },
    });
    ws.onmessage = async (event) => {
      if (!live || live.ws !== ws) return;
      try {
        const msg = JSON.parse(typeof event.data === "string" ? event.data : await event.data.text());
        if (msg.setupComplete) liveRetries = 0;
        liveMessage(msg);
      } catch (error) {
        debugLog(`live message: ${error.message}`);
      }
    };
    ws.onclose = (event) => {
      if (!live || live.ws !== ws || live.ending) return;
      const before = !live.ready;
      const { resumed, goingAway } = live;
      stopLive();
      debugLog(`live call closed: ${event.code} ${event.reason}${resumed ? " (resumed)" : ""}`);
      if (before && resumed) {
        // Gemini no longer has this call: start again from the recap.
        clearLiveHandle();
        if (state.paused) liveReconnectPending = true;
        else startLive();
        return;
      }
      if (before) store.set(LIVE_MODEL_KEY, null); // look the model up again next time
      // A call that was going: carry it on by itself (Google closes connections now and then,
      // and an idle one on hold or in the background), unless that keeps failing. A Büro visit
      // reconnects at once even in the background: the learner is working in another window.
      if (!before && liveRetries < 3) {
        liveRetries++;
        if (state.paused || (document.visibilityState === "hidden" && !office)) {
          liveReconnectPending = true;
          if (state.paused) setStatus("Call paused. Tap Resume to carry on.");
        } else {
          if (!goingAway) setStatus("The live call dropped: reconnecting…");
          startLive();
        }
        return;
      }
      if (office) { officeAfterVisit({ why: "the line dropped" }); if (!before) return; }
      setStatus(`${before ? "The live call couldn't start" : "The live call stopped"}${event.reason ? ` (${event.reason})` : ""}. Tap 🎤 to ${before ? "try again" : "reconnect"}.`);
    };
  } catch (error) {
    stopLive();
    if (office) officeAfterVisit({ why: "the line dropped" });
    setStatus(`Live voice couldn't start: ${error.message}. Tap 🎤 to try again.`);
  }
}

function stopLive() {
  if (!live) return;
  const l = live;
  l.ending = true;
  if (l.micTotal) debugLog(`live call: sent ${(l.micSent / 10).toFixed(1)} s of ${(l.micTotal / 10).toFixed(1)} s of mic audio`);
  if (state.drill?.live) endDrill();
  liveFlushLearner();
  liveFlushReply();
  liveStopVoice();
  live = null;
  try { l.ws?.close(); } catch { /* closed already */ }
  try { l.source?.disconnect(); l.tap?.disconnect(); } catch { /* gone already */ }
  for (const track of l.stream?.getTracks() ?? []) track.stop();
  setMic(false);
}

// Mute and unmute the mic during a live call (the call itself stays up).
function setLiveMuted(muted) {
  if (!live) return;
  live.muted = muted;
  ui.merge("mic", { on: !muted, label: muted ? "Muted" : "Live" });
  setStatus(muted ? "Mic muted: tap 🎤 to talk again." : "");
  updateCallState();
}

// Typed during a live call: sent as text, and checked like a spoken sentence.
function liveSendText(text) {
  liveFlushReply();
  addLearnerMessage(text);
  state.history.push({ role: "user", content: text });
  liveStopVoice();
  liveSend({ clientContent: { turns: [{ role: "user", parts: [{ text }] }], turnComplete: true } });
  if (state.drill?.live) liveDrillAttempt(text);
  else liveCoach(text, live.lastReply);
}

// ---------- Büro: colleagues drop by while the learner works ----------
// The learner leaves the tab open and works. At a random moment a colleague "walks over": a
// chime, a desktop notification if the tab is hidden, and a Gemini Live call that is connected
// only for that visit. When the colleague says goodbye (the leave function, or a long silence)
// the call is closed again, so nothing is sent or billed between visits.
// As in a real German office: most colleagues say du, the boss and the older colleague from
// accounting say Sie, and the learner has to answer in the same form.
const OFFICE_COLLEAGUES = [
  { name: "Lena", look: { skin: "#f1c7a5", hair: "#9c4a22", hairStyle: "long", shirt: "#1f5f5b", trousers: "#1d1d22", prop: "notebook", lanyard: "#222", height: 0.97, shoulders: 0.9, hipWidth: 1.05 }, voice: "Kore", address: "du", role: "Product Ownerin in deinem Team", style: "organised and direct, talks quickly, thinks in sprints, deadlines and Jira tickets" },
  { name: "Jonas", look: { skin: "#e8b991", hair: "#3a2618", hairStyle: "curly", shirt: "#5f6368", trousers: "#2d3a52", glasses: "#151515", prop: "mug", height: 1.02 }, voice: "Puck", role: "Backend-Entwickler in deinem Team", address: "du", style: "relaxed and dry, a bit ironic, grumbles about legacy code and the coffee machine" },
  { name: "Frau Becker", look: { skin: "#f0c8a8", hair: "#d8c08a", hairStyle: "bun", shirt: "#1f2a44", jacket: "#141c30", trousers: "#1f2a44", prop: "tablet", height: 0.98, shoulders: 0.92, hipWidth: 1.05 }, voice: "Leda", role: "Teamleiterin (your boss)", address: "Sie", style: "polite, factual and firm; gets to the point at once; expects clear answers and dates" },
  { name: "Murat", look: { skin: "#c68e62", hair: "#15100c", hairStyle: "short", beard: true, shirt: "#1f7a74", sleeves: "short", lanyard: "#222", trousers: "#2b2b30", prop: "laptop", height: 1.0, shoulders: 1.05 }, voice: "Orus", role: "Kollege vom IT-Support", address: "du", style: "helpful and chatty, Ruhrpott humour, always in a hurry to the next ticket" },
  { name: "Sophie", look: { skin: "#f6d3b8", hair: "#e0bf73", hairStyle: "long", shirt: "#e2725b", trousers: "#4a6fa5", prop: "papers", height: 0.95, shoulders: 0.88, hipWidth: 1.05 }, voice: "Aoede", role: "Werkstudentin in deinem Team", address: "du", style: "friendly and curious, a bit unsure, asks many questions" },
  { name: "Herr Krüger", look: { skin: "#ecc3a0", hair: "#c4c4c4", hairStyle: "receding", glasses: "#8a8a8a", shirt: "#8a8d91", tie: "#2c3e75", trousers: "#4a4e5a", prop: "folder", height: 1.0 }, voice: "Charon", role: "Kollege aus der Buchhaltung, kurz vor der Rente", address: "Sie", style: "formal, correct and a bit pedantic about rules, forms and deadlines, but kind" },
];
// Things that really bring a German colleague to your desk. Some fit only a time of day
// (when: [from, to] in hours) and are skipped outside it.
const OFFICE_REASONS = [
  { why: "the team meeting (Jour fixe) this afternoon has to be moved and you need a new slot that works for them" },
  { why: "you need a short Abstimmung: you are stuck on a ticket and want their opinion before the Daily tomorrow" },
  { why: "it is lunchtime: you say \"Mahlzeit!\" and ask whether they are coming along to the Kantine, and what's on the menu today", when: [11.5, 13.5] },
  { why: "someone is leaving the company / has a birthday and you are going round with the Umschlag (envelope) and a card for the farewell gift: ask whether they want to chip in and sign the card" },
  { why: "the Kaffeekasse is empty / nobody has emptied the dishwasher in the Teeküche, and you remind them, half joking, half serious" },
  { why: "you are doing the Urlaubsplanung for next year: you want to know when they plan to take holidays, and whether they take the Brückentag" },
  { why: "the boss wants a status update by end of day: you ask how far they are with their task and whether the deadline holds" },
  { why: "you will be off sick tomorrow / have a Arzttermin and ask them to take over a small task (Vertretung) for you" },
  { why: "it's very stuffy in the office: you ask whether it's OK to open the window for a quick Stoßlüften, and complain about the heating / the air conditioning" },
  { why: "you ask them to review your document / pull request / presentation today, because it has to go out tomorrow morning" },
  { why: "you remind them about the mandatory Datenschutz-/Brandschutzschulung that has to be done this week, or the Zeiterfassung they haven't filled in" },
  { why: "you are organising the Weihnachtsfeier / Sommerfest / team event and ask whether they come, and for ideas" },
  { why: "you ask about their Homeoffice days next week, because you want to plan a meeting in the office" },
  { why: "it is late afternoon: you are leaving, say \"Ich mach dann mal Feierabend\" and ask one last quick thing about tomorrow", when: [15.5, 20] },
  { why: "it is Monday morning: you ask how their weekend was and tell briefly about yours", day: 1, when: [8, 12] },
  { why: "it is Friday: you ask about their plans for the weekend before leaving", day: 5, when: [12, 20] },
];
const OFFICE_GAPS = { short: [4, 10], normal: [10, 25], long: [25, 50] }; // minutes between visits
const OFFICE_MEMORY_KEY = "office_memory"; // [{ name, at, lines }]: earlier visits, so colleagues remember
const OFFICE_SILENCE_MS = 30_000; // nobody talks this long (after the colleague finished speaking): they leave
const OFFICE_WRAP_MS = 5 * 60_000; // a visit this long: the colleague is told to wrap up
const OFFICE_MAX_MS = 7 * 60_000; // and the call ends here regardless
let officeTimer = null; // checks, every few seconds, whether it's time for a visit / the visit is over
let officeNextAt = 0;
let officeVisitAt = 0; // when the current visit started (0: nobody is here)
let officeLeaving = false;
let officeWrapSent = false;

const isOffice = () => Boolean(MODES[state.settings?.request.mode]?.office);

function officeScheduleNext({ soon = false, minutes: exact = 0 } = {}) {
  const [lo, hi] = OFFICE_GAPS[state.settings?.officeGap] ?? OFFICE_GAPS.normal;
  const minutes = exact || (soon ? 0.5 + Math.random() * 1.5 : lo + Math.random() * (hi - lo));
  officeNextAt = Date.now() + minutes * 60_000;
  debugLog(`office: next visit in ${minutes.toFixed(1)} min`);
  if (!officeTimer) officeTimer = setInterval(officeTick, 3000);
  officeShowWaiting();
}

function officeStop() {
  clearInterval(officeTimer);
  officeTimer = null;
  officeNextAt = 0;
  officeVisitAt = 0;
  officeLeaving = false;
}

function officeShowWaiting() {
  if (live || !isOffice()) return;
  setStatus("Work as usual: a colleague will drop by at some point. Tap 🎤 to call someone over now.");
  updateCallState();
}

function officeTick() {
  if (!isOffice()) return officeStop();
  if (state.paused) { if (!live) officeNextAt += 3000; return; } // the pause doesn't count
  if (!live && !officeVisitAt) {
    if (officeNextAt && Date.now() >= officeNextAt) officeVisit();
    return;
  }
  if (!live?.ready || officeLeaving) return;
  const now = Date.now();
  const quiet = now - (live.activeAt ?? officeVisitAt);
  if (now - officeVisitAt > OFFICE_MAX_MS) {
    officeLeave({ why: "time's up" });
  } else if (quiet > OFFICE_SILENCE_MS && !live.speaking && !live.talking) {
    debugLog(`office: nobody spoke for ${Math.round(quiet / 1000)} s`);
    officeLeave({ why: "no answer" });
  } else if (!officeWrapSent && now - officeVisitAt > OFFICE_WRAP_MS && !live.speaking) {
    officeWrapSent = true;
    liveNote("You need to get back to your desk now: wrap up naturally in one or two lines, say goodbye and call leave.");
  }
}

function officeMemory() {
  return store.get(OFFICE_MEMORY_KEY, []);
}

// What was said in this visit, kept (verbatim, short) so the next visitor can refer to it.
function officeRemember() {
  const c = state.settings?.colleague;
  if (!c) return;
  const lines = callLog.slice(state.settings.visitLogStart ?? 0)
    .map((e) => ("you" in e ? `Learner: ${e.you}` : `${c.name}: ${e.reply}`))
    .map((l) => (l.length > 140 ? `${l.slice(0, 137)}…` : l))
    .slice(-8);
  if (!lines.length) return;
  store.set(OFFICE_MEMORY_KEY, [...officeMemory(), { name: c.name, at: Date.now(), lines }].slice(-6));
}

function officePick() {
  const memory = officeMemory();
  const recentNames = [...new Set([...memory.slice(-2).map((m) => m.name), ...recentlyUsed("office-colleagues", 2)])];
  const recentReasons = [...new Set([...store.get("office_recent_reasons", []), ...recentlyUsed("office-reasons", 8)])];
  const colleague = shuffled(OFFICE_COLLEAGUES.filter((c) => !recentNames.includes(c.name)))[0] ?? OFFICE_COLLEAGUES[0];
  const now = new Date();
  const hour = now.getHours() + now.getMinutes() / 60;
  const fits = (r) => (!r.when || (hour >= r.when[0] && hour < r.when[1])) && (!r.day || r.day === now.getDay());
  const timely = OFFICE_REASONS.filter((r) => (r.when || r.day) && fits(r) && !recentReasons.includes(r.why));
  // A reason tied to this moment (lunch, Friday afternoon) wins half the time it fits.
  const reason = (timely.length && Math.random() < 0.5 ? shuffled(timely)[0] : null)
    ?? shuffled(OFFICE_REASONS.filter((r) => !r.when && !r.day && !recentReasons.includes(r.why)))[0] ?? OFFICE_REASONS[0];
  store.set("office_recent_reasons", [...store.get("office_recent_reasons", []), reason.why].slice(-8));
  noteUsed("office-reasons", reason.why);
  noteUsed("office-colleagues", colleague.name);
  return { ...colleague, reason: reason.why };
}

// A soft two-note chime, like someone tapping on the desk, before the colleague speaks.
function officeChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  ctx.resume?.();
  [660, 880].forEach((f, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = f;
    const at = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

function officeVisit() {
  if (live || officeVisitAt || !isOffice()) return;
  // Told "jetzt gerade schlecht" last time: the same colleague comes back with the same matter.
  const back = state.settings.officeReturn;
  state.settings.officeReturn = null;
  const colleague = back ? { ...back, returning: true } : officePick();
  state.settings.colleague = colleague;
  state.settings.characterName = colleague.name;
  state.settings.visitLogStart = callLog.length;
  // This colleague's matter gets its own words (before the call connects, never waited for).
  state.settings.topicWords = null;
  prepareTopicWords(state.settings);
  clearLiveHandle(); // a new visit: Gemini's copy of the last one doesn't belong to it
  officeVisitAt = Date.now();
  officeLeaving = false;
  officeWrapSent = false;
  ui.merge("call", { avatar: colleague.name.split(" ").at(-1).charAt(0), name: colleague.name, topic: colleague.role });
  addMessage({ kind: "divider", text: `— ${colleague.name} ${back ? "comes back" : "comes over"} (${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}) —` });
  scrollCallToBottom();
  officeChime();
  const visit = officeVisitAt;
  const arrived = officeSceneEnter(colleague);
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try {
      const n = new Notification(`${colleague.name} kommt ${back ? "nochmal " : ""}vorbei`, { body: colleague.address === "Sie" ? "Haben Sie kurz Zeit?" : "Hast du kurz Zeit?", tag: "talkloop-office" });
      n.onclick = () => { window.focus(); n.close(); };
    } catch { /* notifications unavailable */ }
  }
  arrived.then(() => { if (officeVisitAt === visit && !live) startLive(); });
}

// The colleague goes back to their desk: let them finish their sentence, then hang up.
async function officeLeave({ comeBack = false, why = "" } = {}) {
  if (officeLeaving || !officeVisitAt) return;
  officeLeaving = true;
  for (let i = 0; i < 40 && live?.speaking; i++) await sleep(250);
  if (live) stopLive();
  officeAfterVisit({ comeBack, why });
}

// After a visit (ended normally or cut off): remember it and wait for the next one.
function officeAfterVisit({ comeBack = false, why = "" } = {}) {
  if (!officeVisitAt) return;
  const name = state.settings?.colleague?.name ?? "Your colleague";
  // Only once: a colleague sent away twice doesn't come back a third time.
  const back = comeBack && !state.settings.colleague?.returning;
  officeRemember();
  clearLiveHandle();
  officeVisitAt = 0;
  officeLeaving = false;
  const note = back ? "will come back later" : why === "no answer" ? `no answer for ${OFFICE_SILENCE_MS / 1000} s` : why;
  addMessage({ kind: "divider", text: `— ${name} goes back to their desk${note ? ` (${note})` : ""} —` });
  scrollCallToBottom();
  officeSceneLeave();
  ui.merge("call", { name: "Büro", avatar: "🏢", topic: "" });
  if (!isOffice()) return;
  if (back) {
    const { returning, ...colleague } = state.settings.colleague;
    state.settings.officeReturn = colleague;
    officeScheduleNext({ minutes: 3 + Math.random() * 5 });
  } else {
    officeScheduleNext();
  }
}

// The colleague's instructions for one visit.
function officeSystemPrompt(settings, recap = []) {
  const { language, nativeLanguage, level } = settings.request;
  const c = settings.colleague ?? OFFICE_COLLEAGUES[0];
  const when = new Date().toLocaleString("de-DE", { weekday: "long", hour: "2-digit", minute: "2-digit" });
  const sie = c.address === "Sie";
  const lines = [
    `You are ${c.name}, ${c.role}, in an ordinary office in Germany. Personality: ${c.style}. The learner is your colleague. It is ${when}. They are at their desk, concentrating on their laptop, and you have just walked up to them.`,
    `Why you came: ${c.reason}. Speak only ${language}: real spoken office German as you hear it in Germany, with its fillers and reactions (also, na ja, genau, ach so, echt?, alles klar, passt, Mhm, sag mal), short sentences, nothing like a textbook, a teacher or a phone call. Say "${sie ? "Sie" : "du"}" to the learner${sie ? "; if they say du to you, don't correct it, but stay with Sie yourself" : ""}. Greet the way people do at that time and place (Moin / Morgen, Mahlzeit around lunch, Hallo) and say goodbye the same way (bis später, bis gleich, schönen Feierabend, schönes Wochenende on a Friday).`,
    `How it goes, like in a real German office: first you only get their attention and ask, briefly and directly, whether they have a moment (e.g. ${sie ? "\"Entschuldigung, haben Sie kurz fünf Minuten?\", \"Störe ich gerade?\"" : "\"Du, hast du kurz 'ne Minute?\", \"Störe ich gerade?\", \"Kurze Frage…\""}), and nothing else: then you wait for their answer. If they say yes, come straight to the point: Germans are direct and factual at work, with at most a line of small talk; then talk it through properly, ask for concrete things (a time, a yes or no, a date), and agree on what happens next ("Dann machen wir das so", "Schick mir das einfach per Mail", "Ich trag's in den Kalender ein"). If they say it's a bad moment or they're busy, accept it without fuss, say when you'll come back (e.g. "Kein Stress, ich komm in 'ner halben Stunde nochmal vorbei") and call leave with come_back_later true.`,
    ...(c.returning ? [`You were already here a few minutes ago, but they had no time, and you said you'd come back. Now you are back: start with something like ${sie ? "\"So, passt es jetzt besser?\"" : "\"So, passt's jetzt?\""} and then the same matter. This time, if they are still busy, agree on another way (a mail, a slot in the calendar) and leave.`] : []),
    `Learner: ${language} at CEFR ${level}, native ${nativeLanguage}. Speak at their level, but stay a real colleague, not a teacher.${LEVEL_GUIDE[level] ? ` At ${level}: ${LEVEL_GUIDE[level]}` : ""}`,
    "Let the learner do a good share of the talking: ask them things, react to what they say, and invent realistic details about your work, the project and the office when needed. If you don't know something about the learner (their job, their project), ask or assume something plausible and stay consistent with it.",
    "This is a short interruption, as in real life: two to four minutes. Once your matter is sorted, say a natural goodbye (e.g. \"Gut, dann lass ich dich mal weiterarbeiten!\") and then call leave. Never call leave before you have said goodbye.",
    "The learner may pause to think: wait for them.",
    "If they make a mistake, repeat the right form naturally in your answer, like a native colleague would, without a grammar lesson: the app shows written corrections itself.",
    "A message in brackets starting \"(Coach, not the learner:\" comes from the learning app: do what it says, in your own voice and in character, and never mention a coach or an app.",
  ];
  const memory = officeMemory().slice(-4);
  if (memory.length) {
    lines.push(`Earlier conversations at the office today and on earlier days (refer back to them naturally when it fits, e.g. ask how something turned out; never repeat them):\n${memory.map((m) => `[${new Date(m.at).toLocaleString("de-DE", { weekday: "short", hour: "2-digit", minute: "2-digit" })}, with ${m.name}]\n${m.lines.join("\n")}`).join("\n")}`);
  }
  const weak = recurringMistakes(language);
  if (weak.length) lines.push(`The learner's recurring mistakes: ${weak.map((w) => MISTAKE_TYPES[w.type]).join("; ")}. Now and then ask something whose natural answer needs one of these; never say you're testing.`);
  lines.push(...liveVocabLines(settings, MODES.office));
  if (recap.length) lines.push(`Your conversation was cut off and has just reconnected. The end of it so far:\n${recap.join("\n")}\nCarry on from there in one short line, without greeting again.`);
  return lines.join("\n");
}

// ---------- Büro: the office in 3D ----------
// Above the conversation, a small real-time 3D office seen through your eyes (office3d.js):
// your laptop while you work; a colleague walks in and down the aisle, your view turns to them,
// they talk (their mouth follows the voice you hear) and walk off again. Three.js is loaded only
// for the Büro, from the CDN; if it can't load, there is simply no scene.
let office3d = null; // the scene, once made
let office3dLoading = null;

async function officeSceneShow(on) {
  ui.merge("office", { show: on });
  if (!on || office3d) return;
  office3dLoading ??= import("./office3d.js")
    .then(({ createOffice3D }) => {
      office3d = createOffice3D(refs.os3d, {
        speaking: () => Boolean(live?.speaking && officeVisitAt),
        level: liveVoiceLevel,
        youTalking: () => Boolean(live?.talking),
      });
    })
    .catch((error) => {
      debugLog(`office 3D: ${error.message}`);
      ui.merge("office", { show: false });
    });
  await office3dLoading;
}

// A colleague walks over; resolves once they stand at your desk (at most ~12 s; at once without a scene).
function officeSceneEnter(c) {
  if (!office3d || !ui.get().office.show) return Promise.resolve();
  return Promise.race([office3d.enter(c.look ?? {}), sleep(12_000)]);
}

function officeSceneLeave() {
  office3d?.leave();
}

// "I hear you" while the app hears the learner (the 3D scene reads the rest itself, every frame).
function officeSceneUpdate() {
  if (!ui.get().office.show) return;
  const talking = Boolean(live?.talking);
  if (ui.get().office.talking !== talking) ui.merge("office", { talking });
}

const OFFICE_TOOLS = [{
  functionDeclarations: [{
    name: "leave",
    description: "Go back to your own desk. Call this right after you have said goodbye to the learner.",
    parameters: {
      type: "OBJECT",
      properties: { come_back_later: { type: "BOOLEAN", description: "true if they had no time and you said you'd come back later" } },
    },
  }],
}];

// ---------- conversation turns ----------
// ---------- second grammar check (LanguageTool) ----------
// Every AI now and then misses a mistake in the learner's sentence. LanguageTool's free
// public API (no key, ~20 checks a minute per device) checks it too, alongside the AI so
// it costs no extra wait; when the AI's coach gave no correction but LanguageTool finds a
// grammar mistake or a misspelt word, that becomes the correction. Its style, comma and
// capital-letter hints are ignored (speech has none), and so are its "did you mean…" guesses.
const LANGUAGETOOL = "https://api.languagetool.org/v2/check";
const grammarCheckOn = () => store.get("grammar_check", true);

function languageToolCheck(text, locale) {
  // Form-encoded, so the browser sends it without a preflight (LanguageTool allows any origin).
  return fetch(LANGUAGETOOL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ text, language: locale }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => (data?.matches ?? []).filter((m) => m.rule?.category?.id === "GRAMMAR" || m.rule?.issueType === "misspelling"))
    .catch(() => null); // offline or at its limit: the AI's coach alone, as before
}

// The kind of mistake, from LanguageTool's rule, for the mistake log.
function languageToolMistake(m, said) {
  const id = m.rule?.id ?? "";
  if (/HILFSVERB/.test(id)) return "perfekt_auxiliary";
  if (/PRAEP|AGREEMENT|KONGRUENZ|ARTIKEL|GENUS|DE_CASE/.test(id)) return "case_article";
  if (m.rule?.issueType === "misspelling" && /^ge/i.test(said.slice(m.offset, m.offset + m.length))) return "participle";
  return "other";
}

// When the AI found nothing, LanguageTool's fixes (each first suggestion, applied from the
// end so the offsets stay right) become the coach's correction.
async function addGrammarCheck(turn, said, check) {
  if (!check || turn.coach.correction) return;
  const matches = await Promise.race([check, sleep(2500).then(() => null)]);
  const fixes = (matches ?? []).filter((m) => m.replacements?.[0]?.value);
  if (!fixes.length) return;
  let corrected = said;
  let end = Infinity;
  for (const m of [...fixes].sort((a, b) => b.offset - a.offset)) {
    if (m.offset + m.length > end) continue; // overlaps the one after it
    corrected = corrected.slice(0, m.offset) + m.replacements[0].value + corrected.slice(m.offset + m.length);
    end = m.offset;
  }
  if (corrected === said) return;
  debugLog(`grammar check: ${fixes.length} fix(es) the AI missed`);
  turn.coach.correction = corrected;
  turn.coach.mistakes = [...new Set(fixes.map((m) => languageToolMistake(m, said)))];
  turn.coach.tip = `Grammar check: ${fixes.map((m) => m.shortMessage || m.message).join(" ")}`;
}

async function sendTurn(message) {
  if (state.busy || state.finished) return;
  if (message) addLearnerMessage(message);
  if (message) markTopicWords(message); // ticked at once, not after the reply
  setBusy(true);
  setStatus(`${state.settings.characterName} is thinking…`);
  const slowHint = setTimeout(() => setStatus("Still thinking… longer replies take a moment."), 6000);
  try {
    // Started together with the AI, so the second check adds no wait.
    const check = message && grammarCheckOn() ? languageToolCheck(message, state.settings.locale) : null;
    const { turn, userText } = await chatTurn(state.settings, state.history, message);
    if (message) await addGrammarCheck(turn, message, check);
    state.history.push({ role: "user", content: message || userText });
    state.history.push({ role: "assistant", content: turn.reply });
    if (MODES[state.settings.request.mode]?.subjects) {
      noteSubject(turn.subject);
      prepareTopicWords(); // a new subject gets its own words (in the background)
    }
    // The interpreter's try goes into the sentence deck, and the next sentence is chosen: kept
    // with the call (it survives a reload) and shown with the reply.
    if (MODES[state.settings.request.mode]?.interpreter) {
      if (message && state.settings.sayThis) recordSentence(state.settings, message, turn.coach);
      nextSentence(state.settings, turn.situation);
    }
    // The connector drill's next pair to join, kept with the call like the interpreter's sentence.
    if (MODES[state.settings.request.mode]?.joiner && turn.situation.trim()) {
      state.settings.joinThis = turn.situation.trim();
      noteUsed("connector-tasks", state.settings.joinThis);
    }

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
    if (todayWords) {
      todayWords.current = findTodayWord(turn.next_word)?.de ?? null;
      // Which turn asked for which word (see wordResting). Only an ask the prompt allowed counts:
      // the prompt of this turn was built one exchange earlier than the history is now.
      const turnNo = Math.floor(state.history.length / 2);
      if (todayWords.current && !todayWords.status[todayWords.current]?.correct
          && !wordResting(todayWords.asked, todayWords.current, turnNo - 1)) {
        ((todayWords.asked ??= {})[todayWords.current] ??= []).push(turnNo);
      }
    }
    // The drill's situation is kept here and sent back each turn (only the last few turns
    // are), so the story stays coherent; the header shows it.
    if (todayWords && MODES[state.settings.request.mode]?.drill && turn.situation?.trim()) {
      if (turn.situation.trim().slice(0, 80) !== todayWords.situation) noteUsed("drill-situations", turn.situation.trim().slice(0, 80));
      todayWords.situation = turn.situation.trim().slice(0, 80);
      ui.merge("call", { mode: `Sentence drill · ${todayWords.situation}` });
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

// The interpreter drill's sentence to say, or the connector drill's pair to join, above the
// suggestions (hidden in other modes).
function renderSayThis() {
  const mode = MODES[state.settings?.request.mode];
  const text = mode?.interpreter ? state.settings.sayThis ?? "" : mode?.joiner ? state.settings.joinThis ?? "" : "";
  if (!text) {
    ui.set({ sayThis: null });
    return;
  }
  const kind = { review: "Review · ", again: "Once more · " }[state.settings?.sayKind] ?? "";
  const label = mode?.joiner ? "Say it as one sentence · " : `${kind}Say it in ${state.settings?.request.language ?? "German"}: `;
  ui.set({ sayThis: { label, text } });
}

// The character's reply, its suggestions and focus words, and the end of a finished scene.
function presentReply(turn) {
  addCharacterMessage(turn);
  renderSayThis();
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
  ui.set({ drill: { target: state.drill.target, lang: state.settings.locale, feedback: "", ok: false } });
  updateCallState();
  scrollCallToBottom();
  // Hear it first; hands-free then listens for the attempt.
  speak(state.drill.target, [], () => maybeResumeListening());
}

function setDrillFeedback(text, ok = false) {
  if (ui.get().drill) ui.merge("drill", { feedback: text, ok });
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
  ui.set({ drill: null });
  if (recognizer) { dropNextResult = true; recognizer.abort(); }
  stopSpeaking();
  updateCallState();
  if (d.live) return; // a live call carries on by itself
  presentReply(d.turn);
}

// Skipped by the button or by voice: in a live call, Gemini is told to carry on.
function skipDrill() {
  const wasLive = state.drill?.live;
  endDrill();
  if (wasLive && live?.ready) liveNote("The learner skipped saying it again: carry on with the conversation.");
}

function isSkipCommand(text) {
  const t = normalizeSpeech(text);
  return t.split(" ").length <= 3 && /(?<!\p{L})(weiter|überspringen|skip|next)(?!\p{L})/u.test(t);
}

// ---------- word explorer & bookmarks ----------
// The word explorer (components/Explorer.jsx): a tapped word, or the 🔍 look-up.
let explorerToken = 0;
function openExplorer(word, sentence) {
  showWordInfo(word, () => wordInfo({
    word,
    sentence,
    language: state.settings.request.language,
    nativeLanguage: state.settings.request.nativeLanguage,
  }));
}

// Any word, without leaving the call: one the learner wants to say but doesn't know (in their
// own language), or one they heard (in the language practised).
// Any word, without leaving the call: one the learner wants to say but doesn't know (in their
// own language), or one they heard (in the language practised).
function openLookup() {
  const { language, nativeLanguage } = state.settings.request;
  explorerToken++;
  ui.set({ explorer: { lookup: true, placeholder: `A word in ${nativeLanguage} or ${language}`, status: "idle" } });
}
function submitLookup(query) {
  const q = (query ?? "").trim();
  if (q) showWordInfo(q, () => lookupWord(q), { lookup: true });
}
function closeExplorer() {
  explorerToken++;
  ui.set({ explorer: null });
}

function lookupWord(query) {
  const { language, nativeLanguage } = state.settings.request;
  return aiJson({
    systemInstruction: `You are a concise ${language}–${nativeLanguage} dictionary for a ${nativeLanguage} speaker learning ${language}.`,
    schema: WORD_SCHEMA,
    contents: [{ role: "user", parts: [{ text: `The learner looks up "${query}". If it is ${nativeLanguage}, give the most common ${language} word or phrase for it as word (a noun with its article) and its ${nativeLanguage} meaning as translation. If it is ${language}, give it as word (a noun with its article) and its ${nativeLanguage} meaning as translation. The example is a short everyday ${language} sentence using the word.` }] }],
  });
}

// Looks a word up and shows it in `body`: translation, how to say it, an example, Listen and Save.
// Looks a word up and shows it: translation, how to say it, an example, Listen and Save.
async function showWordInfo(word, lookup, { lookup: isLookup = false } = {}) {
  const token = ++explorerToken;
  const base = isLookup ? { ...ui.get().explorer, lookup: true } : { lookup: false };
  ui.set({ explorer: { ...base, word, status: "loading", info: null, error: "", saved: false } });
  try {
    const info = await lookup();
    if (token === explorerToken) ui.set({ explorer: { ...base, word, status: "done", info, saved: false } });
  } catch (error) {
    if (token === explorerToken) ui.set({ explorer: { ...base, word, status: "error", error: error.message } });
  }
}
function listenWord(word) {
  speak(word, NO_WORDS);
}
function saveExplorerWord() {
  const e = ui.get().explorer;
  if (!e?.info || e.saved) return;
  saveBookmark(e.info);
  ui.set({ explorer: { ...e, saved: true } });
}

// The mistake tracker for the language picked on the setup screen.
// The mistake tracker for the language picked on the setup screen (components/Mistakes.jsx).
function renderMistakes() {
  const language = ui.get().form.language;
  const ranked = rankedMistakes(language);
  const practised = recurringMistakes(language).map((t) => t.type);
  ui.set({
    mistakes: {
      language,
      synced: Boolean(trainerLink()),
      items: ranked.map((t) => {
        const name = MISTAKE_TYPES[t.type];
        return { type: t.type, name: `${name[0].toUpperCase()}${name.slice(1)}`, count: t.count, practised: practised.includes(t.type), said: t.example.said, fix: t.example.fix };
      }),
    },
  });
}

function resetMistakes() {
  const language = ui.get().form.language;
  if (!confirm(`Forget your recorded ${language} mistakes?`)) return;
  const log = store.get("mistakes", {});
  delete log[language];
  store.set("mistakes", log);
  // Remembered, so the linked trainer clears it on the other devices too.
  store.set("mistake_resets", { ...store.get("mistake_resets", {}), [language]: Date.now() });
  renderMistakes();
  syncMistakes();
}

function saveBookmark(info) {
  const bookmarks = store.get("bookmarks", []);
  if (!bookmarks.some((b) => b.word === info.word && b.language === state.settings.request.language)) {
    bookmarks.unshift({ word: info.word, translation: info.translation, language: state.settings.request.language });
    store.set("bookmarks", bookmarks.slice(0, 200));
  }
  renderBookmarks();
}

function renderBookmarks() {
  ui.set({ bookmarks: store.get("bookmarks", []) });
}

// ---------- wiring ----------
// The screens are React components (components/*.jsx). They render from `ui` and call the
// actions exported at the end of this file; nothing here reaches into the page except the
// typing box (refs.text), whose text and caret stay the browser's.

// The key fields of the key screen, by service (components/KeyGate.jsx draws them).
const KEY_SERVICES_SHOWN = {
  openai: ["openai"], mistral: ["groq"], groq: ["groq", "openai"], groq2: ["groq"], groq3: ["groq"],
  cfAccount: ["groq", "cloudflare"], cfToken: ["groq", "cloudflare"], gemini: null, gemini2: null, geminiLive: null,
};
let editingSavedKeys = false;

// What the key screen shows for the chosen AI: its fields (saved keys show as a placeholder,
// and need no field unless the learner wants to change them) and the AIs that have their key.
function keyGateInfo(provider) {
  const show = {};
  for (const [service, providers] of Object.entries(KEY_SERVICES_SHOWN)) {
    show[service] = (!providers || providers.includes(provider)) && (editingSavedKeys || !serverKeys[service]);
  }
  // Cloudflare's ID and token share one field: a saved one hides both, as before.
  if (!editingSavedKeys && (serverKeys.cfAccount || serverKeys.cfToken)) show.cfAccount = show.cfToken = false;
  return {
    show,
    saved: Object.fromEntries(Object.keys(KEY_SERVICES_SHOWN).map((s) => [s, Boolean(getKey(s))])),
    ready: Object.fromEntries(PROVIDERS.map((p) => [p.value, providerReady(p.value)])),
    optional: { gemini: provider !== "gemini", groq: provider !== "groq", cf: provider !== "cloudflare" },
    saveLabel: providerReady(provider) ? "Connect" : "Save to my account",
    showEditSaved: hasServerKeys() && !editingSavedKeys,
    intro: hasServerKeys()
      ? "Your AI keys are saved in your Vocab Trainer account and load when you log in. Pick the AI to talk to (✓ = key saved)."
      : "Paste your AI key once: it is saved in your Vocab Trainer account (not in this browser) and loads every time you log in.",
  };
}
function showKeyFields() {
  ui.bump("keysVersion");
}
function editSavedKeys() {
  editingSavedKeys = true;
  showKeyFields();
}

function keySummary() {
  if (getProvider() === "gemini") return getKey("gemini2") ? "✓ Using Google Gemini, with a second Gemini key as backup." : "✓ Using Google Gemini.";
  if (getProvider() === "openai") return `✓ Using OpenAI (${OPENAI.model})${getKey("groq") ? ", with Groq as backup" : ""}.`;
  if (getProvider() === "cloudflare") return getKey("groq") ? "✓ Using Cloudflare Workers AI, with Groq as backup." : "✓ Using Cloudflare Workers AI.";
  if (getProvider() === "groq") {
    const groqBackups = GROQ_BACKUPS.filter((k) => getKey(k)).length;
    const backups = [groqBackups && (groqBackups === 1 ? "a second Groq key" : `${groqBackups} more Groq keys`), getKey("cfAccount") && getKey("cfToken") && "Cloudflare", getKey("mistral") && "Mistral"].filter(Boolean);
    return backups.length ? `✓ Using Groq, with ${backups.join(" and ")} as backup.` : "✓ Using Groq.";
  }
  return "";
}

// Show the key box or the setup, depending on whether the chosen AI has a key saved.
function refreshKeyGate() {
  const haveKey = providerReady();
  ui.merge("view", { keygate: !haveKey, setup: haveKey, keySaved: haveKey });
  ui.set({
    keySummary: keySummary(),
    provider: getProvider(),
    // Every AI that has its key, to pick from right on the start screen.
    aiChoices: PROVIDERS.filter((p) => providerReady(p.value)),
    aiChoice: getProvider(),
  });
  showKeyFields();
}
function chooseAi(value) {
  setProvider(value);
  refreshKeyGate();
}

// `typed`: service -> what was typed in its field.
async function saveKeys(provider, typed, openaiModel = "") {
  const missing = provider === "cloudflare"
    ? !(typed.cfAccount || getKey("cfAccount")) || !(typed.cfToken || getKey("cfToken"))
    : !typed[provider] && !getKey(provider);
  if (missing) {
    ui.set({ keyStatus: provider === "cloudflare"
      ? "Paste your Cloudflare account ID and API token first."
      : `Paste your ${{ openai: "OpenAI", groq: "Groq", gemini: "Gemini" }[provider]} API key first.` });
    return false;
  }
  const toSave = Object.fromEntries(Object.entries(typed).map(([s, v]) => [s, (v ?? "").trim()]).filter(([, value]) => value));
  if (Object.keys(toSave).length) {
    ui.set({ keyStatus: "Saving to your account…" });
    try {
      await saveKeysToAccount(toSave);
    } catch (error) {
      ui.set({ keyStatus: error.message });
      return false;
    }
  }
  editingSavedKeys = false;
  const model = openaiModel.trim();
  if (provider === "openai" && model) store.set("openai_model", model);
  setProvider(provider);
  ui.set({ keyStatus: "" });
  refreshKeyGate();
  return true;
}

function changeKey() {
  ui.merge("view", { keygate: true, setup: false });
  showKeyFields();
}

// A message under the setup screen's vocabulary, brought into view when it matters.
function showVocabStatus(text, { scroll = false } = {}) {
  ui.set({ vocabStatus: text, ...(scroll ? { vocabStatusAt: Date.now() } : {}) });
}

async function startConversation() {
  const form = ui.get().form;
  const scenario = form.scenario;
  const mode = form.mode;
  const usesScene = (MODES[mode] ?? MODES.scene).usesScene;
  // The connector drill is about word order only: no words of the learner's to bring in.
  const useVocab = form.useVocab && !ui.get().useVocab.disabled && !MODES[mode]?.joiner;
  // Vocab of the chosen level and the ones below it (the list only goes up to B1).
  const VOCAB_LEVELS = ["A1", "A2", "B1"];
  const upTo = VOCAB_LEVELS.indexOf(form.level);
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
  if ((liveVoiceOn() || MODES[mode]?.office) && !MODES[mode]?.drill && !liveKey()) {
    showVocabStatus(MODES[mode]?.office ? "Büro uses Gemini Live: tap “Change” at the top and add your Gemini (Live) key." : "Gemini 3.8 Live needs its key: tap “Change” at the top and add the Gemini 3.8 Live key, or untick Gemini 3.8 Live.", { scroll: true });
    return;
  }
  // The connector drill needs the trainer's connectors (loaded with the page, so normally no wait).
  let connectors = null;
  if (MODES[mode]?.joiner) {
    try {
      connectors = connectorPool(await loadConnectors(), form.connector, form.level);
    } catch (error) {
      showVocabStatus(error.message, { scroll: true });
      return;
    }
  }
  if (MODES[mode]?.drill && !todayWords?.active.length) {
    showVocabStatus(useVocab
      ? "The sentence drill has no words to practise yet: learn some in the Vocab Trainer, or come back when some are due."
      : "The sentence drill practises your vocabulary: tick “Weave my vocab into the conversation” first.", { scroll: true });
    return;
  }

  state.settings = {
    locale: LANGUAGES.find((l) => l.value === form.language)?.locale ?? "de-DE",
    level: form.level,
    characterName: MODES[mode]?.office ? "Büro" : usesScene ? (SCENARIOS[scenario] ?? SCENARIOS.cafe).character : PARTNER.character,
    vocab,
    sayAgain: form.sayAgain,
    // Gemini Live: a real-time voice call (see startLive). Not for the sentence drill, which
    // needs the word chips and schedule of a normal call.
    live: (liveVoiceOn() || Boolean(MODES[mode]?.office)) && !MODES[mode]?.drill,
    officeGap: form.officeGap,
    request: {
      language: form.language,
      nativeLanguage: form.native,
      level: form.level,
      scenario,
      mode,
      tense: form.tense,
    },
  };
  // "Discuss a topic": the topic is chosen now, so the header can show it and the opening
  // turn (chatTurn) uses it.
  chatId = null;
  if (MODES[mode]?.topics) {
    state.settings.topic = pickTopic(state.settings.level, recentTopics());
    store.set("last_topic", state.settings.topic);
    rememberTopic(state.settings.topic);
  }
  if (MODES[mode]?.roleCard) state.settings.roleCard = makeRoleCard();
  if (connectors) state.settings.connectors = connectors;
  // Free chats and interviews are kept too, with the subjects they cover.
  if (MODES[mode]?.subjects) state.settings.subjects = [];
  // The chat opens on its first theme, which counts as its first subject.
  if (MODES[mode]?.themes) state.settings.subjects.push(chatThemes(state.settings)[0]);
  if (MODES[mode]?.topics || MODES[mode]?.subjects) {
    chatId = String(Date.now()); // a new chat; it is saved with the first message
    chatStarted = Date.now();
  }
  // The learnt words that fit this conversation, in the side panel: a quick list now, the AI's
  // pick in the background (never waited for). The Büro picks them per visit.
  if (!MODES[mode]?.office) prepareTopicWords(state.settings);
  else renderTopicWords();
  bumpStreak();
  renderStats();
  ui.merge("view", { setup: false });
  // Start hands-free, so the mic opens once the opening line is spoken — no tap needed.
  state.handsFree = Boolean(Recognition);
  state.autoSend = true; // each chat starts on auto-send; the toggle in the call changes it for that chat only
  ui.set({ autoSend: true });
  callLog = [];
  clearLiveHandle(); // a new call: Gemini's copy of the last one doesn't belong to it
  enterCall();
  // The on-device voice is the default: get it ready while the first reply loads (a live call has Gemini's own).
  if (!state.settings.live && hasPiperVoice(state.settings.locale)) {
    preloadPiper(state.settings.locale).catch((error) => console.warn("Piper download failed:", error));
  }
  if (MODES[mode]?.office) {
    // Nobody is here yet: the first colleague drops by in a minute or two, then every so often.
    state.handsFree = false;
    ui.merge("call", { avatar: "🏢" });
    getAudioCtx()?.resume(); // unlocked by this tap, so a later visit can play without one
    if ("Notification" in window && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    officeScheduleNext({ soon: true });
  } else if (state.settings.live) {
    state.handsFree = false; // Gemini listens itself: the browser's speech recognition stays off
    startLive();
  } else {
    sendTurn("");
  }
}

// Load a vocab JSON from a URL.
async function loadVocabUrl(url, { silent } = {}) {
  if (!url) return;
  if (!silent) showVocabStatus("Loading from web…");
  try {
    const { count, levels } = await importVocabFromUrl(url);
    showVocabStatus(`✓ ${count} words loaded (${levels.join(", ")}).`);
    refreshVocabUI(count);
  } catch (error) {
    if (!silent) showVocabStatus(`Load failed: ${error.message}`);
  }
}

// Fetch the learnt words now and keep them, so they are ready when a conversation starts.
async function refreshLearntWords() {
  if (!trainerLink()) return renderTrainerLink(null);
  ui.set({ trainerStatus: "🔗 Linked to your Vocab Trainer · fetching your learnt words…" });
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
  renderChatGptLink();
  // The free server sleeps when unused and can take a minute to wake up.
  const text = !linked
    ? "Connecting to your Vocab Trainer… (it can take up to a minute to wake up)"
    : `🔗 Linked to your Vocab Trainer · your partner uses all A1 and A2 words plus ${
        count ? `the ${count} B1 words you have learnt there` : "your learnt B1 words (none yet)"}.`;
  ui.set({ trainerStatus: problem ? `${problem} ${linked ? text : ""}`.trim() : text });
}

// ChatGPT's connection to Talkloop: the trainer's /mcp/ with this link, and the time zone for "today".
function renderChatGptLink() {
  const link = trainerLink();
  ui.merge("view", { chatgpt: Boolean(link) });
  if (!link) return;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  ui.set({ chatgptUrl: `${link.api}/mcp/${link.token}${zone ? `?tz=${encodeURIComponent(zone)}` : ""}` });
}

function refreshVocabUI(count) {
  const have = count > 0;
  ui.set({ useVocab: { ...ui.get().useVocab, disabled: !have } });
  if (have && !ui.get().vocabStatus) showVocabStatus(`✓ ${count} words ready.`);
}

// A change on the setup screen. The connector, the Büro's pace, "say it again", Gemini Live
// and the grammar check are remembered in this browser.
function setForm(patch) {
  const before = ui.get().form;
  ui.merge("form", patch);
  if ("connector" in patch) store.set("connector", patch.connector);
  if ("officeGap" in patch) store.set("office_gap", patch.officeGap);
  if ("sayAgain" in patch) store.set("say_again", patch.sayAgain);
  if ("liveVoice" in patch) store.set("live_voice", patch.liveVoice);
  if ("grammarCheck" in patch) store.set("grammar_check", patch.grammarCheck);
  if ("language" in patch && patch.language !== before.language) {
    preloadSelectedVoice();
    renderMistakes();
  }
}

function submitComposer() {
  // A reply is still loading (or the call is finished/on hold): keep what's typed.
  if (state.busy || state.finished || state.paused) return;
  const input = refs.text;
  if (!input) return;
  // Manual send: words still being heard count too; the mic stops so they are not sent twice.
  const unsent = !state.autoSend && recognizer ? ui.get().heard.trim() : "";
  const text = `${input.value.trim()} ${unsent}`.trim();
  if (!text) return;
  input.value = "";
  if (unsent) { dropNextResult = true; recognizer.abort(); showHeard(""); }
  if (state.drill?.live && live?.ready) {
    liveSendText(text); // typed: Gemini judges it like a spoken try
    return;
  }
  if (state.drill) {
    checkDrill(text); // typing the corrected sentence also counts
    return;
  }
  if (isPauseCommand(text)) {
    setPaused(true);
    return;
  }
  if (state.settings?.live) {
    if (live?.ready) liveSendText(text);
    else { input.value = text; setStatus("The live call isn't connected: tap 🎤 first."); }
    return;
  }
  stopSpeaking();
  sendTurn(text);
}

// The Send button on a phone: sent without dropping the keyboard, so the next turn can be typed
// straight away (see tap.js). Mouse clicks and Enter go through the form's submit.
function sendTap() {
  const keepKeyboard = document.body.classList.contains("typing");
  submitComposer();
  if (keepKeyboard) refs.text?.focus();
}

// On phones the on-screen keyboard covers half the screen, so while the text box is
// focused mark the body "typing": the CSS then folds away the big round call controls
// and the vocab row, leaving the input and transcript usable. Keep the latest message
// in view above the keyboard. The layout only goes back once the box has stayed blurred
// for a moment, so a brief blur during a tap can't reflow the dock and move the Send
// button out from under the finger.
let typingTimer = null;
function textFocus() {
  clearTimeout(typingTimer);
  document.body.classList.add("typing");
  scrollCallToBottom();
}
function textBlur() {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    if (document.activeElement !== refs.text) document.body.classList.remove("typing");
  }, 300);
}

// ---------- umlaut keys ----------
// For a keyboard without umlauts, three ways to type them in the reply box: the keys above it,
// a quote mark before a vowel ("a -> ä, "o -> ö, "u -> ü, "s -> ß, capitals too; a phone
// turns " into “ or ” first, so those count), and Alt+A / O / U / S on a physical keyboard.
// Backspace right after a quote-vowel conversion gives back the quote and the letter.
const UMLAUT_OF = { a: "ä", o: "ö", u: "ü", s: "ß", A: "Ä", O: "Ö", U: "Ü" };
const UMLAUT_KEY_CODES = { KeyA: "ä", KeyO: "ö", KeyU: "ü", KeyS: "ß" };
let umlautShift = false; // the next key from the row is a capital
let lastUmlaut = null; // { at, original } while the caret is right after a converted letter

function renderUmlautKeys() {
  ui.set({ umlautShift });
}

// Puts a letter into the reply box at the caret, as a capital after a shift or at a sentence start.
function insertUmlaut(ch, { capital = false } = {}) {
  const input = refs.text;
  if (!input || input.disabled) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const atSentenceStart = /(^|[.!?]\s+)$/.test(input.value.slice(0, start));
  const out = ch !== "ß" && (capital || umlautShift || atSentenceStart) ? ch.toUpperCase() : ch;
  input.focus(); // the typing layout and keyboard come up as for any typing
  input.setRangeText(out, start, end, "end");
  umlautShift = false;
  renderUmlautKeys();
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function toggleUmlautShift() {
  umlautShift = !umlautShift;
  renderUmlautKeys();
}

function onTextInput(event) {
  lastUmlaut = null;
  if (event.nativeEvent?.isComposing ?? event.isComposing) return;
  const input = refs.text;
  const caret = input.selectionStart;
  if (caret !== input.selectionEnd || caret < 2) return;
  const typed = input.value.slice(caret - 2, caret);
  if (!/^[\"“”„][aousAOU]$/.test(typed)) return;
  input.setRangeText(UMLAUT_OF[typed[1]], caret - 2, caret, "end");
  lastUmlaut = { at: caret - 1, original: typed };
}
function onTextBeforeInput(event) {
  const input = refs.text;
  const inputType = event.nativeEvent?.inputType ?? event.inputType;
  if (inputType !== "deleteContentBackward" || !lastUmlaut) return;
  if (input.selectionStart !== input.selectionEnd || input.selectionStart !== lastUmlaut.at) return;
  event.preventDefault(); // undo the conversion instead of deleting the letter
  input.setRangeText(lastUmlaut.original, lastUmlaut.at - 1, lastUmlaut.at, "end");
  lastUmlaut = null;
}
function onTextKeyDown(event) {
  const ch = UMLAUT_KEY_CODES[event.code];
  // Not with Ctrl: AltGr is Ctrl+Alt, and keyboards that have AltGr letters type their own.
  if (!ch || !event.altKey || event.ctrlKey || event.metaKey) return;
  event.preventDefault();
  insertUmlaut(ch, { capital: event.shiftKey });
}

function setAutoSend(on) {
  state.autoSend = on;
  ui.set({ autoSend: on });
  setStatus(state.autoSend ? "Auto-send on: I'll send when you pause." : "Auto-send off: tap Send when you're done.");
  // Turning auto-send back on sends what was collected while it was off.
  if (state.autoSend && refs.text?.value.trim() && !recognizer) submitComposer();
}

function micClick() {
  if (state.settings?.live) {
    if (!live) startLive(); // after a reload or a dropped connection
    else setLiveMuted(!live.muted);
    return;
  }
  if (state.handsFree || ui.get().mic.on) {
    stopListening();
  } else {
    state.handsFree = true; // hands-free loop: talk, auto-send on pause, resume after each reply
    startListening();
  }
}

function togglePause() {
  setPaused(!state.paused);
}

// While typing on a phone the coach shows only its first two lines (CSS); tap it for the rest.
function toggleCoach() {
  const coach = ui.get().coach;
  if (coach) ui.set({ coach: { ...coach, expanded: !coach.expanded } });
}

// Say-it-again panel: speak the correction (or type it), hear it again, or move on.
function drillSay() {
  if (!state.drill || recognizer) return;
  if (state.drill.live) { // Gemini is already listening: just make sure the mic is on
    if (live?.muted) setLiveMuted(false);
    return;
  }
  refs.text?.blur(); // speaking, not typing: let the keyboard go
  setDrillFeedback("");
  startListening();
}
function drillHear() {
  if (!state.drill) return;
  if (state.drill.live) {
    if (live?.ready) liveNote(`Say «${state.drill.target}» once more, slowly, and nothing else.`);
    return;
  }
  if (recognizer) { dropNextResult = true; recognizer.abort(); }
  speak(state.drill.target, NO_WORDS, () => maybeResumeListening());
}

// Before what was heard is sent (it goes after the pause): fix it in the text box, or drop it
// and say it again.
function heardEdit() {
  if (!recognizer) return;
  const text = ui.get().heard;
  dropNextResult = true; // the text box has it now: stop the mic without sending
  recognizer.abort();
  showHeard("");
  // Focused inside the tap, so the phone keyboard opens.
  const input = refs.text;
  if (!input) return;
  input.value = text;
  input.focus();
  try { input.setSelectionRange(text.length, text.length); } catch { /* unsupported */ }
  setStatus("Fix it, then tap Send.");
}
function heardDelete() {
  if (!recognizer) return;
  redoNextResult = true;
  recognizer.abort();
  showHeard("");
}

// Quit the current conversation and return to the start screen.
function endCall() {
  officeStop();
  stopLive();
  noteLiveSubjects(); // what a live free chat was about, for the next calls
  clearLiveHandle();
  liveReconnectPending = false;
  stopListening();
  stopSpeaking();
  state.history = [];
  state.drill = null;
  ui.set({ drill: null });
  state.rapport = 0;
  state.finished = false;
  state.handsFree = false;
  pendingReply = null;
  resumeHandsFree = false;
  setPaused(false);
  clearTranscript();
  ui.set({ coach: null });
  renderSuggestions([]);
  showHeard("");
  if (refs.text) refs.text.value = "";
  setStatus("");
  renderStats();
  renderRecap();
  todayWords = null;
  callLog = [];
  chatId = null; // the chat stays saved in the list
  ui.set({ sayThis: null });
  store.set(CALL_KEY, null); // ended on purpose: nothing to resume
  renderFocusWords([]);
  ui.set({ topicWords: null });
  setBusy(false);
  leaveCall();
  ui.merge("view", { setup: true });
  renderChats();
  syncMistakes(); // the call is over: send its mistakes
  syncSpoken();
  syncSentences();
  syncUsed();
  flushChatUploads(); // and the chat, without waiting
}

// Voices load asynchronously in Chrome.
if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

// Starts Talkloop once, when the app first shows it (right after login, in the background).
let started = false;
function initTalkloop() {
  if (started) return;
  started = true;
  ui.set({
    form: {
      ...ui.get().form,
      connector: store.get("connector", "mix"),
      officeGap: store.get("office_gap", "normal"),
      sayAgain: store.get("say_again", true),
      liveVoice: liveVoiceOn(),
      grammarCheck: grammarCheckOn(),
    },
  });
  // With ?debug: which build this phone runs (a cached old one would explain old behaviour).
  debugLog(`Talkloop (React) · speech recognition ${Recognition ? "yes" : "no"}`);
  if (!trainerSession()) goToLogin();
  // Link to the Vocab Trainer right away: the AI keys come with the link, and a call from
  // before a reload can only come back once they are here.
  const linked = trainerSession() ? linkFromTrainerSession().catch(() => {}) : Promise.resolve();
  ui.set({ keyStatus: trainerSession() ? "Loading your saved AI keys…" : "" });
  refreshKeyGate();
  renderStats();
  renderBookmarks();
  renderMistakes();
  renderChats();
  linked.then(() => {
    ui.set({ keyStatus: "" });
    if (!ui.get().view.call) refreshKeyGate();
    return restoreCall();
  }).catch((error) => console.warn("Couldn't restore the call:", error));
  // The connector list, by level, as in the trainer's Connectors tab; the choice is remembered.
  loadConnectors().then((list) => {
    const groups = ["A1", "A2", "B1"].map((level) => ({
      label: level,
      options: list.filter((x) => x.level === level).map((c) => ({ value: c.key, label: `${c.name} — ${c.en}` })),
    }));
    ui.set({ connectors: groups });
    const saved = ui.get().form.connector;
    if (saved !== "mix" && !list.some((c) => c.key === saved)) ui.merge("form", { connector: "mix" });
  }).catch(() => { /* tried again at Start, which says what went wrong */ });
  // Get the voice ready while the learner picks their settings, so the first reply doesn't wait.
  preloadSelectedVoice();
  // Show the vocab kept from last time and fetch the latest in the background.
  // Then link to the Vocab Trainer with its login and fetch the learnt words.
  takeTrainerLinkFromUrl();
  vocabMeta()
    .then((m) => {
      refreshVocabUI(m.count);
      loadVocabUrl(DEFAULT_VOCAB_URL, { silent: true });
    })
    .catch(() => {})
    .finally(async () => {
      await linked;
      refreshLearntWords();
      syncMistakes();
      syncSpoken();
      syncSentences();
      syncUsed();
      syncChats().catch(() => {});
    });
  // Leaving the page (closing the tab, switching apps) sends what this device recorded.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      syncMistakes({ keepalive: true });
      syncSpoken({ keepalive: true });
      syncSentences({ keepalive: true });
      syncUsed({ keepalive: true });
      flushChatUploads({ keepalive: true });
    } else if (liveReconnectPending && !state.paused && state.settings?.live && !live && ui.get().view.call) {
      startLive(); // the live call dropped while the app was in the background
    }
  });
}

export {
  initTalkloop, keyGateInfo, editSavedKeys, saveKeys, changeKey, chooseAi, setForm, startConversation,
  openChat, deleteChat, topicChats, resetMistakes, peekWord, replayMessage, translateMessage, openExplorer,
  openLookup, submitLookup, closeExplorer, listenWord, saveExplorerWord, useSuggestion, submitComposer, sendTap,
  textFocus, textBlur, insertUmlaut, toggleUmlautShift, onTextInput, onTextBeforeInput, onTextKeyDown,
  setAutoSend, micClick, togglePause, toggleCoach, drillSay, drillHear, skipDrill, heardEdit, heardDelete, endCall,
  MODES, TENSES, PROVIDERS,
};
