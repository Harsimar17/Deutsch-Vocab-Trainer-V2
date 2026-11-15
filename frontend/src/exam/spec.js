// The Prüfung tab's exam: a four-module Goethe-style practice paper,
// how much harder than the real one it is, and what the AI is asked to write for each Teil.
// Nothing here is a real exam text: every paper is written afresh by the learner's AI.

// ---------- how hard ----------
// The real exam is "real"; the others multiply it: harder B1 texts and trickier questions (never above the chosen level), less time, faster audio
// heard once, a higher pass mark, longer texts to write, a tougher examiner.
export const DIFFICULTIES = {
  real: {
    label: "Original", factor: "×1", blurb: "Volle Zeit, 60 % zum Bestehen.",
    time: 1, pass: 60, rate: 1, twice: true, words: 1, prep: 15, planTurns: 5, questions: 1,
    language: "Match the real Goethe-Zertifikat at the selected level exactly, in language and in how hard the tasks are.",
    examiner: "You are friendly and patient, as in the real exam.",
    grading: "Grade fairly against the selected CEFR level.",
  },
  hard: {
    label: "Schwer", factor: "×1,5", blurb: "Etwas anspruchsvoller, 20 % weniger Zeit, Audio nur einmal, 70 % zum Bestehen.",
    time: 0.8, pass: 70, rate: 1.1, twice: false, words: 1.25, prep: 10, planTurns: 6, questions: 2,
    language: "Raise the difficulty INSIDE the selected CEFR level, never above it: write at the upper end of that level (its full everyday vocabulary, a wide variety of linking words and sentence structures from that level, "
      + "the same text lengths as in the Original setting), so a strong learner of that level can still read every sentence. "
      + "Also make the questions harder: less obvious clues, the correct answer always paraphrased (never in the text's own words), and every wrong option made plausible by something the text really mentions.",
    examiner: "You are correct but demanding: you ask follow-up questions (warum, zum Beispiel, und wenn …?), do not accept one-word answers, "
      + "and in the planning task you disagree with some suggestions and raise a practical problem.",
    grading: "Grade strictly for the selected CEFR level; borderline work should not pass.",
  },
  extreme: {
    label: "Extrem", factor: "×2", blurb: "Maximal anspruchsvoll, 35 % weniger Zeit, Audio nur einmal, 80 % zum Bestehen.",
    time: 0.65, pass: 80, rate: 1.2, twice: false, words: 1.5, prep: 5, planTurns: 7, questions: 3,
    language: "Raise the difficulty as far as possible INSIDE the selected CEFR level, never above it: write at the very top of that level (its full everyday vocabulary and the widest variety of linking words and sentence structures from that level, "
      + "the same text lengths as in the Original setting), but every word and structure must still belong to that level, not the next one. "
      + "Also make the questions harder: the correct answer is always paraphrased, wrong options differ from the truth in a single small detail stated in the text, varying which kind of detail from question to question, "
      + "and the deciding information is spread over two nearby sentences rather than sitting in one. Never rely on irony, implication or reading between the lines.",
    examiner: "You are a strict examiner under time pressure: you interrupt long pauses with a new question, challenge every opinion with a counter-argument, "
      + "ask for precise reasons and examples, and in the planning task you reject the first suggestion and change one condition halfway through.",
    grading: "Grade strictly against the selected CEFR level; reward accurate, appropriate language and task completion.",
  },
};

// Each level has the real Goethe-Zertifikat's own modules, times and Teile.
const MODULE_INFO = {
  A1: [
    { id: "lesen", label: "Lesen", minutes: 25, about: "3 Teile · 15 Aufgaben" },
    { id: "hoeren", label: "Hören", minutes: 20, about: "3 Teile · 15 Aufgaben" },
    { id: "schreiben", label: "Schreiben", minutes: 20, about: "2 Aufgaben · KI-Bewertung" },
    { id: "sprechen", label: "Sprechen", minutes: 15, about: "3 Teile · KI-Prüferin" },
  ],
  A2: [
    { id: "lesen", label: "Lesen", minutes: 30, about: "4 Teile · 20 Aufgaben" },
    { id: "hoeren", label: "Hören", minutes: 30, about: "4 Teile · 20 Aufgaben" },
    { id: "schreiben", label: "Schreiben", minutes: 30, about: "2 Aufgaben · KI-Bewertung" },
    { id: "sprechen", label: "Sprechen", minutes: 15, about: "3 Teile · KI-Prüferin" },
  ],
  B1: [
    { id: "lesen", label: "Lesen", minutes: 65, about: "5 Teile · 30 Aufgaben" },
    { id: "hoeren", label: "Hören", minutes: 40, about: "4 Teile · 30 Aufgaben" },
    { id: "schreiben", label: "Schreiben", minutes: 60, about: "3 Aufgaben · KI-Bewertung" },
    { id: "sprechen", label: "Sprechen", minutes: 15, about: "3 Teile · KI-Prüferin" },
  ],
};
export const modulesFor = (level = "B1") => MODULE_INFO[level] ?? MODULE_INFO.B1;
export const MODULES = MODULE_INFO.B1; // the same four ids and labels at every level
export const moduleMinutes = (id, diff, level = "B1") => Math.max(5, Math.round(modulesFor(level).find((m) => m.id === id).minutes * DIFFICULTIES[diff].time));
const wordTarget = (words, diff) => Math.max(20, Math.round((words * DIFFICULTIES[diff].words) / 5) * 5);

// ---------- schema shorthands (the shape Talkloop's aiJson takes) ----------
const S = { type: "STRING" };
const I = { type: "INTEGER" };
const B = { type: "BOOLEAN" };
const obj = (properties) => ({ type: "OBJECT", properties, required: Object.keys(properties) });
const arr = (items) => ({ type: "ARRAY", items });
const LINE = obj({ speaker: S, gender: { type: "STRING", enum: ["m", "f"] }, text: S });
const MC = obj({ question: S, options: arr(S), answer: I, why: S });
const RF = obj({ statement: S, correct: B, why: S });

