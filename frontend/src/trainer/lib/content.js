import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { API_BASE, api } from "./api.js";

// ---------- CONTENT (read straight from the JSON files — no API) ----------
// The vocabulary, stories and patterns come from static JSON: german_vocab.json
// from GitHub Pages (the bundled copy if that can't be reached) and
// patterns.json next to this page. Everything that only shows content — the
// story list and reader, Cards, Quiz, Articles, Separable verbs, Fill-in,
// Patterns — is built here from them. The backend is called only to check and
// save an answer, and for the learner's own saved data.
export const VOCAB_URL = "https://harsimar17.github.io/Deutsch-Vocab-Helper/german_vocab.json";
export const VOCAB_BUNDLED = API_BASE + "/data/german_vocab.json";
export const PATTERNS_URL = API_BASE + "/data/patterns.json";

export const getJson = (url, fresh) => fetch(url, fresh ? { cache: "no-cache" } : undefined).then((r) => {
  if (!r.ok) throw new Error(url + " → HTTP " + r.status);
  return r.json();
});

export let contentLoad = null;
// The files are read once per page load; loadContent(true) reads them again (after "+ Add word").
export function loadContent(fresh) {
  if (!contentLoad || fresh) {
    contentLoad = Promise.all([
      getJson(VOCAB_URL, fresh).catch(() => getJson(VOCAB_BUNDLED)),
      getJson(PATTERNS_URL),
    ]).then(([vocab, patterns]) => buildContent(vocab, patterns));
    contentLoad.catch(() => { contentLoad = null; });
  }
  return contentLoad;
}

