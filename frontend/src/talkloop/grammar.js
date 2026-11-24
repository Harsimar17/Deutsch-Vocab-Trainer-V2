// Today's grammar: structures practised without the learner noticing. Each call picks a few
// (GRAMMAR_PER_CALL); the partner asks questions whose most natural answer needs them and uses
// them in its own sentences, but never names them. The coach reports each use (right or
// wrong), and at the end of the call each structure moves on a schedule like today's words:
// used well, it comes back later and later until it is automatic; used wrongly, or avoided,
// it comes back in the next call. German only.
//
// This file only holds the list and the rules; the engine keeps the state and storage.

export const GRAMMAR_PER_CALL = 3;
const DAYS = [1, 3, 7, 21]; // due again this many days after reaching stage 1..4
const AUTOMATIC_RECHECK_DAYS = 60;
const DAY_MS = 86_400_000;

// In teaching order within each level. `rule` is what the coach checks, `elicit` how the
// partner draws it out, `cue` (on the learner's message, lowercased, without punctuation) a
// sanity check on the coach: a structure can't be "used" in a message without its words.
// `mistakes` are the mistake log's types that make it more urgent.
export const GRAMMAR = [
  {
    key: "inversion", level: "A1", name: "Verb second (Am Abend koche ich)",
    rule: "the verb stays in position 2 when the sentence starts with a time or place (\"Am Wochenende gehe ich…\", not \"Am Wochenende ich gehe…\")",
    elicit: "ask when and how often they do things (Wann…? Was machst du am Abend / am Wochenende / nach der Arbeit?)",
    mistakes: ["verb_position"],
  },
  {
    key: "modal", level: "A1", name: "Modal verbs (ich muss … arbeiten)",
    rule: "a modal verb (können, müssen, wollen, dürfen, sollen, möchten) in position 2 with the infinitive at the end",
    elicit: "ask what they can, have to, want to or would like to do",
    cue: /\b(kann|kannst|können|könnt|muss|musst|müssen|müsst|will|willst|wollen|wollt|darf|darfst|dürfen|soll|sollst|sollen|möchte|möchtest|möchten)\b/,
    mistakes: ["verb_ending"],
  },
  {
    key: "separable", level: "A1", name: "Separable verbs (ich stehe früh auf)",
    rule: "a separable verb's prefix goes to the end (\"ich rufe dich an\", \"ich kaufe ein\"); in the Perfekt as one word with ge in the middle (angerufen, eingekauft)",
    elicit: "ask about their daily routine, getting up, shopping, calling people, going out",
    mistakes: ["separable_verb"],
  },
  {
    key: "perfekt", level: "A2", name: "Perfekt (ich habe … gemacht, ich bin … gefahren)",
    rule: "haben or sein (sein for movement and change) in position 2 and the past participle at the end, formed right",
    elicit: "ask what they did yesterday, last week, on their last holiday, what happened",
    cue: /\b(habe|hab|hast|hat|haben|habt|bin|bist|ist|sind|seid)\b.*\b(ge\w+(t|en)|\w+iert|(be|er|ver|ent|zer|über|emp|miss)\w+(t|en))\b/,
    mistakes: ["perfekt_auxiliary", "participle"],
  },
  {
    key: "weil", level: "A2", name: "weil (verb at the end)",
    rule: "a weil clause with its verb at the very end (\"…, weil ich keine Zeit habe\")",
    elicit: "ask Warum…? about their choices, likes and plans",
    cue: /\bweil\b/,
    mistakes: ["verb_position"],
  },
  {
    key: "dass", level: "A2", name: "dass (Ich finde, dass …)",
    rule: "a dass clause with its verb at the end (\"Ich glaube, dass es morgen regnet\")",
    elicit: "ask what they think, believe, hope or find important (Was glaubst du…? Was findest du gut daran?)",
    cue: /\b(dass|das)\b/,
    mistakes: ["verb_position"],
  },
  {
    key: "wenn", level: "A2", name: "wenn (Wenn ich Zeit habe, …)",
    rule: "a wenn clause with its verb at the end; when it comes first, the main clause starts with its verb (\"Wenn ich müde bin, trinke ich Kaffee\")",
    elicit: "ask what they do in certain situations (Was machst du, wenn du gestresst bist / wenn es regnet?)",
    cue: /\bwenn\b/,
    mistakes: ["verb_position"],
  },
  {
    key: "dative", level: "A2", name: "Dative after mit, bei, nach, zu, von, aus",
    rule: "the dative after mit, bei, nach, zu, von, aus, seit (mit dem Bus, bei meiner Mutter, zum Arzt, seit einem Jahr)",
    elicit: "ask how they get somewhere, who they live, work or travel with, where they were",
    cue: /\b(mit|bei|beim|nach|zu|zum|zur|von|vom|aus|seit)\b/,
    mistakes: ["case_article", "preposition"],
  },
  {
    key: "compare", level: "A2", name: "Comparing (besser als, am liebsten)",
    rule: "comparative + als and the superlative with am …sten (größer als, lieber, am besten, am liebsten)",
    elicit: "ask them to compare two things or choose their favourite (Was ist besser…? Was magst du am liebsten?)",
    cue: /\b(\w+er als|am \w+sten|lieber|besser|mehr|weniger|am liebsten|am besten)\b/,
    mistakes: ["adjective_ending"],
  },
  {
    key: "obwohl", level: "B1", name: "obwohl (verb at the end)",
    rule: "an obwohl clause with its verb at the end (\"…, obwohl ich müde war\")",
    elicit: "ask about things they do despite a reason against them (Machst du das trotz…? Warum hast du das trotzdem gemacht?)",
    cue: /\bobwohl\b/,
    mistakes: ["verb_position"],
  },
  {
    key: "deshalb", level: "B1", name: "deshalb / trotzdem (verb straight after)",
    rule: "deshalb, deswegen, trotzdem, darum: the verb comes straight after it (\"…, deshalb bleibe ich zu Hause\")",
    elicit: "ask about consequences and reactions (Und was hast du dann gemacht? Was war die Folge?)",
    cue: /\b(deshalb|deswegen|darum|trotzdem|daher)\b/,
    mistakes: ["verb_position"],
  },
  {
    key: "konjunktiv", level: "B1", name: "Konjunktiv II (ich würde, hätte, wäre)",
    rule: "würde + infinitive at the end, or hätte, wäre, könnte, sollte, for wishes, dreams, polite requests and advice",
    elicit: "ask what they would do if…, what they would change, wish for, or advise a friend",
    cue: /\b(würde|würdest|würden|würdet|hätte|hättest|hätten|wäre|wärst|wären|könnte|könntest|könnten|sollte|solltest|sollten|müsste|dürfte)\b/,
    mistakes: ["verb_ending", "tense"],
  },
  {
    key: "relative", level: "B1", name: "Relative clauses (der Mann, der …)",
    rule: "a relative clause with the right pronoun (der, die, das, den, dem, denen) and its verb at the end (\"ein Freund, den ich seit der Schule kenne\")",
    elicit: "ask them to describe a person, place or thing that matters to them (Was für ein Mensch ist…? Beschreib mal…)",
    cue: /\b(der|die|das|den|dem|denen|deren|dessen|wo)\b.*\b(der|die|das|den|dem|denen|deren|dessen|wo)\b/,
    mistakes: ["case_article", "verb_position"],
  },
  {
    key: "umzu", level: "B1", name: "um … zu / damit",
    rule: "um … zu + infinitive at the end, or a damit clause with its verb at the end, for a purpose",
    elicit: "ask what they do something for (Wofür…? Wozu brauchst du…? Warum lernst du…?)",
    cue: /\b(um\b.*\bzu|damit)\b/,
    mistakes: ["verb_position"],
  },
  {
    key: "praeteritum", level: "B1", name: "Präteritum (war, hatte, konnte, musste)",
    rule: "war, hatte and the modal verbs in the Präteritum (konnte, musste, wollte, durfte) for the past",
    elicit: "ask what things were like before, in their childhood or at their first job (Wie war das früher?)",
    cue: /\b(war|warst|waren|wart|hatte|hattest|hatten|konnte|konntest|konnten|musste|musstest|mussten|wollte|wolltest|wollten|durfte|durften)\b/,
    mistakes: ["tense", "verb_ending"],
  },
  {
    key: "als", level: "B1", name: "als in the past (Als ich klein war, …)",
    rule: "als for one time or period in the past (not wenn), verb at the end of the als clause, then the main clause's verb first",
    elicit: "ask about one moment or period of their past (Wie war das, als du…? Was hast du gemacht, als…?)",
    cue: /\bals\b/,
    mistakes: ["verb_position", "word_choice"],
  },
  {
    key: "indirect", level: "B1", name: "Indirect questions (Ich weiß nicht, ob …)",
    rule: "an indirect question with ob or a question word and its verb at the end (\"Ich weiß nicht, ob ich Zeit habe\", \"…, wann der Zug fährt\")",
    elicit: "ask about plans or things they aren't sure of yet (Weißt du schon, ob…? Hast du entschieden, wann…?)",
    cue: /\b(ob|wann|wo|wie|was|warum|wohin|welche\w*)\b/,
    mistakes: ["verb_position"],
  },
];