// ---------- subjects, so two papers are not alike ----------
const TOPICS = {
  l1: ["ein Umzug in eine andere Stadt", "ein Sprachkurs im Ausland", "ein missglückter Urlaub", "ein neues Hobby im Verein", "das erste Jahr in der Ausbildung", "ein Wochenende ohne Handy", "eine Fahrradtour mit Panne", "ein Praktikum in einem Hotel", "ein Nachbarschaftsfest", "ein Jahr als Au-pair", "eine Wohnungssuche", "ein Ehrenamt im Tierheim"],
  l2: ["Stadtbibliothek mit neuen Angeboten", "Urban Gardening", "Reparatur-Cafés", "Carsharing auf dem Land", "Jugendliche und Vereine", "Lebensmittelrettung", "Homeoffice und Pendeln", "Nachtzüge in Europa", "ein Stadtteilfest", "Lernen mit Apps", "Müllvermeidung im Supermarkt", "Fahrradstraßen in der Innenstadt"],
  l3: ["Kurse und Freizeitangebote", "Wohnen und Möbel", "Jobs und Nebenjobs", "Reisen und Ausflüge", "Dienstleistungen in der Stadt", "Sport und Gesundheit", "Veranstaltungen am Wochenende", "Weiterbildung und Sprachen"],
  l4: ["Sollten Geschäfte am Sonntag geöffnet sein?", "Handyverbot an Schulen?", "Ein autofreier Tag pro Woche in der Stadt?", "Sollte man Haustiere in Mietwohnungen erlauben?", "Hausaufgaben abschaffen?", "Ist Online-Shopping besser als Einkaufen im Laden?", "Sollten alle ein soziales Jahr machen?", "Tempolimit auf der Autobahn?", "Vier-Tage-Woche für alle?", "Fleischfreier Tag in der Kantine?"],
  l5: ["Hausordnung eines Mietshauses", "Benutzungsordnung einer Stadtbibliothek", "Regeln eines Fitnessstudios", "Teilnahmebedingungen eines Sprachkurses", "Ordnung eines Schwimmbads", "Regeln eines Studentenwohnheims", "Nutzungsbedingungen eines Leihfahrrads", "Regeln einer Betriebskantine", "Campingplatzordnung", "Bedingungen einer Mitfahrzentrale"],
  h1: ["Durchsagen und Nachrichten aus dem Alltag"],
  h2: ["Führung durch ein Stadtmuseum", "Einweisung am ersten Arbeitstag", "Begrüßung auf einem Campingplatz", "Führung durch eine Schokoladenfabrik", "Informationen zu Beginn einer Busreise", "Einführung in eine Universitätsbibliothek", "Rundgang durch einen Zoo", "Start eines Kochkurses", "Besichtigung eines Schlosses", "Informationsabend eines Sportvereins"],
  h3: ["zwei Bekannte treffen sich zufällig im Zug", "Gespräch über einen Umzug", "Kollegen planen eine Feier", "Freunde sprechen über einen Urlaub", "Nachbarn über ein Problem im Haus", "Gespräch über einen neuen Job", "Geschwister planen ein Geschenk", "Studierende über eine Prüfung"],
  h4: ["Sollen Kinder Taschengeld für Hausarbeit bekommen?", "Leben in der Stadt oder auf dem Land?", "Braucht jeder ein Smartphone ab zehn Jahren?", "Ist Urlaub zu Hause besser als Fernreisen?", "Arbeiten im Homeoffice?", "Soll man mit 16 Auto fahren dürfen?", "Sind Noten in der Schule sinnvoll?", "Haustiere in der Stadt?", "Second-Hand statt neu kaufen?", "Sport als Pflichtfach bis zum Abschluss?"],
  write: ["ein Fest, das du verpasst hast", "ein Konzertbesuch", "ein Umzug", "ein neuer Job", "eine Reise", "ein Kurs", "ein Geburtstag", "ein Unfall mit dem Fahrrad", "ein Besuch aus dem Heimatland", "eine bestandene Prüfung"],
  speak: ["Soziale Medien", "Vegetarisch essen", "Sport im Verein", "Reisen ohne Flugzeug", "Fernsehen und Streaming", "Wohnen bei den Eltern", "Fremdsprachen lernen", "Einkaufen im Internet", "Haustiere", "Arbeiten neben dem Studium", "Fahrrad statt Auto", "Computerspiele"],
};
Object.assign(TOPICS, {
  a1msg: ["eine Einladung zum Essen", "ein Treffen am Wochenende", "ein Termin beim Arzt", "ein Besuch bei Freunden", "ein Ausflug mit der Familie", "Einkaufen für eine Party", "ein neuer Kurs", "die neue Wohnung"],
  a1where: ["am Bahnhof", "im Supermarkt", "in der Sprachschule", "beim Arzt", "im Kaufhaus", "in der Stadt", "im Hotel", "im Restaurant"],
  a1speak: ["Essen und Trinken", "Einkaufen", "Wohnen", "Freizeit", "Reisen", "Arbeit", "Familie", "Kleidung"],
  a2news: ["ein Stadtfest", "ein neues Schwimmbad", "ein Flohmarkt für Kinder", "ein Kochkurs für Männer", "ein junger Musiker aus der Stadt", "ein neuer Radweg", "eine Ausstellung im Museum", "ein Tag der offenen Tür"],
  a2place: ["ein Kaufhaus", "ein Ärztehaus", "ein Rathaus", "eine Volkshochschule", "ein Einkaufszentrum", "eine Universität"],
  a2mail: ["ein Besuch in einer anderen Stadt", "der erste Tag im neuen Job", "eine Geburtstagsfeier", "ein Umzug", "ein Wochenende auf dem Land", "ein Sprachkurs"],
  a2ads: ["Kurse", "Wohnungen und Zimmer", "Jobs", "Reisen", "Freizeit", "Sport"],
  a2talk: ["Freizeit", "Wohnen", "Essen", "Feste", "Arbeit und Schule", "Urlaub", "Einkaufen", "Sport"],
});
const USED_KEY = "exam_used_topics";
function pick(kind, n = 1) {
  let used = {};
  try { used = JSON.parse(localStorage.getItem(USED_KEY)) || {}; } catch { /* storage blocked */ }
  const had = used[kind] ?? [];
  const pool = TOPICS[kind];
  const fresh = pool.filter((t) => !had.includes(t));
  const from = (fresh.length >= n ? fresh : pool).slice().sort(() => Math.random() - 0.5).slice(0, n);
  used[kind] = [...from, ...had].slice(0, Math.max(0, pool.length - n));
  try { localStorage.setItem(USED_KEY, JSON.stringify(used)); } catch { /* storage blocked */ }
  return n === 1 ? from[0] : from;
}

const LEVEL_GUIDE = {
  A1: "Use very common everyday vocabulary, short simple main clauses, mostly present tense, and one clear idea per sentence. Avoid subordinate clauses and abstract topics.",
  A2: "Use common everyday vocabulary and short sentences. Present, Perfekt and simple future are suitable; use only simple weil, dass or wenn clauses and familiar topics.",
  B1: "Use natural but clear intermediate German: connected texts, common subordinate clauses, reasons, opinions and everyday abstract topics.",
};
// What pushes a text above the selected level. The difficulty setting must never add any of it.
const LEVEL_CEILING = {
  A1: "Nothing that reads as A2 or higher: only very common everyday words and short, simple sentences, mostly present tense, as in the real Goethe A1 exam.",
  A2: "Nothing that reads as B1 or higher: everyday words and short, clear sentences with only simple subordinate clauses, as in the real Goethe A2 exam.",
  B1: "Nothing that reads as B2 or C1: no indirect speech in Konjunktiv I, no long participle attributes, no chains of nominalised phrases, "
    + "no genitive chains, no long compound nouns from administration, politics or technology, no formal set phrases, no specialist, academic or idiomatic language, no irony; a word outside the B1 vocabulary is allowed only when its meaning is clear from the context, as in the real exam. "
    + "Opinions and facts are stated, not merely implied.",
};
export const examBlurb = (diff, level) => `${level}: ${DIFFICULTIES[diff].blurb}`;

export function systemPrompt(diff, level = "B1") {
  return `You write original German CEFR ${level} practice papers for adult learners, using the four-module Goethe-style practice format. Never reproduce a real exam text: invent everything. `
    + "Everything the candidate reads or hears is in German, with correct spelling: always write the characters ä, ö, ü and ß, never ae, oe, ue or ss in their place. "
    + `Target level: ${level}. ${LEVEL_GUIDE[level] ?? LEVEL_GUIDE.B1} Keep the grammar, vocabulary, task wording, answer options, audio and model responses suitable for ${level}. `
    + `The paper follows the real Goethe-Zertifikat ${level} exactly: its Teile, task types, numbers of items and text lengths as given in each task request. `
    + `${DIFFICULTIES[diff].language} `
    + `Lower limit: the paper is never easier than the real Goethe-Zertifikat ${level}. Texts are as long and as natural as there, using every grammar structure that belongs to ${level}, `
    + `and the tasks are at least as demanding. Press texts read like the exam's own texts for learners, not like a national newspaper. `
    + `Upper limit: whatever the difficulty, nothing goes above ${level}. ${LEVEL_CEILING[level] ?? LEVEL_CEILING.B1} `
    + `Before answering, reread every text and check both limits: nothing simpler than the real ${level} exam, nothing that belongs to the next level. `
    + "Every answer must be decidable from the text alone, with exactly one defensible solution. Spread the correct answers evenly and unpredictably over the options. "
    + "Each \"why\" is one short German sentence naming the passage that decides the answer.";
}

// ---------- the Teile ----------
const RF_OPTIONS = ["Richtig", "Falsch"];
const letter = (i) => "abcdefghij"[i];
const text = (v) => (typeof v === "string" ? v.trim() : "");
const list = (v) => (Array.isArray(v) ? v : []);
const index = (v, n) => (Number.isInteger(v) && v >= 0 && v < n ? v : -1);
const rfItem = (s) => ({ prompt: text(s?.statement), options: RF_OPTIONS, answer: s?.correct === true ? 0 : s?.correct === false ? 1 : -1, why: text(s?.why) });
const mcItem = (q) => {
  const options = list(q?.options).map(text).filter(Boolean).slice(0, 3);
  return { prompt: text(q?.question), options, answer: index(q?.answer, options.length), why: text(q?.why), letters: true };
};
const lines = (v) => list(v).map((l) => ({ speaker: text(l?.speaker), gender: l?.gender === "f" ? "f" : "m", text: text(l?.text) })).filter((l) => l.text);

