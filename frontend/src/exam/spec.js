// The Prüfung tab's exam: a four-module Goethe-style practice paper,
// how much harder than the real one it is, and what the AI is asked to write for each Teil.
// Nothing here is a real exam text: every paper is written afresh by the learner's AI.

// ---------- how hard ----------
// The real exam is "real"; the others multiply it: harder language, less time, faster audio
// heard once, a higher pass mark, longer texts to write, a tougher examiner.
export const DIFFICULTIES = {
  real: {
    label: "Original", factor: "×1", blurb: "Volle Zeit, 60 % zum Bestehen.",
    time: 1, pass: 60, rate: 1, twice: true, words: 1, prep: 15, planTurns: 5, questions: 1,
    language: "Keep language and tasks at the selected CEFR level, with no extra difficulty.",
    examiner: "You are friendly and patient, as in the real exam.",
    grading: "Grade fairly against the selected CEFR level.",
  },
  hard: {
    label: "Schwer", factor: "×1,5", blurb: "Etwas anspruchsvoller, 20 % weniger Zeit, Audio nur einmal, 70 % zum Bestehen.",
    time: 0.8, pass: 70, rate: 1.1, twice: false, words: 1.25, prep: 10, planTurns: 6, questions: 2,
    language: "Make the tasks noticeably harder while staying within the selected CEFR level: use less obvious clues and plausible distractors, and texts about 20% longer, "
      + "the correct answer always paraphrased (never in the text's own words), and every wrong option made plausible by something the text really mentions.",
    examiner: "You are correct but demanding: you ask follow-up questions (warum, zum Beispiel, und wenn …?), do not accept one-word answers, "
      + "and in the planning task you disagree with some suggestions and raise a practical problem.",
    grading: "Grade strictly for the selected CEFR level; borderline work should not pass.",
  },
  extreme: {
    label: "Extrem", factor: "×2", blurb: "Maximal anspruchsvoll, 35 % weniger Zeit, Audio nur einmal, 80 % zum Bestehen.",
    time: 0.65, pass: 80, rate: 1.2, twice: false, words: 1.5, prep: 5, planTurns: 7, questions: 3,
    language: "Make the tasks much harder while keeping vocabulary and grammar within the selected CEFR level: use subtle clues and plausible distractors, texts about 35% longer, "
      + "information that is only implied and has to be inferred, and wrong options that differ from the truth in a single detail (a negation, a time, a condition, who did it).",
    examiner: "You are a strict examiner under time pressure: you interrupt long pauses with a new question, challenge every opinion with a counter-argument, "
      + "ask for precise reasons and examples, and in the planning task you reject the first suggestion and change one condition halfway through.",
    grading: "Grade strictly against the selected CEFR level; reward accurate, appropriate language and task completion.",
  },
};

export const MODULES = [
  { id: "lesen", label: "Lesen", minutes: 65, teile: 5, about: "5 Teile · 30 Aufgaben" },
  { id: "hoeren", label: "Hören", minutes: 40, teile: 4, about: "4 Teile · 30 Aufgaben" },
  { id: "schreiben", label: "Schreiben", minutes: 60, teile: 3, about: "3 Aufgaben · KI-Bewertung" },
  { id: "sprechen", label: "Sprechen", minutes: 15, teile: 3, about: "3 Teile · KI-Prüferin" },
];
export const moduleMinutes = (id, diff) => Math.max(5, Math.round(MODULES.find((m) => m.id === id).minutes * DIFFICULTIES[diff].time));
export const WRITE_WORDS = [80, 80, 40];
const LEVEL_WORD_FACTOR = { A1: 0.5, A2: 0.75, B1: 1 };
export const writeTarget = (i, diff, level = "B1") => Math.max(20, Math.round((WRITE_WORDS[i] * DIFFICULTIES[diff].words * (LEVEL_WORD_FACTOR[level] ?? 1)) / 5) * 5);
export const WRITE_POINTS = [40, 40, 20];

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
export const examBlurb = (diff, level) => `${level}: ${DIFFICULTIES[diff].blurb}`;