const BY_KEY = Object.fromEntries(GRAMMAR.map((g) => [g.key, g]));
const LEVELS = ["A1", "A2", "B1"];
export const grammarPoint = (key) => BY_KEY[key];

// The structures for a learner at `level` (theirs and below; B1+ and above get everything).
function forLevel(level) {
  const i = LEVELS.indexOf(level);
  const upTo = i === -1 ? LEVELS.length - 1 : i;
  return GRAMMAR.filter((g) => LEVELS.indexOf(g.level) <= upTo);
}

// Which structures this call works on. `plan` is the schedule ({key: {stage, due, uses,
// lastDay, updatedAt}}), `weakTypes` the mistake log's recurring types, most frequent first.
// Order: due ones (least secure first), then new ones (those the learner's mistakes point to
// first, then their own level before the levels below), then the soonest due.
export function pickGrammar(level, plan, weakTypes = [], now = Date.now()) {
  const pool = forLevel(level);
  const lvl = (g) => LEVELS.indexOf(g.level);
  const top = LEVELS.indexOf(level) === -1 ? LEVELS.length - 1 : LEVELS.indexOf(level);
  const urgency = (g) => {
    const i = Math.min(...(g.mistakes ?? []).map((t) => weakTypes.indexOf(t)).filter((x) => x >= 0));
    return Number.isFinite(i) ? i : 99;
  };
  const due = pool.filter((g) => plan[g.key] && plan[g.key].due <= now)
    .sort((a, b) => plan[a.key].stage - plan[b.key].stage || plan[a.key].due - plan[b.key].due);
  const fresh = pool.filter((g) => !plan[g.key])
    .sort((a, b) => urgency(a) - urgency(b) || (lvl(a) === top ? 0 : 1) - (lvl(b) === top ? 0 : 1) || GRAMMAR.indexOf(a) - GRAMMAR.indexOf(b));
  const later = pool.filter((g) => plan[g.key] && plan[g.key].due > now).sort((a, b) => plan[a.key].due - plan[b.key].due);
  return [...due, ...fresh, ...later].slice(0, GRAMMAR_PER_CALL).map((g) => g.key);
}