// Each Teil: what the candidate is told, what the AI is asked for, and how its answer
// becomes sections of {text | texts | audio, items}. An item is {prompt, options, answer, why}.
const TEILE_B1 = {
  lesen: [
    {
      title: "Teil 1", instruction: "Lesen Sie den Text und die Aufgaben 1 bis 6 dazu. Wählen Sie: Sind die Aussagen Richtig oder Falsch?", count: 6,
      prompt: () => `Lesen Teil 1. Write a personal blog entry or e-mail (first person, 280–330 words at real-exam length) about: ${pick("l1")}. `
        + "Then 6 statements about it, in the order of the text, to be judged Richtig or Falsch (about half each).",
      schema: obj({ title: S, text: S, statements: arr(RF) }),
      build: (r) => [{ title: text(r.title), text: text(r.text), items: list(r.statements).slice(0, 6).map(rfItem) }],
    },
    {
      title: "Teil 2", instruction: "Lesen Sie die zwei Texte aus der Presse und die Aufgaben 7 bis 12 dazu. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c.", count: 6,
      prompt: () => {
        const [a, b] = pick("l2", 2);
        return `Lesen Teil 2. Write two short press reports (each 180–220 words at real-exam length), one about "${a}", one about "${b}", `
          + "in the style of a newspaper for B1 learners: concrete facts, people and numbers in everyday words, the way a journalist would explain it to a neighbour. "
          + "Where a press phrase comes to mind, use the plain everyday wording instead. "
          + "For each text 3 multiple-choice questions with options a, b, c: the first asks what the text is about as a whole, the other two ask for details. \"answer\" is the index (0–2) of the correct option.";
      },
      schema: obj({ texts: arr(obj({ title: S, text: S, questions: arr(MC) })) }),
      build: (r) => list(r.texts).slice(0, 2).map((t) => ({ title: text(t.title), text: text(t.text), items: list(t.questions).slice(0, 3).map(mcItem) })),
    },
    {
      title: "Teil 3", instruction: "Lesen Sie die Situationen 13 bis 19 und die Anzeigen a bis j. Welche Anzeige passt zu welcher Situation? Sie können jede Anzeige nur einmal verwenden. Für eine Situation gibt es keine passende Anzeige: Wählen Sie dann 0.", count: 7,
      prompt: () => `Lesen Teil 3. Theme: ${pick("l3")}. Write 10 short advertisements (40–60 words each, with realistic details: times, prices, conditions) and 7 situations `
        + "(one or two sentences: a person who is looking for something specific). Exactly 6 situations match exactly one advertisement each (each advertisement at most once); "
        + "exactly 1 situation matches none, although one advertisement seems to fit at first sight. Several advertisements are similar, so that details decide. "
        + "\"ad\" is the number of the matching advertisement (1–10 in the order given), or 0 for none. Do not put the situations in the order of the advertisements.",
      schema: obj({ ads: arr(obj({ title: S, text: S })), situations: arr(obj({ text: S, ad: I, why: S })) }),
      build: (r) => {
        const ads = list(r.ads).slice(0, 10).map((a, i) => ({ label: letter(i), title: text(a.title), text: text(a.text) }));
        const options = [...ads.map((a) => a.label), "0"];
        return [{
          texts: ads, select: true,
          items: list(r.situations).slice(0, 7).map((s) => ({
            prompt: text(s.text), options, why: text(s.why), select: true,
            answer: s.ad === 0 ? ads.length : index(s.ad - 1, ads.length),
          })),
        }];
      },
    },
    {
      title: "Teil 4", instruction: "Lesen Sie die Texte 20 bis 26. Wählen Sie: Ist die Person für das, wonach gefragt wird (Ja), oder dagegen (Nein)?", count: 7,
      prompt: () => `Lesen Teil 4. A magazine asked its readers: "${pick("l4")}". Write 7 reader comments (45–70 words each, each by a named person with a different view and reason). `
        + "For each: does the person support it (agrees true) or reject it (agrees false)? About half each. Several comments weigh both sides before reaching their opinion, so the first sentence does not give it away.",
      schema: obj({ question: S, comments: arr(obj({ name: S, text: S, agrees: B, why: S })) }),
      build: (r) => [{
        title: text(r.question),
        items: list(r.comments).slice(0, 7).map((c) => ({ prompt: text(c.name), context: text(c.text), options: ["Ja", "Nein"], answer: c.agrees === true ? 0 : c.agrees === false ? 1 : -1, why: text(c.why) })),
      }],
    },
    {
      title: "Teil 5", instruction: "Lesen Sie den Text und die Aufgaben 27 bis 30 dazu. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c.", count: 4,
      prompt: () => `Lesen Teil 5. Write a set of rules: ${pick("l5")} (250–300 words at real-exam length, in sections with headings, formal language as in real house rules). `
        + "Then 4 tasks: each \"question\" is the beginning of a sentence, and the options a, b, c complete it; only one is true according to the rules. \"answer\" is the index (0–2).",
      schema: obj({ title: S, text: S, questions: arr(MC) }),
      build: (r) => [{ title: text(r.title), text: text(r.text), items: list(r.questions).slice(0, 4).map(mcItem) }],
    },
  ],
  hoeren: [
    {
      title: "Teil 1", instruction: "Sie hören fünf kurze Texte. Zu jedem Text lösen Sie zwei Aufgaben: Richtig oder Falsch, und a, b oder c. Lesen Sie zuerst die Aufgaben.", count: 10, twice: true,
      prompt: () => "Hören Teil 1. Write 5 short everyday recordings of different kinds (a voicemail message, a station or airport announcement, a radio weather or traffic report, "
        + "an announcement in a shop or museum, a recorded telephone information service; each 60–90 words at real-exam length, each as lines by one speaker with a name or role and a gender). "
        + "For each recording: one statement about its overall content to judge Richtig/Falsch, and one multiple-choice question about a detail (a number, time, place or instruction) with options a, b, c. "
        + "Each recording names several times, prices or places, so the detail has to be picked out. \"answer\" is the index (0–2).",
      schema: obj({ clips: arr(obj({ kind: S, lines: arr(LINE), statement: S, correct: B, question: S, options: arr(S), answer: I, why: S })) }),
      build: (r) => list(r.clips).slice(0, 5).map((c, i) => ({
        audio: { label: `Text ${i + 1}`, lines: lines(c.lines) },
        items: [rfItem(c), mcItem(c)],
      })),
    },
    {
      title: "Teil 2", instruction: "Sie hören einen Text. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c. Lesen Sie zuerst die Aufgaben 11 bis 15.", count: 5, twice: false,
      prompt: () => `Hören Teil 2. One person speaks to a group: ${pick("h2")} (a monologue of 300–350 words at real-exam length, as lines by that one speaker, spoken language with times, rules and small asides). `
        + "Then 5 multiple-choice questions in the order of the talk, options a, b, c, \"answer\" the index (0–2). \"intro\" says in one German sentence who is speaking where.",
      schema: obj({ intro: S, lines: arr(LINE), questions: arr(MC) }),
      build: (r) => [{ title: text(r.intro), audio: { label: "Text", lines: lines(r.lines) }, items: list(r.questions).slice(0, 5).map(mcItem) }],
    },
    {
      title: "Teil 3", instruction: "Sie hören ein Gespräch. Wählen Sie: Sind die Aussagen Richtig oder Falsch? Lesen Sie zuerst die Aufgaben 16 bis 22.", count: 7, twice: false,
      prompt: () => `Hören Teil 3. A private conversation between a woman and a man: ${pick("h3")} (350–420 words at real-exam length, natural spoken German, short turns, `
        + "they correct themselves and each other now and then). Then 7 statements in the order of the conversation to judge Richtig/Falsch (about half each); "
        + "each statement says who it is about. \"intro\" says in one German sentence who is talking where.",
      schema: obj({ intro: S, lines: arr(LINE), statements: arr(RF) }),
      build: (r) => [{ title: text(r.intro), audio: { label: "Gespräch", lines: lines(r.lines) }, items: list(r.statements).slice(0, 7).map(rfItem) }],
    },
    {
      title: "Teil 4", instruction: "Sie hören eine Diskussion im Radio. Wer sagt was? Ordnen Sie die Aussagen 23 bis 30 zu. Lesen Sie zuerst die Aussagen.", count: 8, twice: true,
      prompt: () => `Hören Teil 4. A radio discussion: a moderator and two guests (one woman, one man, with full names and a role each) discuss "${pick("h4")}" `
        + "(420–500 words at real-exam length; the guests disagree on some points and agree on others; the moderator also gives views and facts). "
        + "Then 8 statements, each an opinion or claim that exactly ONE of the three makes in the discussion, paraphrased, in the order they come up: \"who\" is 0 for the moderator, 1 for the first guest, 2 for the second. "
        + "Use each of the three at least twice. The \"speaker\" of every line is that person's full name.",
      schema: obj({ topic: S, moderator: S, guests: arr(S), lines: arr(LINE), statements: arr(obj({ statement: S, who: I, why: S })) }),
      build: (r) => {
        const options = [`Moderator/in${text(r.moderator) ? ` (${text(r.moderator)})` : ""}`, ...list(r.guests).slice(0, 2).map(text)];
        return [{
          title: text(r.topic), audio: { label: "Diskussion", lines: lines(r.lines) },
          items: list(r.statements).slice(0, 8).map((s) => ({ prompt: text(s.statement), options, answer: index(s.who, options.length), why: text(s.why) })),
        }];
      },
    },
  ],
};

