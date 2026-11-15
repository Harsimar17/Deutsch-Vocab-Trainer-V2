import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { PageTitle, Eyebrow, Reveal, Typed } from "../bits/fx.jsx";
import { monoLabel, smallOutline, srsCol } from "./ui/common.jsx";

export const CASES = ["Nominative", "Akkusative", "Dative", "Genitive"];
export const casesOf = (...rows) => rows.map((r, i) => [CASES[i], ...r]);
export const PERSONS = ["ich", "du", "er / sie / es", "wir", "ihr", "sie / Sie"];
export const personsOf = (...cols) => PERSONS.map((p, i) => [p, ...cols.map((c) => c[i])]);

export const RULES = [
  {
    id: "order", title: "Word order", sub: "where the verb goes",
    rules: [
      { title: "Verb in 2nd position (V2)", formulas: [
        ["🟢 V2 - und, aber, oder, denn", "2nd"],
        ["🟢 V2 - dann, deshalb, danach, Manchmal, trotzdem", "2nd"],
        ["🟢 V2 - heute, gestern, morgen", "2nd"],
      ] },
      { title: "Verb at the end", formulas: [
        ["🔴 Verb - END", "weil, dass, wenn, als, obwohl, ob, wann, bevor, Nach, Nachdem, Während"],
      ] },
      { title: "Modal verbs", formulas: [
        ["🔵 Modal - können, müssen, wollen, dürfen, sollen, möchten", "Modal V2 + main verb END"],
      ] },
      { title: "Perfekt", formulas: [
        ["🟣 Perfekt - haben / sein + Partizip II", "Auxiliary V2 + Partizip II END"],
      ] },
      { title: "Futur I", formulas: [
        ["🟠 Futur - I", "werden + Infinitiv", "werden V2 + Infinitiv END"],
      ] },
      { title: "wann / als / wenn", formulas: [
        ["🟢 WANN = question"],
        ["🔵 ALS = one time in the past"],
        ["🟠 WENN = every time / if"],
      ] },
      { title: "Questions", formulas: [
        ["🟢 W-question", "W-word + Verb + subject", "Wann kommst du?"],
        ["🔵 Yes / no question", "Verb 1st + subject", "Kommst du morgen?"],
        ["🔴 Indirect question", "ob / W-word … Verb END", "Ich weiß nicht, ob er kommt."],
      ] },
      { title: "zu + Infinitiv", formulas: [
        ["🟢 zu + Infinitiv", "… zu + Infinitiv END", "Ich habe keine Lust, ins Kino zu gehen."],
        ["🔵 um … zu (purpose)", "um … zu + Infinitiv END", "Ich lerne Deutsch, um in Berlin zu arbeiten."],
        ["🟠 separable verb", "zu goes in the middle", "anzurufen, aufzustehen"],
        ["🟣 ohne … zu / statt … zu", "… zu + Infinitiv END", "Er geht, ohne tschüss zu sagen."],
      ] },
      { title: "B1 connectors — position 0 (verb stays 2nd)", table: {
        head: ["Connector", "Meaning", "Example"],
        rows: [
          ["und", "and", "Ich lerne Deutsch und er lernt Englisch."],
          ["aber", "but", "Das Auto ist alt, aber es fährt gut."],
          ["oder", "or", "Kommst du heute oder kommst du morgen?"],
          ["denn", "because", "Ich bleibe zu Hause, denn ich bin krank."],
          ["sondern", "but rather (after nicht)", "Er kommt nicht heute, sondern er kommt morgen."],
        ],
      }, note: "ADUSO — aber, denn, und, sondern, oder: they stand outside the sentence, nothing moves." },
      { title: "B1 connectors — verb right after (V2)", table: {
        head: ["Connector", "Meaning", "Example"],
        rows: [
          ["deshalb, deswegen, darum, daher", "that's why", "Ich bin krank, deshalb bleibe ich zu Hause."],
          ["trotzdem, dennoch", "still, anyway", "Es regnet, trotzdem gehe ich spazieren."],
          ["dann, danach", "then, afterwards", "Zuerst esse ich, danach gehe ich ins Bett."],
          ["außerdem", "besides, also", "Die Wohnung ist groß, außerdem ist sie billig."],
          ["sonst", "otherwise", "Beeil dich, sonst verpassen wir den Zug."],
          ["also", "so, therefore", "Es ist spät, also gehen wir nach Hause."],
          ["stattdessen", "instead", "Ich nehme nicht das Auto, stattdessen fahre ich mit dem Bus."],
          ["inzwischen", "meanwhile", "Ich koche, inzwischen deckst du den Tisch."],
        ],
      }, note: "They take position 1 — the verb comes next, then the subject." },
      { title: "B1 connectors — verb at the END", table: {
        head: ["Connector", "Meaning", "Example"],
        rows: [
          ["weil, da", "because", "Ich bleibe zu Hause, weil ich krank bin."],
          ["dass", "that", "Ich glaube, dass er recht hat."],
          ["ob", "whether", "Ich weiß nicht, ob er kommt."],
          ["wenn", "if, whenever", "Wenn es regnet, bleibe ich zu Hause."],
          ["als", "when (once, in the past)", "Als ich klein war, wohnte ich in Köln."],
          ["obwohl", "although", "Obwohl es regnet, gehe ich spazieren."],
          ["damit", "so that", "Ich spreche langsam, damit du mich verstehst."],
          ["sodass", "so that (result)", "Es regnete stark, sodass wir zu Hause blieben."],
          ["während", "while", "Während ich koche, hört er Musik."],
          ["bevor", "before", "Bevor ich gehe, rufe ich dich an."],
          ["nachdem", "after", "Nachdem ich gegessen hatte, ging ich spazieren."],
          ["seit, seitdem", "since", "Seitdem ich in Berlin wohne, spreche ich mehr Deutsch."],
          ["bis", "until", "Ich warte, bis du kommst."],
          ["sobald", "as soon as", "Sobald ich Zeit habe, rufe ich dich an."],
          ["solange", "as long as", "Solange es hell ist, spielen die Kinder draußen."],
          ["falls", "in case", "Falls es regnet, nehmen wir den Bus."],
          ["indem", "by (doing)", "Man lernt eine Sprache, indem man viel spricht."],
        ],
      }, note: "Nebensatz first → the main clause starts with its verb: Wenn es regnet, bleibe ich zu Hause (verb, verb)." },
      { title: "B1 connectors — two-part", table: {
        head: ["Connector", "Meaning", "Example"],
        rows: [
          ["sowohl … als auch", "both … and", "Ich spreche sowohl Deutsch als auch Englisch."],
          ["weder … noch", "neither … nor", "Er trinkt weder Kaffee noch Tee."],
          ["entweder … oder", "either … or", "Entweder kommst du mit oder du bleibst hier."],
          ["nicht nur … sondern auch", "not only … but also", "Sie ist nicht nur nett, sondern auch klug."],
          ["zwar … aber", "admittedly … but", "Das Hotel ist zwar teuer, aber sehr schön."],
          ["je … desto", "the more … the more", "Je mehr ich lerne, desto besser spreche ich."],
        ],
      }, formulas: [
        ["🟠 je … desto", "je + Komparativ … Verb END", "desto + Komparativ + Verb 2nd"],
      ] },
      { title: "damit or um … zu", formulas: [
        ["🔵 same subject", "um … zu + Infinitiv END", "Ich lerne viel, um die Prüfung zu bestehen."],
        ["🔴 different subject", "damit … Verb END", "Ich erkläre es dir, damit du es verstehst."],
      ] },
    ],
  },
  {
    id: "articles", title: "Articles", sub: "der / die / das and ein / kein / mein in every case",
    rules: [
      { title: "Definite article (der, die, das)", cases: casesOf(
        ["der", "die", "das", "die"],
        ["den", "die", "das", "die"],
        ["dem", "der", "dem", "den"],
        ["des", "der", "des", "der"],
      ), note: "Dative plural: the noun gets -n (mit den Kindern). Genitive M / N: the noun gets -s / -es (des Mannes)." },
      { title: "Indefinite article (ein, kein)", cases: casesOf(
        ["ein", "eine", "ein", "keine"],
        ["einen", "eine", "ein", "keine"],
        ["einem", "einer", "einem", "keinen"],
        ["eines", "einer", "eines", "keiner"],
      ), note: "\"ein\" has no plural — the plural column shows kein. Possessives (mein, dein, …) take the same endings." },
      { title: "Possessive articles (mein, dein, …)", cases: casesOf(
        ["mein", "meine", "mein", "meine"],
        ["meinen", "meine", "mein", "meine"],
        ["meinem", "meiner", "meinem", "meinen"],
        ["meines", "meiner", "meines", "meiner"],
      ), formulas: [
        ["ich → mein", "du → dein", "er / es → sein"],
        ["sie → ihr", "wir → unser", "ihr → euer (eure)"],
        ["sie → ihr", "Sie → Ihr"],
      ] },
    ],
  },
  {
    id: "time", title: "Time words", sub: "days, weeks, years, Wochenende — their article and preposition",
    rules: [
      { title: "Which article", table: {
        head: ["Article", "Time words", "When?"],
        rows: [
          ["der", "Tag, Morgen, Vormittag, Mittag, Nachmittag, Abend · Montag … Sonntag", "am Montag, am Abend"],
          ["der", "Januar … Dezember · Frühling, Sommer, Herbst, Winter · Monat", "im Januar, im Sommer"],
          ["der", "Geburtstag, Feiertag, Urlaub", "am Geburtstag, im Urlaub"],
          ["die", "Woche, Nacht, Stunde, Minute, Mitternacht", "in der Woche, in der Nacht"],
          ["die", "Ferien (plural only)", "in den Ferien"],
          ["das", "Jahr, Wochenende, Jahrhundert, Datum", "im Jahr 2026, am Wochenende"],
        ],
      }, note: "All days, months and seasons are der. Weihnachten and Ostern go without article: an / zu Weihnachten." },
      { title: "When? — the preposition", formulas: [
        ["🟢 am", "days, parts of the day, dates, Wochenende", "am Montag, am Abend, am 3. Mai, am Wochenende"],
        ["🔵 im", "months, seasons", "im Januar, im Sommer"],
        ["🟣 in der", "Woche, Nacht", "in der Woche, in der Nacht"],
        ["🟠 um", "clock time", "um 8 Uhr, um Mitternacht"],
        ["🔴 years", "no preposition, or im Jahr", "2026 / im Jahr 2026 — never \"in 2026\""],
      ] },
      { title: "How long ago / since / until — Dative", formulas: [
        ["🔵 seit", "since, for (still going on)", "seit einem Jahr, seit zwei Wochen"],
        ["🟣 vor", "ago", "vor einem Monat, vor drei Tagen"],
        ["🟢 in", "in (future)", "in einer Woche, in zwei Jahren"],
        ["🟠 von … bis / ab", "from … to / from … on", "von Montag bis Freitag, ab nächster Woche"],
      ] },
      { title: "Without preposition — Akkusative", table: {
        head: ["Akkusative", "M", "F", "N"],
        rows: [
          ["jeder", "jeden Tag", "jede Woche", "jedes Jahr"],
          ["letzter", "letzten Montag", "letzte Woche", "letztes Jahr"],
          ["nächster", "nächsten Monat", "nächste Woche", "nächstes Wochenende"],
          ["dieser", "diesen Sommer", "diese Woche", "dieses Jahr"],
        ],
      }, note: "Ich gehe jeden Tag spazieren. Nächste Woche habe ich Urlaub." },
      { title: "Every … — words with -s", formulas: [
        ["🟢 days", "montags, dienstags, … sonntags", "Montags gehe ich schwimmen. (every Monday)"],
        ["🔵 parts of the day", "morgens, mittags, nachmittags, abends, nachts", "Abends lese ich. (every evening)"],
      ], note: "Written small — they are adverbs, not nouns." },
    ],
  },
  {
    id: "adjectives", title: "Adjective declension", sub: "the ending depends on the article in front",
    rules: [
      { title: "Without article", cases: casesOf(
        ["-er", "-e", "-es", "-e"],
        ["-en", "-e", "-es", "-e"],
        ["-em", "-er", "-em", "-en"],
        ["-en", "-er", "-en", "-er"],
      ), note: "guter Kaffee · kalte Milch · frisches Brot · nette Leute — the adjective shows the case itself." },
      { title: "With der, die, das", cases: casesOf(
        ["-e", "-e", "-e", "-en"],
        ["-en", "-e", "-e", "-en"],
        ["-en", "-en", "-en", "-en"],
        ["-en", "-en", "-en", "-en"],
      ), note: "der gute Kaffee · die kalte Milch · das frische Brot · die netten Leute. Same after dieser, jeder, welcher, alle." },
      { title: "With ein, kein, mein", cases: casesOf(
        ["-er", "-e", "-es", "-en"],
        ["-en", "-e", "-es", "-en"],
        ["-en", "-en", "-en", "-en"],
        ["-en", "-en", "-en", "-en"],
      ), note: "ein guter Kaffee · eine kalte Milch · ein frisches Brot · keine netten Leute." },
    ],
  },
  {
    id: "pronouns", title: "Pronouns", sub: "ich, mich, mir …",
    rules: [
      { title: "Personal pronouns", table: {
        head: ["Person", "Nominative", "Akkusative", "Dative"],
        rows: [
          ["1st sg.", "ich", "mich", "mir"],
          ["2nd sg.", "du", "dich", "dir"],
          ["3rd sg. M", "er", "ihn", "ihm"],
          ["3rd sg. F", "sie", "sie", "ihr"],
          ["3rd sg. N", "es", "es", "ihm"],
          ["1st pl.", "wir", "uns", "uns"],
          ["2nd pl.", "ihr", "euch", "euch"],
          ["3rd pl.", "sie", "sie", "ihnen"],
          ["formal", "Sie", "Sie", "Ihnen"],
        ],
      } },
      { title: "Reflexive pronouns", table: {
        head: ["Person", "Akkusative", "Dative"],
        rows: [
          ["ich", "mich", "mir"],
          ["du", "dich", "dir"],
          ["er / sie / es", "sich", "sich"],
          ["wir", "uns", "uns"],
          ["ihr", "euch", "euch"],
          ["sie / Sie", "sich", "sich"],
        ],
      }, note: "Ich wasche mich. — Ich wasche mir die Hände (Dative when there is another object)." },
      { title: "Relative pronouns", cases: casesOf(
        ["der", "die", "das", "die"],
        ["den", "die", "das", "die"],
        ["dem", "der", "dem", "denen"],
        ["dessen", "deren", "dessen", "deren"],
      ), formulas: [
        ["🔴 Relativsatz", "der / die / das … Verb END", "Der Mann, der dort steht, ist mein Vater."],
      ] },
    ],
  },
  {
    id: "prepositions", title: "Prepositions", sub: "each one decides the case",
    rules: [
      { title: "Prepositions and their case", table: {
        head: ["Case", "Prepositions", "Example"],
        rows: [
          ["Akkusative", "durch, für, gegen, ohne, um, bis, entlang", "für dich"],
          ["Dative", "aus, bei, mit, nach, seit, von, zu, gegenüber, ab", "mit dem Bus"],
          ["Genitive", "wegen, trotz, während, statt, innerhalb, außerhalb", "wegen des Wetters"],
        ],
      } },
      { title: "Two-way prepositions", formulas: [
        ["an, auf, hinter, in, neben, über, unter, vor, zwischen"],
        ["🔵 Wo? (position)", "→ Dative", "Ich bin in der Stadt."],
        ["🟠 Wohin? (direction)", "→ Akkusative", "Ich gehe in die Stadt."],
      ] },
      { title: "Short forms", formulas: [
        ["an dem → am", "in dem → im", "zu dem → zum"],
        ["an das → ans", "in das → ins", "zu der → zur"],
        ["bei dem → beim", "von dem → vom"],
      ] },
    ],
  },
  {
    id: "verbs", title: "Verbs", sub: "present, past, Konjunktiv II, Passiv",
    rules: [
      { title: "Present tense", table: {
        head: ["Person", "machen", "sein", "haben", "werden"],
        rows: personsOf(
          ["mache", "machst", "macht", "machen", "macht", "machen"],
          ["bin", "bist", "ist", "sind", "seid", "sind"],
          ["habe", "hast", "hat", "haben", "habt", "haben"],
          ["werde", "wirst", "wird", "werden", "werdet", "werden"],
        ),
      }, note: "Regular endings: -e, -st, -t, -en, -t, -en." },
      { title: "Modal verbs — present", table: {
        head: ["Person", "können", "müssen", "wollen"],
        rows: personsOf(
          ["kann", "kannst", "kann", "können", "könnt", "können"],
          ["muss", "musst", "muss", "müssen", "müsst", "müssen"],
          ["will", "willst", "will", "wollen", "wollt", "wollen"],
        ),
      } },
      { table: {
        head: ["Person", "dürfen", "sollen", "möchten"],
        rows: personsOf(
          ["darf", "darfst", "darf", "dürfen", "dürft", "dürfen"],
          ["soll", "sollst", "soll", "sollen", "sollt", "sollen"],
          ["möchte", "möchtest", "möchte", "möchten", "möchtet", "möchten"],
        ),
      }, note: "ich and er / sie / es have the same form — no -t." },
      { title: "Präteritum", table: {
        head: ["Person", "sein", "haben", "können", "müssen"],
        rows: personsOf(
          ["war", "warst", "war", "waren", "wart", "waren"],
          ["hatte", "hattest", "hatte", "hatten", "hattet", "hatten"],
          ["konnte", "konntest", "konnte", "konnten", "konntet", "konnten"],
          ["musste", "musstest", "musste", "mussten", "musstet", "mussten"],
        ),
      }, formulas: [
        ["🟢 regular verbs", "stem + -te + ending", "machen → ich machte, wir machten"],
      ] },
      { title: "Perfekt: haben or sein, Partizip II", formulas: [
        ["🟣 sein", "movement or change of state", "gehen, fahren, kommen, aufstehen, werden, bleiben, sein"],
        ["🟣 haben", "all other verbs", "machen, essen, lernen, sehen"],
        ["🟢 regular", "ge- … -t", "gemacht, gelernt"],
        ["🔵 irregular", "ge- … -en", "gesehen, gefahren"],
        ["🟠 separable", "prefix + ge + verb", "aufgestanden, eingekauft"],
        ["🔴 no ge-", "-ieren, be-, ver-, er-, ent-, zer-, emp-", "studiert, besucht, verstanden"],
      ] },
      { title: "Konjunktiv II", table: {
        head: ["Person", "würde", "hätte", "wäre", "könnte"],
        rows: personsOf(
          ["würde", "würdest", "würde", "würden", "würdet", "würden"],
          ["hätte", "hättest", "hätte", "hätten", "hättet", "hätten"],
          ["wäre", "wärst", "wäre", "wären", "wärt", "wären"],
          ["könnte", "könntest", "könnte", "könnten", "könntet", "könnten"],
        ),
      }, formulas: [
        ["🔵 wish / polite / unreal", "würde V2 + Infinitiv END", "Ich würde gern kommen."],
        ["🟠 wenn …, würde …", "Wenn ich Zeit hätte, würde ich kommen."],
      ] },
      { title: "Passiv", formulas: [
        ["🟢 Präsens", "werden V2 + Partizip II END", "Das Haus wird gebaut."],
        ["🔵 Präteritum", "wurde V2 + Partizip II END", "Das Haus wurde gebaut."],
        ["🟣 Perfekt", "sein V2 + Partizip II + worden END", "Das Haus ist gebaut worden."],
        ["🟠 by whom", "von + Dative", "Das Haus wird von der Firma gebaut."],
      ] },
    ],
  },
  {
    id: "comparison", title: "Comparison", sub: "groß, größer, am größten",
    rules: [
      { title: "Komparativ and Superlativ", table: {
        head: ["Positiv", "Komparativ", "Superlativ"],
        rows: [
          ["klein", "kleiner", "am kleinsten"],
          ["alt", "älter", "am ältesten"],
          ["groß", "größer", "am größten"],
          ["hoch", "höher", "am höchsten"],
          ["gut", "besser", "am besten"],
          ["viel", "mehr", "am meisten"],
          ["gern", "lieber", "am liebsten"],
        ],
      }, formulas: [
        ["🟢 equal", "so + Adjektiv + wie", "Er ist so groß wie ich."],
        ["🔵 more", "Komparativ + als", "Er ist größer als ich."],
      ] },
    ],
  },
];