// The coach's report on one learner message, kept only for today's structures and only where
// the message has the structure's words.
export function recordGrammarUses(status, keys, uses, message, normalize) {
  if (!Array.isArray(uses)) return false;
  const text = normalize(message ?? "");
  let changed = false;
  const seen = new Set();
  for (const u of uses) {
    const g = BY_KEY[u?.key];
    if (!g || !keys.includes(g.key) || seen.has(g.key)) continue; // one count per message
    if (g.cue && !g.cue.test(text)) continue;
    seen.add(g.key);
    const s = (status[g.key] ??= { correct: 0, wrong: 0 });
    if (u.correct === true) s.correct++;
    else s.wrong++;
    changed = true;
  }
  return changed;
}

// The schedule after a call. Used well (twice and more right than wrong, or once and never
// wrong at the start): up a stage, once a day. Wrong more than right: back to stage 1, due
// tomorrow. Mixed or a single use: stays, due tomorrow. Not used at all: due now, so the next
// call brings it back. Returns {key: entry} for the structures that changed.
export function settleGrammar(keys, status, plan, day, now = Date.now()) {
  const out = {};
  for (const key of keys) {
    const prev = plan[key];
    const { correct = 0, wrong = 0 } = status[key] ?? {};
    const stage = prev?.stage ?? 0;
    const uses = (prev?.uses ?? 0) + correct;
    let entry;
    if (!correct && !wrong) {
      entry = { stage, due: now, uses, lastDay: prev?.lastDay ?? "" };
    } else if (wrong > correct) {
      entry = { stage: Math.min(stage, 1), due: now + DAY_MS, uses, lastDay: prev?.lastDay ?? "" };
    } else if ((correct >= 2 && correct > wrong) || (correct >= 1 && !wrong && stage === 0)) {
      if (prev?.lastDay === day) {
        entry = { ...prev, uses };
      } else {
        const next = Math.min(4, stage + 1);
        const days = stage === 4 ? AUTOMATIC_RECHECK_DAYS : DAYS[next - 1];
        entry = { stage: next, due: now + days * DAY_MS, uses, lastDay: day };
      }
    } else {
      entry = { stage, due: now + DAY_MS, uses, lastDay: prev?.lastDay ?? "" };
    }
    out[key] = { ...entry, updatedAt: now };
  }
  return out;
}

