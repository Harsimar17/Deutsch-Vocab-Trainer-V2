package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.vocabtrainer.model.Gloss;

/**
 * Finds the meaning of a German word as it appears in running text: exact
 * forms first, then fixed function words, irregular verbs, participles,
 * zu-infinitives and stripped endings. Dictionaries are searched in priority
 * order (the story's own glossary first).
 */
public final class WordLookup {

    static final Map<String, String> IRREGULAR = new LinkedHashMap<>();
    static final Map<String, Gloss> FIXED = new HashMap<>();
    static final List<String> STRIP_SUFFIXES = List.of("test", "tet", "ten", "est", "ern", "en", "em", "er", "es", "et", "st", "te", "e", "n", "s", "t");
    private static final Map<String, String> GLOSS_TYPE_CAT = Map.of(
            "verbs", "verb", "adjectives", "adj", "separable_verbs", "sep", "function_words", "func", "phrases", "phrase");

    static {
        irr("sein", "bin bist ist sind seid war warst waren gewesen wäre wären");
        irr("haben", "hat hast habe hatte hatten gehabt hätte hätten");
        irr("werden", "wird wirst wurde wurden geworden würde würden");
        irr("können", "kann kannst konnte konnten könnte könnten");
        irr("müssen", "muss musst musste mussten müsste");
        irr("wollen", "will willst wollte wollten");
        irr("dürfen", "darf darfst durfte durften dürfte");
        irr("sollen", "soll sollst sollte sollten");
        irr("mögen", "mag magst mochte");
        irr("wissen", "weiß weißt wusste gewusst");
        irr("geben", "gibt gab gaben gegeben");
        irr("sehen", "sieht sah sahen gesehen");
        irr("lesen", "liest las gelesen");
        irr("fahren", "fährt fuhr fuhren gefahren");
        irr("nehmen", "nimmt nahm nahmen genommen");
        irr("sprechen", "spricht sprach sprachen gesprochen");
        irr("helfen", "hilft half geholfen");
        irr("gehen", "ging gingen gegangen");
        irr("kommen", "kam kamen gekommen");
        irr("essen", "isst aß gegessen");
        irr("treffen", "trifft traf trafen getroffen");
        irr("schlafen", "schläft schlief");
        irr("laufen", "läuft lief");
        irr("tragen", "trägt trug");
        irr("halten", "hält hielt");
        irr("finden", "fand fanden gefunden");
        irr("bleiben", "blieb blieben geblieben");
        irr("schreiben", "schrieb geschrieben");
        irr("stehen", "stand standen gestanden");
        irr("sitzen", "saß gesessen");
        irr("liegen", "lag gelegen");
        irr("denken", "dachte gedacht");
        irr("bringen", "brachte gebracht");
        irr("kennen", "kannte gekannt");
        irr("tun", "tat tut getan");
        irr("rufen", "rief gerufen");
        irr("verstehen", "verstand verstanden");
        irr("gelten", "gilt galt gegolten");
        irr("wachsen", "wächst wuchs gewachsen");
        irr("bekommen", "bekam bekamen bekommt");

        // closed-class words the stemmer would get wrong ("meine" is not "meinen")
        fixed("mein meine meinen meinem meiner meines", "mein", "my");
        fixed("dein deine deinen deinem deiner deines", "dein", "your (informal)");
        fixed("seine seinen seinem seiner seines", "sein", "his / its");
        fixed("ihre ihren ihrem ihrer ihres", "ihr", "her / their / your (formal)");
        fixed("unser unsere unseren unserem unserer unseres", "unser", "our");
        fixed("euer eure euren eurem eurer eures", "euer", "your (plural)");
        fixed("dem den des", "der / die / das", "the");
        fixed("im", "im = in dem", "in the");
        fixed("am", "am = an dem", "at / on the");
        fixed("ans", "ans = an das", "to the");
        fixed("ins", "ins = in das", "into the");
        fixed("zum", "zum = zu dem", "to the");
        fixed("zur", "zur = zu der", "to the");
        fixed("vom", "vom = von dem", "from / of the");
        fixed("beim", "beim = bei dem", "at / at the");
        fixed("sich", "sich", "oneself / himself / herself / themselves");
        fixed("mich mir", "ich → mich / mir", "me");
        fixed("dich dir", "du → dich / dir", "you");
        fixed("ihn ihm", "er → ihn / ihm", "him");
        fixed("uns", "wir → uns", "us / ourselves");
        fixed("euch", "ihr → euch", "you (plural)");
        fixed("ihnen", "sie → ihnen", "them");
        fixed("manche manchen mancher manches", "manche", "some");
        fixed("andere anderen anderer anderes anderem", "andere", "other(s)");
        fixed("mehr", "mehr", "more");
    }

