// The choices on Talkloop's setup and key screens.

export const LANGUAGES = [
  { value: "Spanish", locale: "es-ES", label: "Spanish" },
  { value: "French", locale: "fr-FR", label: "French" },
  { value: "German", locale: "de-DE", label: "German" },
  { value: "Italian", locale: "it-IT", label: "Italian" },
  { value: "Japanese", locale: "ja-JP", label: "Japanese" },
  { value: "Portuguese", locale: "pt-BR", label: "Portuguese" },
];

export const NATIVE_LANGUAGES = ["English", "Hindi", "Punjabi", "Spanish"];

export const LEVELS = ["A1", "A2", "B1"];

export const MODE_OPTIONS = [
  { value: "lead", label: "Free chat — partner leads" },
  { value: "interview", label: "Interview me" },
  { value: "life", label: "Mein Leben — talk about my life" },
  { value: "story", label: "Erzähl mal — tell a story" },
  { value: "topic", label: "Discuss a topic" },
  { value: "sentences", label: "Sentence drill — my learnt words" },
  { value: "scene", label: "Scene role-play" },
  { value: "interpret", label: "Dolmetscher — say it in German" },
  { value: "connectors", label: "Konnektoren — join two sentences" },
  { value: "rolecard", label: "Rollenkarte — play a character" },
  { value: "office", label: "Büro — colleagues drop by while I work" },
];

export const OFFICE_GAPS = [
  { value: "short", label: "Often (every 4–10 min)" },
  { value: "normal", label: "Now and then (every 10–25 min)" },
  { value: "long", label: "Rarely (every 25–50 min)" },
];

export const TENSE_OPTIONS = [
  { value: "any", label: "Any tense — just talk" },
  { value: "present", label: "Present (Präsens) — ich spiele" },
  { value: "perfekt", label: "Past, spoken (Perfekt) — ich habe gespielt" },
  { value: "praeteritum", label: "Past, written (Präteritum) — ich spielte" },
  { value: "future", label: "Future (Futur I) — ich werde spielen" },
];

export const SCENE_OPTIONS = [
  {
    label: "Everyday",
    options: [
      { value: "cafe", label: "Café — order a coffee" },
      { value: "market", label: "Market — shop and haggle" },
      { value: "restaurant", label: "Restaurant — order and complain" },
      { value: "shop", label: "Clothes shop — return a jacket" },
      { value: "neighbour", label: "New neighbour — small talk" },
    ],
  },
  {
    label: "Travel",
    options: [
      { value: "station", label: "Train station — tickets and delays" },
      { value: "hotel", label: "Hotel — lost booking" },
    ],
  },
  {
    label: "Life admin",
    options: [
      { value: "doctor", label: "Doctor — describe symptoms" },
      { value: "dentist", label: "Dentist — book by phone" },
      { value: "flat", label: "Flat viewing — meet the landlady" },
      { value: "office", label: "Town hall — register your address" },
      { value: "job", label: "Job interview" },
    ],
  },
];

export const PROVIDERS = [
  { value: "groq", label: "Groq — fastest" },
  { value: "cloudflare", label: "Cloudflare Workers AI" },
  { value: "gemini", label: "Google Gemini" },
  { value: "openai", label: "OpenAI — GPT-6 Luna" },
];