const CLIP = obj({ lines: arr(LINE), question: S, options: arr(S), answer: I, why: S });
const mcClips = (r, n) => list(r.clips).slice(0, n).map((c, i) => ({ audio: { label: `Text ${i + 1}`, lines: lines(c.lines) }, items: [mcItem(c)] }));

// Goethe-Zertifikat A1 (Start Deutsch 1): Lesen 3 Teile / 15, Hören 3 Teile / 15.
const TEILE_A1 = {
  lesen: [
    {
      title: "Teil 1", instruction: "Lesen Sie die zwei Texte und die Aufgaben 1 bis 5. Wählen Sie: Richtig oder Falsch?", count: 5,
      prompt: () => `Lesen Teil 1. Write two short personal messages (a note, an SMS or an e-mail, each 40–70 words, signed with a first name) about: ${pick("a1msg", 2).join(" and ")}. `
        + "The first text gets 2 statements, the second 3, in the order of the text, to be judged Richtig or Falsch.",
      schema: obj({ texts: arr(obj({ title: S, text: S, statements: arr(RF) })) }),
      build: (r) => list(r.texts).slice(0, 2).map((t, i) => ({ title: text(t.title), text: text(t.text), items: list(t.statements).slice(0, i ? 3 : 2).map(rfItem) })),
    },
    {
      title: "Teil 2", instruction: "Lesen Sie die Texte und die Aufgaben 6 bis 10. Wo finden Sie Informationen? Wählen Sie a oder b.", count: 5,
      prompt: () => "Lesen Teil 2. Write 5 tasks. Each has a \"situation\" (one sentence: what someone wants to find out or do) and two short web pages or advertisements, a and b "
        + "(each a title and 15–35 words with concrete details such as times, prices or addresses). Exactly one of them helps in the situation; \"answer\" is 0 for a, 1 for b.",
      schema: obj({ tasks: arr(obj({ situation: S, a: obj({ title: S, text: S }), b: obj({ title: S, text: S }), answer: I, why: S })) }),
      // The AI favours "a", so each pair is swapped at random.
      build: (r) => list(r.tasks).slice(0, 5).map((t) => {
        const pair = [t.a, t.b].map((x) => ({ title: text(x?.title), text: text(x?.text) }));
        let answer = index(t.answer, 2);
        if (Math.random() < 0.5) { pair.reverse(); if (answer >= 0) answer = 1 - answer; }
        return {
          texts: pair.map((x, i) => ({ label: letter(i), ...x })),
          items: [{ prompt: text(t.situation), options: ["a", "b"], answer, why: text(t.why) }],
        };
      }),
    },
    {
      title: "Teil 3", instruction: "Lesen Sie die Texte und die Aufgaben 11 bis 15. Wählen Sie: Richtig oder Falsch?", count: 5,
      prompt: () => "Lesen Teil 3. Write 5 short signs or notices (Schilder, Aushänge) from everyday places, each 10–30 words, with a \"place\" where it hangs "
        + `(for example ${pick("a1where", 3).join(", ")}). For each one statement to judge Richtig or Falsch.`,
      schema: obj({ signs: arr(obj({ place: S, text: S, statement: S, correct: B, why: S })) }),
      build: (r) => list(r.signs).slice(0, 5).map((x) => ({ title: text(x.place), text: text(x.text), items: [rfItem(x)] })),
    },
  ],
  hoeren: [
    {
      title: "Teil 1", instruction: "Was ist richtig? Wählen Sie a, b oder c. Lesen Sie zuerst die Aufgaben.", count: 6, twice: true,
      prompt: () => "Hören Teil 1. Write 6 short everyday dialogues between two people (each 30–60 words: in a shop, at the station, on the phone, at work, at home), "
        + "each with one question about a detail (a time, price, place, number or thing) and options a, b, c that are all mentioned or plausible. \"answer\" is the index (0–2).",
      schema: obj({ clips: arr(CLIP) }),
      build: (r) => mcClips(r, 6),
    },
    {
      title: "Teil 2", instruction: "Wählen Sie: Richtig oder Falsch? Lesen Sie zuerst die Aufgaben.", count: 4, twice: false,
      prompt: () => "Hören Teil 2. Write 4 public announcements (at the airport, at the station, in a supermarket or department store, on the radio; each 25–50 words, one speaker). "
        + "For each one statement to judge Richtig or Falsch.",
      schema: obj({ clips: arr(obj({ lines: arr(LINE), statement: S, correct: B, why: S })) }),
      build: (r) => list(r.clips).slice(0, 4).map((c, i) => ({ audio: { label: `Text ${i + 1}`, lines: lines(c.lines) }, items: [rfItem(c)] })),
    },
    {
      title: "Teil 3", instruction: "Was ist richtig? Wählen Sie a, b oder c. Lesen Sie zuerst die Aufgaben.", count: 5, twice: true,
      prompt: () => "Hören Teil 3. Write 5 messages on an answering machine or voicemail (each 30–60 words, one caller with a name), "
        + "each with one question about a detail and options a, b, c. \"answer\" is the index (0–2).",
      schema: obj({ clips: arr(CLIP) }),
      build: (r) => mcClips(r, 5),
    },
  ],
};