// For the partner: what to draw out, and how far each one has got in this call.
export function grammarPromptLines(keys, status, { live = false } = {}) {
  if (!keys?.length) return [];
  const list = keys.map((k) => BY_KEY[k]).filter(Boolean);
  const lines = [
    `Today's grammar, practised without the learner noticing:\n${list.map((g) => `- ${g.name}: ${g.rule}. To draw it out, ${g.elicit}.`).join("\n")}`,
    "Steer the conversation so the learner keeps needing these: about every second question, ask something on the current subject whose most natural answer uses one of them, taking them in turn, and use them often in your own sentences so the learner hears them. Never name, explain or announce the grammar, never ask the learner to use a structure, and never change the subject for it: the conversation comes first.",
  ];
  if (!live) {
    const used = list.filter((g) => (status[g.key]?.correct ?? 0) >= 2);
    const wrong = list.filter((g) => (status[g.key]?.wrong ?? 0) > (status[g.key]?.correct ?? 0));
    const notYet = list.filter((g) => !status[g.key]);
    if (notYet.length) lines.push(`Not used by the learner yet, so draw these out first: ${notYet.map((g) => g.name).join("; ")}.`);
    if (wrong.length) lines.push(`Used wrongly so far, so give them another natural chance soon: ${wrong.map((g) => g.name).join("; ")}.`);
    if (used.length) lines.push(`Already used well: ${used.map((g) => g.name).join("; ")}; keep it natural and favour the others.`);
  }
  return lines;
}

// A short update for a live call, whose instructions were sent when it connected.
export function grammarLiveNote(keys, status) {
  const list = keys.map((k) => BY_KEY[k]).filter(Boolean);
  const good = list.filter((g) => (status[g.key]?.correct ?? 0) >= 2 && (status[g.key]?.wrong ?? 0) <= (status[g.key]?.correct ?? 0));
  const rest = list.filter((g) => !good.includes(g));
  if (!good.length || !rest.length) return null;
  return `(Coach, not the learner: an update on today's grammar, nothing to say about it now. Going well: ${good.map((g) => g.name).join("; ")}. From now on, draw out these more: ${rest.map((g) => g.name).join("; ")}, still without naming them.)`;
}

// For the coach: which structures to report on, and the rule each is judged by.
export function grammarCoachLine(keys, field) {
  const list = keys.map((k) => BY_KEY[k]).filter(Boolean);
  if (!list.length) return "";
  return `${field}: for each of today's grammar structures that the learner's last message uses, one {key, correct} (key exactly as given), with correct true only if it is formed right; empty if it uses none. A wrong one also gets a correction. Structures (key: what is right): ${list.map((g) => `${g.key}: ${g.rule}`).join("; ")}.`;
}

export const GRAMMAR_USES_SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: { key: { type: "STRING" }, correct: { type: "BOOLEAN" } },
    required: ["key", "correct"],
  },
};