    private static void irr(String inf, String forms) {
        for (String f : forms.split(" ")) {
            IRREGULAR.put(f, inf);
        }
    }

    private static void fixed(String forms, String head, String en) {
        for (String f : forms.split(" ")) {
            FIXED.put(f, new Gloss(head, en, "func", null, null));
        }
    }

    /** Forms → meaning, case-sensitive ("Essen" ≠ "essen") with a lowercase fallback. First entry wins. */
    public static final class Dict {
        final Map<String, Gloss> exact = new HashMap<>();
        final Map<String, Gloss> lower = new HashMap<>();

        void put(String form, Gloss g) {
            if (form == null || form.isEmpty()) {
                return;
            }
            exact.putIfAbsent(form, g);
            lower.putIfAbsent(form.toLowerCase(Locale.ROOT), g);
        }

        /** Index one entry under its bare form(s): article/"sich"/"(Pl.)" removed, " / " alternatives split. */
        public void add(String de, String en, String cat, String lvl, String example, boolean verbish) {
            String cleaned = (de == null ? "" : de).replaceAll("\\s*\\((?:Pl\\.|WG)\\)", "").replace("(sich)", "sich").trim();
            List<String> heads = new ArrayList<>();
            for (String h : cleaned.split("\\s+/\\s+")) {
                if (!h.trim().isEmpty()) {
                    heads.add(h.trim());
                }
            }
            String[] ens = (en == null ? "" : en).split("\\s+/\\s+", -1);
            boolean paired = heads.size() > 1 && ens.length == heads.size(); // "ich / du" ↔ "I / you"
            for (int i = 0; i < heads.size(); i++) {
                String h = heads.get(i);
                Matcher art = Pattern.compile("^(der|die|das)\\s", Pattern.CASE_INSENSITIVE).matcher(h);
                String gCat = art.find() && German.lower(cat).matches("der|die|das") ? art.group(1).toLowerCase(Locale.ROOT) : cat;
                Gloss g = new Gloss(paired ? h : cleaned, paired ? ens[i].trim() : en, gCat, lvl, example);
                String form = h.replaceFirst("(?i)^(der|die|das)\\s+", "").replaceFirst("(?i)^sich\\s+", "")
                        .replaceFirst("\\s*(\\.\\.\\.|…)$", "").trim();
                put(form, g);
                if (verbish && form.contains(" ")) {
                    put(form.split(" ")[0], g); // "aufhören mit" → also "aufhören"
                }
                if (form.contains("...") || form.contains("…")) {
                    for (String piece : form.split("\\s*(?:\\.\\.\\.|…)\\s*")) {
                        put(piece.trim(), g); // "je ... desto" → "je", "desto"
                    }
                }
            }
        }

        public void addGlossary(List<Map<String, Object>> glossary) {
            for (Map<String, Object> g : glossary) {
                String type = str(g.get("type"));
                add(str(g.get("de")), str(g.get("en")), glossCat(g), "B1", strOrNull(g.get("example")),
                        "verbs".equals(type) || "separable_verbs".equals(type));
            }
        }
    }

    public static String glossCat(Map<String, Object> g) {
        if ("noun".equals(g.get("type"))) {
            String article = strOrNull(g.get("article"));
            if (article == null) {
                Matcher m = Pattern.compile("^(der|die|das)\\b", Pattern.CASE_INSENSITIVE).matcher(str(g.get("de")));
                article = m.find() ? m.group(1) : "der";
            }
            return article.toLowerCase(Locale.ROOT);
        }
        return GLOSS_TYPE_CAT.get(str(g.get("type")));
    }

    /** Plausible base forms of an inflected word, most likely first. */
    static List<String> candidates(String word) {
        String lw = word.toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();
        out.add(lw);
        if (IRREGULAR.containsKey(lw)) {
            push(out, IRREGULAR.get(lw));
        }
        // prefixed irregulars: annimmt → an + nehmen, verhält → ver + halten
        IRREGULAR.forEach((k, inf) -> {
            if (k.length() >= 4 && lw.length() - k.length() >= 2 && lw.endsWith(k)) {
                push(out, lw.substring(0, lw.length() - k.length()) + inf);
            }
        });
        List<String> bases = new ArrayList<>();
        bases.add(lw);
        for (String p : German.SEP_PREFIXES) {
            if ((lw.startsWith(p + "ge") || lw.startsWith(p + "zu")) && lw.length() > p.length() + 4) {
                bases.add(p + lw.substring(p.length() + 2)); // umgesetzt → umsetzt, aufzustehen → aufstehen
                break;
            }
        }
        if (lw.startsWith("ge") && lw.length() > 5) {
            bases.add(lw.substring(2)); // gekündigt → kündigt
        }
        for (String b : bases) {
            if (!b.equals(lw)) {
                push(out, b);
            }
            push(out, b + "en");
            push(out, b + "n");
            for (String suf : STRIP_SUFFIXES) {
                if (b.endsWith(suf) && b.length() - suf.length() >= 3) {
                    String stem = b.substring(0, b.length() - suf.length());
                    push(out, stem);
                    push(out, stem + "en");
                    push(out, stem + "n");
                    push(out, stem + "e");
                }
            }
        }
        return out;
    }