export function useContent(reload) {
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let live = true;
    loadContent().then((c) => { if (live) setContent(c); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [reload]);
  return [content, error];
}

export const str = (o) => (o == null ? "" : String(o));
export const strOrNull = (o) => (o == null || String(o) === "" ? null : String(o));
export const asList = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
export const storyId = (o) => (o == null ? null : typeof o === "number" ? String(Math.trunc(o)) : String(o));
export const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const pick1 = (list) => list[Math.floor(Math.random() * list.length)];

// --- cards (as CardCatalog builds them: key = "lvl|cat|de", first one wins) ---
export const LEVELS = ["A1", "A2", "B1"];
export const NOUN_CATS = ["der", "die", "das"];
export const PLAIN_CATS = [["adjectives", "adj"], ["verbs", "verb"], ["separable_verbs", "sep"], ["function_words", "func"], ["phrases", "phrase"]];
export const isNoun = (c) => NOUN_CATS.includes(c.cat);

export function buildCards(vocab) {
  const byKey = new Map();
  const add = (lvl, cat, e) => {
    const de = str(e.de);
    const key = lvl + "|" + cat + "|" + de;
    if (!byKey.has(key)) byKey.set(key, { key, de, en: str(e.en), cat, lvl, example: strOrNull(e.example), prefix: strOrNull(e.prefix) });
  };
  const levels = (vocab && vocab.levels) || {};
  for (const lvl of LEVELS) {
    const level = levels[lvl];
    if (!level || typeof level !== "object") continue;
    const nouns = level.nouns || {};
    for (const art of NOUN_CATS) for (const e of asList(nouns[art])) add(lvl, art, e);
    for (const [field, cat] of PLAIN_CATS) for (const e of asList(level[field])) add(lvl, cat, e);
  }
  return byKey;
}

// --- German text helpers (as German.java) ---
export const SEP_PREFIXES = ["auf", "an", "aus", "ein", "mit", "nach", "vor", "zu", "ab", "um", "zurück", "weg", "hin", "her", "fest", "los", "teil", "statt", "durch", "heraus", "zusammen", "vorbei", "fern", "bei", "mit"];
export const SEP_COMMON = ["auf", "an", "aus", "ein", "mit", "nach", "vor", "zu", "ab", "um"];
export const PLURAL_NOTE = /\s*\((?:Pl\.|WG)\)/g;
export const stripArticle = (de) => str(de).replace(/^(der|die|das)\s+/, "");
export function nounForms(card) {
  return str(card.de).replace(PLURAL_NOTE, "").trim().split(" / ")
    .map((s) => s.replace(/^(der|die|das)\s+/i, "").trim()).filter(Boolean);
}
// A noun's example sentence split around the noun (Fill-in).
export function clozeMatch(card) {
  const sentence = str(card.example);
  if (!sentence) return null;
  for (const f of nounForms(card)) {
    const m = new RegExp(reEscape(f), "iu").exec(sentence);
    if (m) return { before: sentence.slice(0, m.index), answer: m[0], after: sentence.slice(m.index + m[0].length) };
  }
  return null;
}
// Infinitive and separable prefix of a separable verb.
export function sepParts(card) {
  const de = str(card.de).trim().replace(/^sich\s+/i, "").replace(/\s+(mit|auf|an|über|für|zu|nach|von|in|bei|um)$/i, "").trim();
  const inf = de.split(" ")[0] || de;
  let prefix = card.prefix;
  if (!prefix) prefix = SEP_PREFIXES.find((p) => inf.toLowerCase().startsWith(p)) || "";
  return { inf, prefix: prefix.toLowerCase() };
}
// The example sentence with the (last) free-standing prefix blanked out.
export function sepCloze(card, prefix) {
  const ex = str(card.example).trim();
  if (!ex || !prefix) return null;
  const re = new RegExp("(^|[\\s(])(" + reEscape(prefix) + ")(?=[\\s.,!?;:)]|$)", "giu");
  let at = -1, m;
  while ((m = re.exec(ex)) !== null) at = m.index + m[1].length;
  if (at < 0) return null;
  return { before: ex.slice(0, at), answer: ex.slice(at, at + prefix.length), after: ex.slice(at + prefix.length) };
}

// --- word meanings in running text (as WordLookup.java) ---
export const IRREGULAR = new Map();
export const FIXED = new Map();
export const STRIP_SUFFIXES = ["test", "tet", "ten", "est", "ern", "en", "em", "er", "es", "et", "st", "te", "e", "n", "s", "t"];
export const GLOSS_TYPE_CAT = { verbs: "verb", adjectives: "adj", separable_verbs: "sep", function_words: "func", phrases: "phrase" };
[["sein", "bin bist ist sind seid war warst waren gewesen wäre wären"], ["haben", "hat hast habe hatte hatten gehabt hätte hätten"],
  ["werden", "wird wirst wurde wurden geworden würde würden"], ["können", "kann kannst konnte konnten könnte könnten"],
  ["müssen", "muss musst musste mussten müsste"], ["wollen", "will willst wollte wollten"], ["dürfen", "darf darfst durfte durften dürfte"],
  ["sollen", "soll sollst sollte sollten"], ["mögen", "mag magst mochte"], ["wissen", "weiß weißt wusste gewusst"],
  ["geben", "gibt gab gaben gegeben"], ["sehen", "sieht sah sahen gesehen"], ["lesen", "liest las gelesen"],
  ["fahren", "fährt fuhr fuhren gefahren"], ["nehmen", "nimmt nahm nahmen genommen"], ["sprechen", "spricht sprach sprachen gesprochen"],
  ["helfen", "hilft half geholfen"], ["gehen", "ging gingen gegangen"], ["kommen", "kam kamen gekommen"], ["essen", "isst aß gegessen"],
  ["treffen", "trifft traf trafen getroffen"], ["schlafen", "schläft schlief"], ["laufen", "läuft lief"], ["tragen", "trägt trug"],
  ["halten", "hält hielt"], ["finden", "fand fanden gefunden"], ["bleiben", "blieb blieben geblieben"], ["schreiben", "schrieb geschrieben"],
  ["stehen", "stand standen gestanden"], ["sitzen", "saß gesessen"], ["liegen", "lag gelegen"], ["denken", "dachte gedacht"],
  ["bringen", "brachte gebracht"], ["kennen", "kannte gekannt"], ["tun", "tat tut getan"], ["rufen", "rief gerufen"],
  ["verstehen", "verstand verstanden"], ["gelten", "gilt galt gegolten"], ["wachsen", "wächst wuchs gewachsen"], ["bekommen", "bekam bekamen bekommt"],
].forEach(([inf, forms]) => forms.split(" ").forEach((f) => IRREGULAR.set(f, inf)));
// closed-class words the stemmer would get wrong ("meine" is not "meinen")
[["mein meine meinen meinem meiner meines", "mein", "my"], ["dein deine deinen deinem deiner deines", "dein", "your (informal)"],
  ["seine seinen seinem seiner seines", "sein", "his / its"], ["ihre ihren ihrem ihrer ihres", "ihr", "her / their / your (formal)"],
  ["unser unsere unseren unserem unserer unseres", "unser", "our"], ["euer eure euren eurem eurer eures", "euer", "your (plural)"],
  ["dem den des", "der / die / das", "the"], ["im", "im = in dem", "in the"], ["am", "am = an dem", "at / on the"],
  ["ans", "ans = an das", "to the"], ["ins", "ins = in das", "into the"], ["zum", "zum = zu dem", "to the"], ["zur", "zur = zu der", "to the"],
  ["vom", "vom = von dem", "from / of the"], ["beim", "beim = bei dem", "at / at the"], ["sich", "sich", "oneself / himself / herself / themselves"],
  ["mich mir", "ich → mich / mir", "me"], ["dich dir", "du → dich / dir", "you"], ["ihn ihm", "er → ihn / ihm", "him"],
  ["uns", "wir → uns", "us / ourselves"], ["euch", "ihr → euch", "you (plural)"], ["ihnen", "sie → ihnen", "them"],
  ["manche manchen mancher manches", "manche", "some"], ["andere anderen anderer anderes anderem", "andere", "other(s)"], ["mehr", "mehr", "more"],
].forEach(([forms, head, en]) => forms.split(" ").forEach((f) => FIXED.set(f, { head, en, cat: "func", lvl: null, example: null })));

export function glossCat(g) {
  if (g.type === "noun") {
    let article = strOrNull(g.article);
    if (article == null) { const m = /^(der|die|das)\b/i.exec(str(g.de)); article = m ? m[1] : "der"; }
    return article.toLowerCase();
  }
  return GLOSS_TYPE_CAT[str(g.type)] || null;
}

// Forms → meaning, case-sensitive ("Essen" ≠ "essen") with a lowercase fallback. First entry wins.
export class Dict {
  constructor() { this.exact = new Map(); this.lower = new Map(); }
  put(form, g) {
    if (!form) return;
    if (!this.exact.has(form)) this.exact.set(form, g);
    const lf = form.toLowerCase();
    if (!this.lower.has(lf)) this.lower.set(lf, g);
  }
  // Index one entry under its bare form(s): article/"sich"/"(Pl.)" removed, " / " alternatives split.
  add(de, en, cat, lvl, example, verbish) {
    const cleaned = str(de).replace(PLURAL_NOTE, "").split("(sich)").join("sich").trim();
    const heads = cleaned.split(/\s+\/\s+/).map((h) => h.trim()).filter(Boolean);
    const ens = str(en).split(/\s+\/\s+/);
    const paired = heads.length > 1 && ens.length === heads.length; // "ich / du" ↔ "I / you"
    heads.forEach((h, i) => {
      const art = /^(der|die|das)\s/i.exec(h);
      const gCat = art && /^(der|die|das)$/.test(str(cat).toLowerCase()) ? art[1].toLowerCase() : cat;
      const g = { head: paired ? h : cleaned, en: paired ? ens[i].trim() : en, cat: gCat, lvl, example };
      const form = h.replace(/^(der|die|das)\s+/i, "").replace(/^sich\s+/i, "").replace(/\s*(\.\.\.|…)$/, "").trim();
      this.put(form, g);
      if (verbish && form.includes(" ")) this.put(form.split(" ")[0], g); // "aufhören mit" → also "aufhören"
      if (form.includes("...") || form.includes("…")) for (const piece of form.split(/\s*(?:\.\.\.|…)\s*/)) this.put(piece.trim(), g);
    });
  }
  addGlossary(glossary) {
    for (const g of asList(glossary)) {
      const type = str(g.type);
      this.add(str(g.de), str(g.en), glossCat(g), "B1", strOrNull(g.example), type === "verbs" || type === "separable_verbs");
    }
  }
}

// Plausible base forms of an inflected word, most likely first.
export function candidates(word) {
  const lw = word.toLowerCase();
  const out = [];
  const push = (s) => { if (s && s.length >= 2) out.push(s); };
  out.push(lw);
  if (IRREGULAR.has(lw)) push(IRREGULAR.get(lw));
  // prefixed irregulars: annimmt → an + nehmen, verhält → ver + halten
  IRREGULAR.forEach((inf, k) => { if (k.length >= 4 && lw.length - k.length >= 2 && lw.endsWith(k)) push(lw.slice(0, lw.length - k.length) + inf); });
  const bases = [lw];
  for (const p of SEP_PREFIXES) {
    if ((lw.startsWith(p + "ge") || lw.startsWith(p + "zu")) && lw.length > p.length + 4) { bases.push(p + lw.slice(p.length + 2)); break; }
  }
  if (lw.startsWith("ge") && lw.length > 5) bases.push(lw.slice(2)); // gekündigt → kündigt
  for (const b of bases) {
    if (b !== lw) push(b);
    push(b + "en"); push(b + "n");
    for (const suf of STRIP_SUFFIXES) {
      if (b.endsWith(suf) && b.length - suf.length >= 3) {
        const stem = b.slice(0, b.length - suf.length);
        push(stem); push(stem + "en"); push(stem + "n"); push(stem + "e");
      }
    }
  }
  return out;
}

export class WordLookup {
  constructor(dicts) { this.dicts = dicts; this.found = new Map(); }
  lookup(word) {
    if (this.found.has(word)) return this.found.get(word);
    let hit = FIXED.get(word.toLowerCase()) || null;
    if (!hit) for (const d of this.dicts) { hit = d.exact.get(word) || null; if (hit) break; }
    if (!hit) {
      outer: for (const c of candidates(word)) for (const d of this.dicts) { const h = d.lower.get(c); if (h) { hit = h; break outer; } }
    }
    if (!hit && word.includes("-")) hit = this.lookup(word.slice(word.lastIndexOf("-") + 1)); // "Kinder-Betreuung" → "Betreuung"
    this.found.set(word, hit);
    return hit;
  }
  // A **marked** target span: whole span, each " / " part, a split separable verb, each word, then the closest glossary entry.
  lookupTarget(span, glossary) {
    const clean = span.replace(PLURAL_NOTE, "").replace(/^(der|die|das|den|dem|des)\s+/i, "").trim();
    let hit = this.lookup(clean);
    if (hit) return hit;
    const parts = clean.split(/\s+\/\s+/);
    if (parts.length > 1) for (const p of parts) { hit = this.lookup(p.replace(/^(der|die|das)\s+/i, "")); if (hit) return hit; }
    const pair = clean.replace(/^sich\s+/i, "").split(/\s+/);
    if (pair.length === 2 && SEP_PREFIXES.includes(pair[1].toLowerCase())) {
      hit = this.lookup(pair[1].toLowerCase() + pair[0].toLowerCase());
      if (hit) return hit;
    }
    if (clean.includes(" ")) {
      const words = clean.split(/\s+/).filter((w) => w.length > 2).sort((a, b) => b.length - a.length);
      for (const w of words) { hit = this.lookup(w); if (hit) return hit; }
    }
    const lw = clean.toLowerCase();
    let best = null, bestLen = 4;
    for (const g of asList(glossary)) {
      const f = str(g.de).replace(/^(der|die|das)\s+/i, "").replace(/^sich\s+/i, "").toLowerCase();
      let n = 0;
      while (n < f.length && n < lw.length && f[n] === lw[n]) n++;
      if (n > bestLen) { bestLen = n; best = g; }
    }
    return best ? { head: str(best.de), en: str(best.en), cat: glossCat(best), lvl: "B1", example: strOrNull(best.example) } : null;
  }
}

// --- stories (as StoryService.java) ---
export const TARGET = /\*\*(.+?)\*\*/g;
export const WORD = /[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*/g;
export const paragraphsOf = (text) => str(text).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

export function plainSegments(part, lookup, segs) {
  if (!part) return;
  let last = 0, m;
  const re = new RegExp(WORD.source, "g");
  while ((m = re.exec(part)) !== null) {
    if (m.index > last) segs.push({ t: part.slice(last, m.index) });
    const g = m[0].length > 1 ? lookup.lookup(m[0]) : null;
    segs.push(g ? { w: m[0], entry: g } : { t: m[0] });
    last = m.index + m[0].length;
  }
  if (last < part.length) segs.push({ t: part.slice(last) });
}

// Paragraph → segments: {t} plain text, or {w, entry, target} for a word with a meaning.
export function segmentsOf(para, lookup, glossary) {
  const segs = [];
  let last = 0, m;
  const re = new RegExp(TARGET.source, "g");
  while ((m = re.exec(para)) !== null) {
    plainSegments(para.slice(last, m.index), lookup, segs);
    segs.push({ w: m[1], entry: lookup.lookupTarget(m[1], glossary), target: true });
    last = m.index + m[0].length;
  }
  plainSegments(para.slice(last), lookup, segs);
  return segs;
}

export function buildContent(vocab, patternsRaw) {
  const byKey = buildCards(vocab);
  const cards = [...byKey.values()];
  const st = (vocab && vocab.stories) || {};
  const items = asList(st.items);
  const byId = new Map(items.map((s) => [storyId(s.id), s]));
  const seen = new Set();
  const groups = [];
  for (const p of asList(st.phases)) {
    const list = [];
    for (const cid of Array.isArray(p.chapter_ids) ? p.chapter_ids : []) {
      const s = byId.get(storyId(cid));
      if (s) { list.push(s); seen.add(storyId(cid)); }
    }
    if (list.length) groups.push({ phase: p, index: p.index == null ? null : String(Math.trunc(Number(p.index))), stories: list });
  }
  const rest = items.filter((s) => !seen.has(storyId(s.id))).sort((a, b) => (Number(a.chapter) || 0) - (Number(b.chapter) || 0));
  if (rest.length) groups.push({ phase: { name: "Weitere Geschichten" }, index: null, stories: rest });
  const flat = groups.flatMap((g) => g.stories);

  // every story glossary first, then all vocabulary cards (A1 → B1)
  const global = new Dict();
  items.forEach((s) => global.addGlossary(s.glossary));
  for (const c of cards) global.add(c.de, c.en, c.cat, c.lvl, c.example, c.cat === "verb" || c.cat === "sep");

  const readers = new Map();
  const brief = (s) => ({ id: storyId(s.id), chapter: s.chapter == null ? "" : s.chapter });
  function reader(id) {
    if (readers.has(id)) return readers.get(id);
    const story = byId.get(id);
    if (!story) return null;
    const glossary = asList(story.glossary);
    const own = new Dict();
    own.addGlossary(glossary);
    const lookup = new WordLookup([own, global]);
    const de = paragraphsOf(story.story_de), en = paragraphsOf(story.story_en);
    const paragraphs = de.map((para, i) => {
      const segments = segmentsOf(para, lookup, glossary);
      return { segments, en: i < en.length ? en[i] : null, speech: segments.map((sg) => (sg.t != null ? sg.t : sg.w)).join("") };
    });
    const i = flat.findIndex((s) => storyId(s.id) === id);
    let endsPhase = null;
    for (const g of groups) {
      const ids = g.phase.chapter_ids;
      if (g.index && Array.isArray(ids) && ids.length && storyId(ids[ids.length - 1]) === id) endsPhase = g.index;
    }
    const v = {
      id, chapter: story.chapter, phaseName: story.phase_name, titleDe: story.title_de, titleEn: story.title_en, paragraphs,
      glossary: glossary.map((g) => ({ de: str(g.de), en: str(g.en), cat: glossCat(g) || "" })),
      prev: i > 0 ? brief(flat[i - 1]) : null, next: i >= 0 && i < flat.length - 1 ? brief(flat[i + 1]) : null, endsPhase,
    };
    readers.set(id, v);
    return v;
  }

  // The story list; read marks and phase test statuses come from the learner's progress (null until it has loaded).
  function storyList(progress) {
    const read = new Set(progress ? progress.read : []);
    const tests = (progress && progress.tests) || {};
    let readCount = 0;
    const out = groups.map((g) => {
      const stories = g.stories.map((s) => {
        const id = storyId(s.id);
        if (read.has(id)) readCount++;
        return { id, chapter: s.chapter, titleDe: s.title_de, titleEn: s.title_en,
          words: s.target_count != null ? s.target_count : asList(s.glossary).length, read: read.has(id) };
      });
      const t = (g.index && tests[g.index]) || {};
      return { phase: { index: g.index, name: g.phase.name, description: g.phase.description, note: g.phase.note },
        stories, allRead: stories.every((s) => s.read), test: t.test || null, verbTest: t.verbTest || null };
    });
    return { level: st.level || "B1", count: byId.size, readCount, total: flat.length, groups: out };
  }

  // patterns.json, each example read as one sentence (for 🔊)
  const patterns = asList(patternsRaw).map((p) => Object.assign({}, p, {
    examples: asList(p.examples).map((e) => Object.assign({}, e, {
      sentence: asList(e.chunks).map((c) => c.text).join(" ").replace(/\s+([,.!?])/g, "$1"),
    })),
  }));

  return {
    cards, card: (key) => byKey.get(key) || null,
    pool: (levels, cats) => cards.filter((c) => levels.includes(c.lvl) && cats.includes(c.cat)),
    reader, storyList, patterns,
  };
}

// Saves one answer of a round the page runs (the backend checks it against the card and saves it).
export function saveAnswer(mode, key, pick, onChange) {
  return api.post("/api/answers", { mode, key, pick }, undefined, { quiet: true })
    .then((r) => { if (onChange) onChange(r); return r; })
    .catch((e) => { api.report(e); return null; });
}

// A round the page runs itself: a plain object built from the content, changed
// in place by the component, which then re-renders.
export function useRound(build, deps, reload) {
  const [content, error] = useContent(reload);
  const [, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const round = useMemo(() => (content ? build(content) : null), [content, ...deps]);
  const update = useCallback((fn) => { if (round) { fn(round); setTick((n) => n + 1); } }, [round]);
  return { round, update, error };
}

// A practice round run by the backend: start it, render its view, send actions.
export function useDrill(mode, params, version, onChange) {
  const [state, setState] = useState({ id: null, view: null, error: null });
  const busy = useRef(false);
  const paramsKey = JSON.stringify(params || {});
  const start = useCallback(() => {
    setState({ id: null, view: null, error: null });
    return api.post("/api/drills/" + mode, params || {})
      .then((r) => { setState({ id: r.id, view: r.view, error: null }); })
      .catch((e) => setState({ id: null, view: null, error: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paramsKey, version]);
  useEffect(() => { start(); }, [start]);
  const act = useCallback((action, payload) => {
    if (!state.id || busy.current) return Promise.resolve();
    busy.current = true;
    return api.post("/api/drills/" + state.id + "/" + action, payload || {})
      .then((r) => { setState((s) => Object.assign({}, s, { view: r.view })); if (onChange) onChange(r); })
      .catch((e) => { if (e.status === 410) start(); else api.report(e); })
      .finally(() => { busy.current = false; });
  }, [state.id, start, onChange]);
  return { view: state.view, error: state.error, act };
}