// Goethe-Zertifikat A2: Lesen 4 Teile / 20, Hören 4 Teile / 20.
const TEILE_A2 = {
  lesen: [
    {
      title: "Teil 1", instruction: "Lesen Sie den Text aus der Zeitung und die Aufgaben 1 bis 5. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c.", count: 5,
      prompt: () => `Lesen Teil 1. Write a short local newspaper article (150–200 words) about: ${pick("a2news")}. `
        + "Then 5 multiple-choice questions in the order of the text, options a, b, c, \"answer\" the index (0–2).",
      schema: obj({ title: S, text: S, questions: arr(MC) }),
      build: (r) => [{ title: text(r.title), text: text(r.text), items: list(r.questions).slice(0, 5).map(mcItem) }],
    },
    {
      title: "Teil 2", instruction: "Lesen Sie die Aufgaben 6 bis 10 und die Informationstafel. Wohin gehen Sie? Wählen Sie die richtige Lösung a, b oder c.", count: 5,
      prompt: () => `Lesen Teil 2. Write the information board (Wegweiser) of ${pick("a2place")}: 4–5 floors, each with 3–6 departments, rooms or services, one floor per line `
        + "(\"Erdgeschoss: …\"). Then 5 situations (one sentence: what a person needs). Options a, b, c are floors; the third option is always \"anderer Stock\". "
        + "Several departments sound alike, so details decide. \"answer\" is the index (0–2).",
      schema: obj({ title: S, text: S, questions: arr(MC) }),
      build: (r) => [{ title: text(r.title), text: text(r.text), items: list(r.questions).slice(0, 5).map(mcItem) }],
    },
    {
      title: "Teil 3", instruction: "Lesen Sie die E-Mail und die Aufgaben 11 bis 15. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c.", count: 5,
      prompt: () => `Lesen Teil 3. Write a personal e-mail (130–170 words) to a friend about: ${pick("a2mail")}. `
        + "Then 5 multiple-choice questions in the order of the text, options a, b, c, \"answer\" the index (0–2).",
      schema: obj({ title: S, text: S, questions: arr(MC) }),
      build: (r) => [{ title: text(r.title), text: text(r.text), items: list(r.questions).slice(0, 5).map(mcItem) }],
    },
    {
      title: "Teil 4", instruction: "Lesen Sie die Aufgaben 16 bis 20 und die Anzeigen a bis f. Welche Anzeige passt zu welcher Person? Für eine Aufgabe gibt es keine Lösung: Wählen Sie dann 0.", count: 5,
      prompt: () => `Lesen Teil 4. Theme: ${pick("a2ads")}. Write 6 short advertisements (25–45 words each, with times, prices or conditions) and 5 situations `
        + "(one sentence: a person looking for something). Exactly 4 situations match exactly one advertisement each; exactly 1 matches none, although one advertisement seems to fit. "
        + "\"ad\" is the number of the matching advertisement (1–6 in the order given), or 0 for none. Do not put the situations in the order of the advertisements.",
      schema: obj({ ads: arr(obj({ title: S, text: S })), situations: arr(obj({ text: S, ad: I, why: S })) }),
      build: (r) => {
        const ads = list(r.ads).slice(0, 6).map((a, i) => ({ label: letter(i), title: text(a.title), text: text(a.text) }));
        const options = [...ads.map((a) => a.label), "0"];
        return [{
          texts: ads, select: true,
          items: list(r.situations).slice(0, 5).map((x) => ({ prompt: text(x.text), options, why: text(x.why), select: true, answer: x.ad === 0 ? ads.length : index(x.ad - 1, ads.length) })),
        }];
      },
    },
  ],
  hoeren: [
    {
      title: "Teil 1", instruction: "Sie hören fünf kurze Texte. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c. Lesen Sie zuerst die Aufgaben.", count: 5, twice: true,
      prompt: () => "Hören Teil 1. Write 5 short recordings of different kinds (a radio announcement, a weather or traffic report, a voicemail message, a station announcement, "
        + "a telephone information service; each 40–70 words, one speaker). Each with one question about a detail and options a, b, c. \"answer\" is the index (0–2).",
      schema: obj({ clips: arr(CLIP) }),
      build: (r) => mcClips(r, 5),
    },
    {
      title: "Teil 2", instruction: "Sie hören ein Gespräch. Was passt zu wem (oder zu welchem Tag)? Wählen Sie für jede Aufgabe eine Lösung a bis i. Lesen Sie zuerst die Aufgaben.", count: 5, twice: false,
      prompt: () => "Hören Teil 2. A conversation between two people (180–250 words) in which 5 people or 5 days are each linked to one thing (a present, an activity, a food, a job). "
        + "\"items\" are those 5 people or days in the order they come up; \"choices\" are 9 short things (a–i), 5 of them correct and 4 that are mentioned or plausible but wrong; "
        + "\"answer\" is the index (0–8) of the matching choice. \"intro\" says in one German sentence who is talking about what.",
      schema: obj({ intro: S, lines: arr(LINE), choices: arr(S), items: arr(obj({ who: S, answer: I, why: S })) }),
      build: (r) => {
        const choices = list(r.choices).map(text).filter(Boolean).slice(0, 9);
        return [{
          title: text(r.intro), audio: { label: "Gespräch", lines: lines(r.lines) },
          items: list(r.items).slice(0, 5).map((x) => ({ prompt: text(x.who), options: choices, answer: index(x.answer, choices.length), why: text(x.why), select: true, plain: true })),
        }];
      },
    },
    {
      title: "Teil 3", instruction: "Sie hören fünf kurze Gespräche. Wählen Sie bei jeder Aufgabe die richtige Lösung a, b oder c. Lesen Sie zuerst die Aufgaben.", count: 5, twice: true,
      prompt: () => "Hören Teil 3. Write 5 short everyday dialogues between two people (each 40–70 words), each with one question and options a, b, c. \"answer\" is the index (0–2).",
      schema: obj({ clips: arr(CLIP) }),
      build: (r) => mcClips(r, 5),
    },
    {
      title: "Teil 4", instruction: "Sie hören ein Interview. Wählen Sie für die Aufgaben 16 bis 20: Ja oder Nein? Lesen Sie zuerst die Aufgaben.", count: 5, twice: true,
      prompt: () => `Hören Teil 4. A radio interview (220–300 words): a presenter talks with a person about ${pick("a2talk")} in their life. `
        + "Then 5 statements in the order of the interview, each to be answered Ja or Nein (correct true for Ja). \"intro\" says in one German sentence who is interviewed.",
      schema: obj({ intro: S, lines: arr(LINE), statements: arr(RF) }),
      build: (r) => [{ title: text(r.intro), audio: { label: "Interview", lines: lines(r.lines) }, items: list(r.statements).slice(0, 5).map((x) => ({ ...rfItem(x), options: ["Ja", "Nein"] })) }],
    },
  ],
};
export const teileFor = (moduleId, level = "B1") => ({ A1: TEILE_A1, A2: TEILE_A2 }[level] ?? TEILE_B1)[moduleId];

// A Teil is usable when it has its items, each with a prompt and a valid answer, and its material.
export function validTeil(spec, sections) {
  const items = sections.flatMap((s) => s.items);
  if (items.length < spec.count) return false;
  if (items.some((i) => !i.prompt || i.answer < 0 || i.options.length < 2)) return false;
  return sections.every((s) => s.text || s.texts?.length || s.audio?.lines.length || s.items.every((i) => i.context));
}