export function FormulaRows({ rows }) {
  return (
    <div className="formulas" style={{ fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: 1.5, color: "var(--ink)" }}>
      {rows.map((row, i) => (
        <div key={i} className="frow">
          {row.map((c, j) => <div key={j} className={row.length === 1 ? "all" : row.length === 2 && j === 1 ? "wide" : undefined}>{c}</div>)}
        </div>
      ))}
    </div>
  );
}

export function CaseTable({ rows }) {
  return (
    <div className="rwrap">
      <table className="rtable">
        <thead>
          <tr>
            <th rowSpan={2} className="h-case">Cases</th>
            <th colSpan={3} className="h-sing">Singular</th>
            <th rowSpan={2} className="h-pl">Plural</th>
          </tr>
          <tr><th className="h-sing">M</th><th className="h-sing">F</th><th className="h-sing">N</th></tr>
        </thead>
        <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function RuleTable({ head, rows }) {
  return (
    <div className="rwrap">
      <table className="rtable">
        <thead><tr>{head.map((h, j) => <th key={h} className={j === 0 ? "h-case" : "h-sing"}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => j === 0 ? <th key={j} scope="row">{c}</th> : <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function FormulasPage() {
  const jump = (id) => { const el = document.getElementById("rules-" + id); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); };
  return (
    <div style={{ ...srsCol, width: "100%", maxWidth: "760px", margin: "0 auto", alignItems: "stretch", gap: "18px" }}>
      <div>
        <Eyebrow text="Reference" />
        <PageTitle text="Grammar" />
        <Typed className="page-sub" text="Word order, cases, endings and verb charts" />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
        {RULES.map((g) => <button key={g.id} onClick={() => jump(g.id)} style={{ ...smallOutline("var(--ink-soft)"), borderColor: "var(--line)" }}>{g.title}</button>)}
      </div>
      {RULES.map((g) => (
        <Reveal key={g.id}><section id={"rules-" + g.id} className="rgroup">
          <div style={{ marginBottom: "4px" }}>
            <h2 className="rgroup-title">{g.title}</h2>
            <div style={{ ...monoLabel, marginTop: "4px" }}>{g.sub}</div>
          </div>
          {g.rules.map((r, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {r.title && <h3 className="rhead">{r.title}</h3>}
              {r.cases && <CaseTable rows={r.cases} />}
              {r.table && <RuleTable head={r.table.head} rows={r.table.rows} />}
              {r.formulas && <FormulaRows rows={r.formulas} />}
              {r.note && <div style={{ fontFamily: "var(--font-serif)", fontSize: "14px", fontStyle: "italic", color: "var(--ink-soft)", lineHeight: 1.5 }}>{r.note}</div>}
            </div>
          ))}
        </section></Reveal>
      ))}
    </div>
  );
}

// Line icons (24px grid, stroke = currentColor) for the app header and tab bar.