    private static void push(List<String> out, String s) {
        if (s != null && s.length() >= 2) {
            out.add(s);
        }
    }

    private final List<Dict> dicts;
    private final Map<String, Gloss> cache = new HashMap<>();
    private final Map<String, Boolean> missing = new HashMap<>();

    public WordLookup(List<Dict> dicts) {
        this.dicts = dicts;
    }

    public Gloss lookup(String word) {
        Gloss cached = cache.get(word);
        if (cached != null || missing.containsKey(word)) {
            return cached;
        }
        Gloss hit = FIXED.get(word.toLowerCase(Locale.ROOT));
        if (hit == null) {
            for (Dict d : dicts) {
                hit = d.exact.get(word);
                if (hit != null) {
                    break;
                }
            }
        }
        if (hit == null) {
            outer:
            for (String c : candidates(word)) {
                for (Dict d : dicts) {
                    Gloss h = d.lower.get(c);
                    if (h != null) {
                        hit = h;
                        break outer;
                    }
                }
            }
        }
        if (hit == null && word.contains("-")) {
            hit = lookup(word.substring(word.lastIndexOf('-') + 1)); // "Kinder-Betreuung" → "Betreuung"
        }
        if (hit == null) {
            missing.put(word, true);
        } else {
            cache.put(word, hit);
        }
        return hit;
    }

    /**
     * A **marked** target span: whole span, then each " / " part, a split
     * separable verb ("lehnt ab" → "ablehnt"), each word, and finally the story
     * glossary entry sharing the longest prefix (wahrnimmt → wahrnehmen).
     */
    public Gloss lookupTarget(String span, List<Map<String, Object>> glossary) {
        String clean = span.replaceAll("\\s*\\((?:Pl\\.|WG)\\)", "").replaceFirst("(?i)^(der|die|das|den|dem|des)\\s+", "").trim();
        Gloss hit = lookup(clean);
        if (hit != null) {
            return hit;
        }
        String[] parts = clean.split("\\s+/\\s+");
        if (parts.length > 1) {
            for (String p : parts) {
                hit = lookup(p.replaceFirst("(?i)^(der|die|das)\\s+", ""));
                if (hit != null) {
                    return hit;
                }
            }
        }
        String[] pair = clean.replaceFirst("(?i)^sich\\s+", "").split("\\s+");
        if (pair.length == 2 && German.SEP_PREFIXES.contains(pair[1].toLowerCase(Locale.ROOT))) {
            hit = lookup(pair[1].toLowerCase(Locale.ROOT) + pair[0].toLowerCase(Locale.ROOT));
            if (hit != null) {
                return hit;
            }
        }
        if (clean.contains(" ")) {
            List<String> words = new ArrayList<>();
            for (String w : clean.split("\\s+")) {
                if (w.length() > 2) {
                    words.add(w);
                }
            }
            words.sort((a, b) -> b.length() - a.length());
            for (String w : words) {
                hit = lookup(w);
                if (hit != null) {
                    return hit;
                }
            }
        }
        String lw = clean.toLowerCase(Locale.ROOT);
        Map<String, Object> best = null;
        int bestLen = 4;
        for (Map<String, Object> g : glossary) {
            String f = str(g.get("de")).replaceFirst("(?i)^(der|die|das)\\s+", "").replaceFirst("(?i)^sich\\s+", "").toLowerCase(Locale.ROOT);
            int n = 0;
            while (n < f.length() && n < lw.length() && f.charAt(n) == lw.charAt(n)) {
                n++;
            }
            if (n > bestLen) {
                bestLen = n;
                best = g;
            }
        }
        return best == null ? null
                : new Gloss(str(best.get("de")), str(best.get("en")), glossCat(best), "B1", strOrNull(best.get("example")));
    }

    static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    static String strOrNull(Object o) {
        return o == null || String.valueOf(o).isEmpty() ? null : String.valueOf(o);
    }
}