// ---------- Schreiben ----------
// The real Goethe tasks per level. A1 Teil 1 is a form to fill in from a short text; every
// other task is a text with three content points. "max" are the real exam's points per task.
export const writePrompt = (diff, level = "B1") => {
  const [a, b] = pick("write", 2);
  if (level === "A1") {
    return {
      text: "Schreiben, Goethe A1. Write the two tasks in German, addressed to the candidate with \"Sie\":\n"
        + "1. \"situation\": a short text (50–70 words) about a person who needs a form (a course registration, a hotel, a library card, a sports club, a travel booking), "
        + "with all the details needed. \"form\" is the form's title; \"fields\" are exactly 5 empty fields (\"label\" as on the form, for example Familienname, Geburtsdatum, Kursbeginn, Zahlungsweise; "
        + "\"answer\" the short correct entry from the text). The candidate fills them in.\n"
        + `2. A short message (an e-mail or note) about: ${a}. "situation" (1–2 simple sentences) and exactly 3 short "points" to write about.\n`
        + `Target length for task 2: ${wordTarget(30, diff)} words.`,
      schema: obj({ task1: obj({ situation: S, form: S, fields: arr(obj({ label: S, answer: S })) }), task2: obj({ situation: S, points: arr(S) }) }),
    };
  }
  if (level === "A2") {
    return {
      text: "Schreiben, Goethe A2. Write the two tasks in German, addressed to the candidate with \"Sie\":\n"
        + `1. An SMS to a friend about: ${a}. "situation" (1–2 simple sentences) and exactly 3 short "points" (for example: say why, suggest something, ask something).\n`
        + `2. An e-mail about: ${b}, either to a friend or, more often, formal to a teacher, landlord, office or boss. "situation" says who it goes to and why; exactly 3 short "points".\n`
        + `Target lengths: ${wordTarget(25, diff)} and ${wordTarget(35, diff)} words.`,
      schema: obj({ task1: obj({ situation: S, points: arr(S) }), task2: obj({ situation: S, points: arr(S) }) }),
    };
  }
  return {
    text: "Schreiben, Goethe B1. Write the three tasks of the module, in German, addressed to the candidate with \"Sie\":\n"
      + `1. An informal e-mail to a friend about: ${a}. "situation" (1–2 sentences setting the scene) and exactly 3 short "points" to cover (say what happened, how you feel, and ask or suggest something).\n`
      + `2. An opinion for an online guest book. A discussion was about "${pick("l4")}". "situation" introduces it in one sentence; "post" is a short comment (with "name") that the candidate answers with their own opinion.\n`
      + `3. A short formal e-mail to a teacher, landlord, employer or office about: ${b}. "situation" says who it goes to and what must be said (apologise or ask, and give a reason).\n`
      + `Target lengths: ${wordTarget(80, diff)}, ${wordTarget(80, diff)} and ${wordTarget(40, diff)} words.`,
    schema: obj({
      task1: obj({ situation: S, points: arr(S) }),
      task2: obj({ situation: S, name: S, post: S }),
      task3: obj({ situation: S }),
    }),
  };
};
const POINTS_CLOSING = "Schreiben Sie zu jedem Punkt ein bis zwei Sätze. Vergessen Sie nicht die Anrede und den Gruß.";
const points3 = (t) => list(t?.points).map(text).filter(Boolean).slice(0, 3);
export function buildWriting(r, diff, level = "B1") {
  let tasks;
  if (level === "A1") {
    const fields = list(r.task1?.fields).map((f) => ({ label: text(f?.label), answer: text(f?.answer) })).filter((f) => f.label && f.answer).slice(0, 5);
    tasks = [
      { title: "Teil 1", kind: text(r.task1?.form) || "Formular", situation: text(r.task1?.situation), fields, max: 5,
        closing: "Füllen Sie das Formular mit den Informationen aus dem Text aus. Schreiben Sie in jedes Feld nur das Nötige." },
      { title: "Teil 2", kind: "Kurze Mitteilung", situation: text(r.task2?.situation), points: points3(r.task2), target: wordTarget(30, diff), max: 10, closing: POINTS_CLOSING },
    ];
    if (fields.length < 5) return null;
  } else if (level === "A2") {
    tasks = [
      { title: "Teil 1", kind: "SMS", situation: text(r.task1?.situation), points: points3(r.task1), target: wordTarget(25, diff), max: 10, closing: "Schreiben Sie zu jedem Punkt ein bis zwei Sätze." },
      { title: "Teil 2", kind: "E-Mail", situation: text(r.task2?.situation), points: points3(r.task2), target: wordTarget(35, diff), max: 10, closing: POINTS_CLOSING },
    ];
  } else {
    tasks = [
      { title: "Aufgabe 1", kind: "Persönliche E-Mail", situation: text(r.task1?.situation), points: points3(r.task1), target: wordTarget(80, diff), max: 40,
        closing: "Schreiben Sie etwas zu allen drei Punkten. Achten Sie auf den Textaufbau (Anrede, Einleitung, Reihenfolge der Inhaltspunkte, Schluss)." },
      { title: "Aufgabe 2", kind: "Meinung im Gästebuch", situation: text(r.task2?.situation), quote: { name: text(r.task2?.name), text: text(r.task2?.post) }, target: wordTarget(80, diff), max: 40,
        closing: "Schreiben Sie nun Ihre Meinung zum Thema." },
      { title: "Aufgabe 3", kind: "Formelle E-Mail", situation: text(r.task3?.situation), target: wordTarget(40, diff), max: 20,
        closing: "Vergessen Sie nicht die Anrede und den Gruß am Schluss." },
    ];
    if (!tasks[1].quote.text) return null;
  }
  if (tasks.some((t) => !t.situation || (t.points && t.points.length < 3))) return null;
  return tasks;
}
// The A1 form: one point per field, judged by the AI so "15.3." and "15. März" both count.
export function gradeFormPrompt(task, values) {
  return {
    system: "You mark a form filled in by a candidate in a German A1 exam. For each field: right is true when the entry gives the information the text asks for "
      + "(different but correct wording, abbreviations and small spelling slips are fine; a wrong or missing fact is not). \"solution\" is the expected entry. "
      + "\"comment\" is one English sentence on what went wrong, or empty.",
    text: `TEXT\n${task.situation}\n\nFORM: ${task.kind}\n${task.fields.map((f, i) => `${i + 1}. ${f.label} — expected: ${f.answer} — candidate: ${(values[i] ?? "").trim() || "(empty)"}`).join("\n")}`,
    schema: obj({ marks: arr(obj({ right: B, solution: S })), comment: S }),
  };
}
export function formResult(raw, task) {
  const marks = task.fields.map((f, i) => ({ label: f.label, right: raw?.marks?.[i]?.right === true, solution: text(raw?.marks?.[i]?.solution) || f.answer }));
  return { form: marks, max: task.max, points: marks.filter((m) => m.right).length, comment: text(raw?.comment), corrections: [], criteria: {} };
}
const CRITERIA = ["erfuellung", "kohaerenz", "wortschatz", "strukturen"];
export const CRITERIA_LABELS = { erfuellung: "Erfüllung", kohaerenz: "Kohärenz", wortschatz: "Wortschatz", strukturen: "Strukturen", aussprache: "Aussprache" };
const GRADE = {
  erfuellung: I, kohaerenz: I, wortschatz: I, strukturen: I, comment: S,
  corrections: arr(obj({ wrong: S, right: S, why: S })),
};
export function gradeWritingPrompt(task, answer, diff, level = "B1") {
  const words = countWords(answer);
  return {
    system: `You are an examiner for a CEFR ${level} German writing practice exam. Grade against ${level}, not against a fixed B1 standard. `
      + "Grade one text by the exam's four criteria, each from 0 (nothing usable) to 5 (fully met): "
      + "erfuellung (every content point covered at the right length and in the right register, informal or formal), kohaerenz (structure, salutation and closing, connectors), "
      + "wortschatz (range and accuracy), strukturen (grammar, word order, spelling). "
      + `${DIFFICULTIES[diff].grading} A text far below the target length, off the task, or not in German scores 0–1 on erfuellung; an empty text scores 0 everywhere. `
      + "\"comment\" is 2–3 sentences in English on what cost the most points and what to do next time. \"corrections\" lists up to 6 real mistakes from the text "
      + "(wrong: the candidate's words, right: the correct German, why: a few English words); \"better\" is a model answer at full marks, in German, at the target length.",
    text: `TASK (${task.kind}, target ${task.target} words)\n${task.situation}\n${task.points ? task.points.map((p) => `- ${p}`).join("\n") : ""}${task.quote ? `\n${task.quote.name}: ${task.quote.text}` : ""}`
      + `\n\nCANDIDATE'S TEXT (${words} words)\n${answer.trim() || "(nothing written)"}`,
    schema: obj({ ...GRADE, better: S }),
  };
}
export const countWords = (s) => (s.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
const clamp5 = (v) => (Number.isFinite(v) ? Math.max(0, Math.min(5, Math.round(v))) : 0);
// {criteria: {name: 0–5}, points, max, comment, corrections, better}
export function gradeResult(raw, max, criteria = CRITERIA) {
  const marks = Object.fromEntries(criteria.map((c) => [c, clamp5(raw?.[c])]));
  const sum = Object.values(marks).reduce((a, b) => a + b, 0);
  return {
    criteria: marks, max, points: Math.round((sum / (criteria.length * 5)) * max),
    comment: text(raw?.comment), better: text(raw?.better),
    corrections: list(raw?.corrections).map((c) => ({ wrong: text(c?.wrong), right: text(c?.right), why: text(c?.why) })).filter((c) => c.wrong && c.right).slice(0, 6),
  };
}

// ---------- Sprechen ----------
export const SPEAK_POINTS = [28, 40, 16]; // + 16 for pronunciation, which a written transcript can't show
export const speakPrompt = (level = "B1") => {
  const [a, b] = pick("speak", 2);
  const steps = "the standard five steps (introduce the topic and structure; own experience; the situation in the home country; advantages, disadvantages and own opinion; conclusion and thanks)";
  return {
    text: `Sprechen at CEFR ${level}. Write the task sheets in German, with short and level-appropriate instructions and topics:\n`
      + "\"plan\": Teil 1, planning something together with a partner: \"situation\" (2–3 sentences, e.g. a farewell party for a course mate, a visit to someone in hospital, a weekend trip with the course) "
      + "and exactly 4 \"points\" to settle, as short questions (Wann? Wo? Was mitbringen? Wer macht was?).\n"
      + `"topics": Teil 2, two presentation topics to choose from, "${a}" and "${b}". Each has a "title" (a question or statement about the topic) and exactly 5 "slides": `
      + `${steps}, each phrased for that topic in one short sentence.`,
    schema: obj({ plan: obj({ situation: S, points: arr(S) }), topics: arr(obj({ title: S, slides: arr(S) })) }),
  };
};
export function buildSpeaking(r) {
  const plan = { situation: text(r.plan?.situation), points: list(r.plan?.points).map(text).filter(Boolean).slice(0, 4) };
  const topics = list(r.topics).slice(0, 2).map((t) => ({ title: text(t.title), slides: list(t.slides).map(text).filter(Boolean).slice(0, 5) }));
  if (!plan.situation || plan.points.length < 3 || topics.length < 2 || topics.some((t) => !t.title || t.slides.length < 4)) return null;
  return { plan, topics };
}
export const EXAMINER = { name: "Frau Brandt", gender: "f" };
export const PARTNER = { name: "Jonas", gender: "m" };
const TURN = obj({ reply: S });
const spoken = "Speak German only, in natural spoken sentences without lists, brackets or stage directions, at most 3 sentences per turn unless told otherwise. "
  + "Never correct the candidate's German and never switch to English: this is an exam, not a lesson.";
export function speakTurnPrompt(stage, sheet, diff, level = "B1", extra = {}) {
  const d = DIFFICULTIES[diff];
  const presentationWords = { A1: 45, A2: 80, B1: 130 }[level] ?? 130;
  const base = `This is the Sprechen module of a CEFR ${level} German practice exam. Speak at ${level}: ${LEVEL_GUIDE[level] ?? LEVEL_GUIDE.B1} ${LEVEL_CEILING[level] ?? LEVEL_CEILING.B1} Your strictness changes how you question, never how hard your German is. ${spoken} ${d.examiner}`;
  const prompts = {
    plan: () => `${base}\nYou are ${PARTNER.name}, the other candidate, a confident speaker. Teil 1: you and the candidate plan something together.\nSITUATION: ${sheet.plan.situation}\nPOINTS TO SETTLE: ${sheet.plan.points.join(" | ")}\n`
      + "Make suggestions of your own, react to the candidate's, ask what they think, and move to the next point once one is settled. Do not settle everything yourself: the candidate has to contribute. "
      + (extra.closing ? "This is your last turn: sum up in two sentences what the two of you agreed on, and say goodbye until the day." : extra.opening ? "Open the conversation: greet the candidate and make a first suggestion for the first point." : ""),
    peer: () => `${base}\nYou are ${PARTNER.name}, the other candidate. Teil 3: the candidate has just given a presentation on "${extra.topic}". `
      + "Give feedback in one or two sentences (what you liked, or what was new to you, naming something the candidate actually said), then ask ONE question about the presentation.",
    questions: () => `${base}\nYou are ${EXAMINER.name}, the examiner. Teil 3: the candidate has just given a presentation on "${extra.topic}". Ask ONE question about what they said `
      + `(question ${extra.n} of ${extra.of}): about a detail, a reason, or the opposite view. Refer to something the candidate actually said. `
      + "First react to their last answer in half a sentence. Do not repeat a question that was already asked.",
    presentation: () => `${base}\nYou are ${PARTNER.name}, the other candidate. Teil 2: give your own short presentation on "${extra.topic}", following these steps: ${extra.slides.join(" | ")}. `
      + `About ${presentationWords} words, as one connected talk in the first person, with level-appropriate sentences. End by thanking the listener.`,
    answer: () => `${base}\nYou are ${PARTNER.name}, the other candidate. You have just given a presentation on "${extra.topic}". The candidate now gives feedback and asks you a question. `
      + "Thank them and answer their question in 2–3 sentences. If they asked no question, say what you would have liked to be asked, briefly.",
  };
  return { system: prompts[stage](), schema: TURN };
}
export function gradeSpeakingPrompt(sheet, transcript, diff, level = "B1") {
  const show = (part) => transcript.filter((m) => m.part === part).map((m) => `${m.who}: ${m.text}`).join("\n") || "(the candidate said nothing)";
  const part = obj(GRADE);
  return {
    system: `You are the second examiner for a CEFR ${level} German speaking practice exam. Grade the CANDIDATE (lines marked \"Kandidat/in\") against ${level}, not a fixed B1 standard. `
      + "For each part give four marks from 0 (nothing usable) to 5 (fully met): erfuellung (the task done: suggestions, reactions and agreement in Teil 1; all five steps of the presentation in Teil 2; "
      + "real answers, feedback and a question in Teil 3), kohaerenz (connected speech, linking words, reacting to the partner), wortschatz (range and accuracy), strukturen (grammar, word order). "
      + `${DIFFICULTIES[diff].grading} The transcript comes from speech recognition: ignore spelling, capital letters and punctuation, and do not judge pronunciation. `
      + "A part in which the candidate said nothing or only a few words scores 0–1 everywhere. Per part: \"comment\" is 2 sentences in English, \"corrections\" up to 4 real mistakes "
      + "(wrong: the candidate's words, right: correct German, why: a few English words).",
    text: `TEIL 1 — plan together. ${sheet.plan.situation} Points: ${sheet.plan.points.join(" | ")}\n${show(0)}\n\n`
      + `TEIL 2 — presentation on "${sheet.topic?.title ?? ""}". Steps: ${(sheet.topic?.slides ?? []).join(" | ")}\n${show(1)}\n\n`
      + `TEIL 3 — the partner's and the examiner's questions on the presentation, then the candidate's feedback and question on the partner's presentation.\n${show(2)}`,
    schema: obj({ teil1: part, teil2: part, teil3: part }),
  };
}

// ---------- Sprechen A1 / A2 ----------
// The real Goethe A1 and A2 oral exams are not a presentation: they are short exchanges on
// cards. The module runs them as a script of steps: the examiner or Jonas says something
// (fixed or written by the AI), or the candidate speaks ("me"), and the next step waits for that.
const A1_INTRO = ["Name?", "Alter?", "Land?", "Wohnort?", "Sprachen?", "Beruf?", "Hobby?"];
export const speakPoints = (level = "B1") => ({ A1: [3, 6, 6], A2: [4, 8, 8] }[level] ?? SPEAK_POINTS);
export const speakPartTitles = (level = "B1") => ({
  A1: ["Teil 1 · Sich vorstellen", "Teil 2 · Um Informationen bitten und Informationen geben", "Teil 3 · Bitten formulieren und darauf reagieren"],
  A2: ["Teil 1 · Fragen zur Person", "Teil 2 · Über das eigene Leben erzählen", "Teil 3 · Gemeinsam etwas planen (einen Termin finden)"],
}[level] ?? ["Teil 1 · Gemeinsam etwas planen", "Teil 2 · Ein Thema präsentieren", "Teil 3 · Über ein Thema sprechen"]);

export const scriptedSpeakPrompt = (level) => {
  if (level === "A1") {
    const [t2, t3] = pick("a1speak", 2);
    return {
      text: "Sprechen, Goethe A1 (Start Deutsch 1). Write the cards in German:\n"
        + `"t2": Teil 2, topic "${t2}". "mine" and "partner" are each 3 different word cards on that topic (one noun each, like Frühstück, Getränke, Obst), for asking and answering questions.\n`
        + `"t3": Teil 3, about "${t3}". "mine" and "partner" are each 3 different picture cards described in 1–3 words (an object or action, like ein Glas Wasser, das Fenster öffnen), `
        + "for making a request (Können Sie …? Geben Sie mir bitte …).",
      schema: obj({ t2: obj({ theme: S, mine: arr(S), partner: arr(S) }), t3: obj({ theme: S, mine: arr(S), partner: arr(S) }) }),
    };
  }
  const talk = pick("a2talk");
  return {
    text: "Sprechen, Goethe A2. Write the cards in German:\n"
      + "\"t1\": Teil 1, questions about the person. \"mine\" and \"partner\" are each 4 different word cards (one word with a question mark, like Geburtstag?, Wohnung?, Lieblingsessen?, Arbeit?).\n"
      + `"t2": Teil 2, a card about "${talk}" in the candidate's life: "question" (one question, like Was machen Sie am Wochenende?) and exactly 4 short "prompts" to talk about.\n`
      + "\"t3\": Teil 3, finding a time together: \"situation\" (1–2 sentences: what the two want to do together on Saturday, for example visit a friend in hospital, buy a present, cook). "
      + "\"mine\" and \"partner\" are each a diary for that day: 6–8 entries like \"8:00–9:30 Frühstück mit Oma\"; leave exactly one common free slot of at least two hours.",
    schema: obj({ t1: obj({ mine: arr(S), partner: arr(S) }), t2: obj({ question: S, prompts: arr(S) }), t3: obj({ situation: S, mine: arr(S), partner: arr(S) }) }),
  };
};
const words = (v, n) => list(v).map(text).filter(Boolean).slice(0, n);
export function buildScriptedSpeaking(level) {
  return (r) => {
    if (level === "A1") {
      const s = { t2: { theme: text(r.t2?.theme), mine: words(r.t2?.mine, 3), partner: words(r.t2?.partner, 3) }, t3: { theme: text(r.t3?.theme), mine: words(r.t3?.mine, 3), partner: words(r.t3?.partner, 3) } };
      return s.t2.theme && [s.t2.mine, s.t2.partner, s.t3.mine, s.t3.partner].every((x) => x.length >= 2) ? s : null;
    }
    const s = { t1: { mine: words(r.t1?.mine, 4), partner: words(r.t1?.partner, 4) }, t2: { question: text(r.t2?.question), prompts: words(r.t2?.prompts, 4) },
      t3: { situation: text(r.t3?.situation), mine: words(r.t3?.mine, 10), partner: words(r.t3?.partner, 10) } };
    return s.t1.mine.length >= 3 && s.t1.partner.length >= 3 && s.t2.question && s.t2.prompts.length >= 3 && s.t3.situation && s.t3.mine.length >= 4 && s.t3.partner.length >= 4 ? s : null;
  };
}
// The cards the candidate sees in a part: {title, lines}.
export function scriptedCard(level, sheet, part) {
  if (level === "A1") {
    return [
      { title: "Stellen Sie sich vor.", lines: A1_INTRO },
      { title: `Thema: ${sheet.t2.theme}. Ihre Karten`, lines: sheet.t2.mine },
      { title: "Ihre Karten (Bitten)", lines: sheet.t3.mine },
    ][part];
  }
  return [
    { title: "Ihre Karten: Fragen Sie Jonas.", lines: sheet.t1.mine },
    { title: sheet.t2.question, lines: sheet.t2.prompts },
    { title: `${sheet.t3.situation} Ihr Kalender:`, lines: sheet.t3.mine },
  ][part];
}
// Steps: {part, say: "E"|"P", text} | {part, ai: "E"|"P", task} | {part, me: hint, long?}
export function speakScript(level, sheet, diff) {
  const d = DIFFICULTIES[diff];
  const steps = [];
  const E = (part, text) => steps.push({ part, say: "E", text });
  const ai = (part, who, task) => steps.push({ part, ai: who, task });
  const me = (part, hint, long = false) => steps.push({ part, me: hint, long });
  if (level === "A1") {
    const rounds = d.questions >= 3 ? 3 : 2;
    E(0, `Guten Tag. Mein Name ist ${EXAMINER.name}, das ist ${PARTNER.name}. Wir beginnen mit Teil 1. Bitte stellen Sie sich vor.`);
    me(0, "Stellen Sie sich mit den Stichwörtern vor.", true);
    E(0, "Danke. Buchstabieren Sie bitte Ihren Familiennamen.");
    me(0, "Buchstabieren Sie Ihren Namen.");
    E(0, "Und wie ist Ihre Telefonnummer?");
    me(0, "Sagen Sie eine Telefonnummer.");
    for (let i = 1; i < d.questions; i++) {
      ai(0, "E", "Ask the candidate ONE more short, simple personal question about something in their introduction (a number, a place, a person). Do not repeat a question.");
      me(0, "Antworten Sie.");
    }
    E(1, `Wir kommen zu Teil 2. Das Thema ist: ${sheet.t2.theme}. Fragen Sie ${PARTNER.name} mit dem Wort auf Ihrer Karte. Er antwortet. Dann fragt er Sie.`);
    for (let i = 0; i < Math.min(rounds, sheet.t2.mine.length, sheet.t2.partner.length); i++) {
      me(1, `Ihre Karte: „${sheet.t2.mine[i]}“. Stellen Sie ${PARTNER.name} eine Frage.`);
      ai(1, "P", `Topic "${sheet.t2.theme}". The candidate has just asked you a question with the word card "${sheet.t2.mine[i]}". Answer it in one or two short sentences. Do not ask anything back.`);
      ai(1, "P", `Now ask the candidate ONE short question with your word card "${sheet.t2.partner[i]}" on the topic "${sheet.t2.theme}". Say only the question, nothing about yourself.`);
      me(1, "Antworten Sie.");
    }
    E(2, `Danke. Teil 3. Auf Ihren Karten sehen Sie Dinge. Bitten Sie ${PARTNER.name} um etwas oder bitten Sie ihn, etwas zu tun. Er reagiert. Dann bittet er Sie um etwas.`);
    for (let i = 0; i < Math.min(rounds, sheet.t3.mine.length, sheet.t3.partner.length); i++) {
      me(2, `Ihre Karte: „${sheet.t3.mine[i]}“. Formulieren Sie eine Bitte.`);
      ai(2, "P", `The candidate has just made a request with the picture card "${sheet.t3.mine[i]}". React in one short sentence (yes, of course / sorry, I can't, and why).`);
      ai(2, "P", `Now make ONE short polite request to the candidate with your picture card "${sheet.t3.partner[i]}". Say only the request, nothing else.`);
      me(2, "Reagieren Sie auf die Bitte.");
    }
  } else {
    E(0, `Guten Tag. Mein Name ist ${EXAMINER.name}, das ist ${PARTNER.name}. Wir beginnen mit Teil 1. Sie haben Karten mit Wörtern. Fragen Sie ${PARTNER.name}, dann fragt er Sie.`);
    sheet.t1.mine.forEach((card, i) => {
      me(0, `Ihre Karte: „${card}“. Stellen Sie ${PARTNER.name} eine Frage.`);
      ai(0, "P", `The candidate has just asked you a personal question with the word card "${card}". Answer it in one or two short sentences about yourself. Do not ask anything back.`);
      if (sheet.t1.partner[i]) {
        ai(0, "P", `Now ask the candidate ONE short personal question with your word card "${sheet.t1.partner[i]}". Say only the question, nothing about yourself.`);
        me(0, "Antworten Sie.");
      }
    });
    E(1, `Danke. Teil 2. Erzählen Sie bitte etwas über sich: ${sheet.t2.question}`);
    me(1, "Erzählen Sie etwa eine Minute zu allen vier Punkten.", true);
    for (let i = 0; i < d.questions; i++) {
      ai(1, "E", `Teil 2: the candidate has just talked about "${sheet.t2.question}". Ask ONE short follow-up question about something they said (question ${i + 1} of ${d.questions}). Do not repeat a question.`);
      me(1, "Antworten Sie.");
    }
    E(2, `Danke. Teil 3. ${sheet.t3.situation} Finden Sie zusammen mit ${PARTNER.name} einen Termin. Schauen Sie in Ihren Kalender.`);
    const diary = `YOUR DIARY for that day (only you know it; tell the candidate what you can't do and why): ${sheet.t3.partner.join(" | ")}. THE SITUATION: ${sheet.t3.situation}`;
    ai(2, "P", `${diary}\nOpen the conversation: greet the candidate and suggest a first time that does NOT suit you both, or ask when they have time.`);
    for (let i = 0; i < d.planTurns; i++) {
      me(2, "Machen Sie Vorschläge und reagieren Sie.");
      ai(2, "P", i === d.planTurns - 1
        ? `${diary}\nThis is your last turn: agree on the free time if it was found (or propose the common free slot), and say goodbye in one or two sentences.`
        : `${diary}\nReact to the candidate's last suggestion using your diary: accept only a time that is free for you, otherwise say why not and suggest another. Move towards a time that suits both.`);
    }
  }
  E(2, "Vielen Dank. Die Prüfung ist damit beendet. Auf Wiedersehen.");
  return steps;
}
export function scriptTurnPrompt(task, diff, level) {
  const d = DIFFICULTIES[diff];
  const who = task.who === "E" ? `You are ${EXAMINER.name}, the examiner.` : `You are ${PARTNER.name}, the other candidate, a friendly speaker.`;
  return {
    system: `This is the Sprechen module of the Goethe-Zertifikat ${level}. Speak at ${level}: ${LEVEL_GUIDE[level]} ${LEVEL_CEILING[level]} `
      + `Your strictness changes how you question, never how hard your German is. ${spoken} ${d.examiner}\n${who} ${task.task} Keep it short, as in the real ${level} exam.`,
    schema: TURN,
  };
}
export function gradeScriptedSpeakingPrompt(level, sheet, transcript, diff) {
  const show = (part) => transcript.filter((m) => m.part === part).map((m) => `${m.who}: ${m.text}`).join("\n") || "(the candidate said nothing)";
  const tasks = level === "A1"
    ? ["introduce yourself with name, age, country, home town, languages, job and hobby; spell the name; say a number",
      `ask questions with word cards on "${sheet.t2.theme}" and answer the partner's questions`,
      "make polite requests with picture cards and react to the partner's requests"]
    : ["ask personal questions with word cards and answer the partner's questions",
      `talk about your own life: "${sheet.t2.question}" (${sheet.t2.prompts.join(", ")}), and answer the examiner's questions`,
      `agree on a time with the partner from your diary: ${sheet.t3.situation}`];
  const part = obj(GRADE);
  return {
    system: `You are the second examiner for the Goethe-Zertifikat ${level} speaking exam. Grade the CANDIDATE (lines marked "Kandidat/in") against the real ${level} standard. `
      + "For each Teil give four marks from 0 (nothing usable) to 5 (fully met): erfuellung (the Teil's task done), kohaerenz (reacting to the partner, linking the sentences), "
      + "wortschatz (range and accuracy for the level), strukturen (grammar, word order). "
      + `${DIFFICULTIES[diff].grading} The transcript comes from speech recognition: ignore spelling, capital letters and punctuation, and do not judge pronunciation. `
      + "A Teil in which the candidate said nothing or only a few words scores 0–1 everywhere. Per Teil: \"comment\" is 2 sentences in English, \"corrections\" up to 4 real mistakes "
      + "(wrong: the candidate's words, right: correct German, why: a few English words).",
    text: tasks.map((t, i) => `TEIL ${i + 1} — ${t}\n${show(i)}`).join("\n\n"),
    schema: obj({ teil1: part, teil2: part, teil3: part }),
  };
}

// ---------- marks ----------
// A Lesen/Hören module's result from the answers given: {points (of 100), right, total}.
export function scoreItems(parts, answers) {
  let right = 0;
  let total = 0;
  parts.forEach((p, pi) => p.sections.forEach((s, si) => s.items.forEach((item, ii) => {
    total++;
    if (answers[`${pi}.${si}.${ii}`] === item.answer) right++;
  })));
  return { right, total, points: total ? Math.round((right / total) * 100) : 0 };
}
export const grade = (points) => (points >= 90 ? "sehr gut" : points >= 80 ? "gut" : points >= 70 ? "befriedigend" : points >= 60 ? "ausreichend" : "nicht bestanden");