export function systemPrompt(diff, level = "B1") {
  return `You write original German CEFR ${level} practice papers for adult learners, using the four-module Goethe-style practice format. Never reproduce a real exam text: invent everything. `
    + "Everything the candidate reads or hears is in German, with correct spelling and ß/umlauts. "
    + `Target level: ${level}. ${LEVEL_GUIDE[level] ?? LEVEL_GUIDE.B1} Keep the grammar, vocabulary, task wording, answer options, audio and model responses suitable for ${level}. `
    + `For A1 or A2, simplify the topics and shorten all reading/listening texts in the task request to a practical ${level} length; the selected level takes priority over any example word counts in the task template. `
    + `${DIFFICULTIES[diff].language} `
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
export const TEILE = {
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
        return `Lesen Teil 2. Write two short press reports (each 180–220 words at real-exam length), one about "${a}", one about "${b}". `
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

// A Teil is usable when it has its items, each with a prompt and a valid answer, and its material.
export function validTeil(spec, sections) {
  const items = sections.flatMap((s) => s.items);
  if (items.length < spec.count) return false;
  if (items.some((i) => !i.prompt || i.answer < 0 || i.options.length < 2)) return false;
  return sections.every((s) => s.text || s.texts?.length || s.audio?.lines.length || s.items.every((i) => i.context));
}

// ---------- Schreiben ----------
export const writePrompt = (diff, level = "B1") => {
  const [a, b] = pick("write", 2);
  const simpler = level === "A1" || level === "A2";
  return {
    text: "Schreiben. Write the three tasks of the module, in German, addressed to the candidate with \"Sie\":\n"
      + `1. ${simpler ? "A short message to a friend" : "An informal e-mail to a friend"} about: ${a}. "situation" (1–2 simple sentences setting the scene) and exactly 3 short "points" to cover (say what happened, how you feel, and ask or suggest something).\n`
      + `2. ${simpler ? "A simple opinion message" : "An opinion for an online guest book"}. A discussion was about "${pick("l4")}". "situation" introduces it in one sentence; "post" is a short comment (with "name") that the candidate answers with their own opinion.\n`
      + `3. ${simpler ? "A short polite note" : "A short formal e-mail"} to a teacher, landlord, employer or office about: ${b}. "situation" says who it goes to and what must be said (apologise or ask, and give a simple reason).\n`
      + `Target lengths for CEFR ${level}: ${writeTarget(0, diff, level)}, ${writeTarget(1, diff, level)} and ${writeTarget(2, diff, level)} words. Use short, level-appropriate prompts and points.`,
    schema: obj({
      task1: obj({ situation: S, points: arr(S) }),
      task2: obj({ situation: S, name: S, post: S }),
      task3: obj({ situation: S }),
    }),
  };
};
export function buildWriting(r, diff, level = "B1") {
  const simpler = level === "A1" || level === "A2";
  const tasks = [
    { title: "Aufgabe 1", kind: simpler ? "Nachricht an einen Freund" : "Persönliche E-Mail", situation: text(r.task1?.situation), points: list(r.task1?.points).map(text).filter(Boolean).slice(0, 3),
      closing: "Schreiben Sie etwas zu allen drei Punkten. Achten Sie auf den Textaufbau (Anrede, Einleitung, Reihenfolge der Inhaltspunkte, Schluss)." },
    { title: "Aufgabe 2", kind: simpler ? "Einfache Meinung" : "Meinung im Gästebuch", situation: text(r.task2?.situation), quote: { name: text(r.task2?.name), text: text(r.task2?.post) },
      closing: "Schreiben Sie nun Ihre Meinung zum Thema." },
    { title: "Aufgabe 3", kind: simpler ? "Kurze höfliche Nachricht" : "Formelle E-Mail", situation: text(r.task3?.situation),
      closing: "Vergessen Sie nicht die Anrede und den Gruß am Schluss." },
  ].map((t, i) => ({ ...t, target: writeTarget(i, diff, level), max: WRITE_POINTS[i] }));
  if (tasks.some((t) => !t.situation) || tasks[0].points.length < 3 || !tasks[1].quote.text) return null;
  return tasks;
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
  const steps = level === "A1"
    ? "five very simple steps: say the topic; say one thing you do; say what you like; give one short reason; say thank you"
    : level === "A2"
      ? "five simple steps: introduce the topic; describe your experience; say how people do it at home; give one advantage and your opinion; conclude and thank the listener"
      : "the standard five steps (introduce the topic and structure; own experience; the situation in the home country; advantages, disadvantages and own opinion; conclusion and thanks)";
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
  const base = `This is the Sprechen module of a CEFR ${level} German practice exam. Speak at ${level}: ${LEVEL_GUIDE[level] ?? LEVEL_GUIDE.B1} ${spoken} ${d.examiner}`;
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
