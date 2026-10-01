package com.harsimar.vocab.cards;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** German text rules: lenient answer checking, noun/separable-verb helpers, cloze sentences. */
public final class German {

    /** Separable prefixes, longest-match order as the page used them ("mit" twice, as before). */
    public static final List<String> SEP_PREFIXES = List.of(
            "auf", "an", "aus", "ein", "mit", "nach", "vor", "zu", "ab", "um",
            "zurück", "weg", "hin", "her", "fest", "los", "teil", "statt", "durch",
            "heraus", "zusammen", "vorbei", "fern", "bei", "mit");
    public static final List<String> SEP_COMMON = List.of("auf", "an", "aus", "ein", "mit", "nach", "vor", "zu", "ab", "um");

    private static final Pattern PLURAL_NOTE = Pattern.compile("\\s*\\((?:Pl\\.|WG)\\)");
    private static final Pattern ARTICLE = Pattern.compile("^(der|die|das)\\s+", Pattern.CASE_INSENSITIVE);
    private static final Pattern UMLAUT_ANY_CASE = Pattern.compile("[äöüßÄÖÜ]");

    private German() {
    }

    /** Result of checking a typed German answer. */
    public record Check(String verdict, String spelled, String hint) {
        static Check of(String verdict) {
            return new Check(verdict, null, null);
        }

        public boolean correct() {
            return "correct".equals(verdict);
        }
    }

    public static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }

    public static String foldUmlaut(String s) {
        return s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss");
    }

    /** Case, ae/oe/ue/ss, trailing punctuation and extra spaces don't matter. */
    public static String normDe(String s) {
        return foldUmlaut(lower(s).trim()).replaceAll("[.!?,;:]+$", "").replaceAll("\\s+", " ");
    }

    /** Accepted spellings of a card: each " / " alternative, "(Pl.)" dropped, "(sich)" kept as "sich". */
    public static List<String> acceptedDe(Card card) {
        String de = PLURAL_NOTE.matcher(nz(card.de())).replaceAll("").trim();
        List<String> out = new ArrayList<>();
        for (String x : de.split(" / ")) {
            String f = x.replace("(sich)", "sich").replaceAll("\\s{2,}", " ").trim();
            if (!f.isEmpty()) {
                out.add(f);
            }
        }
        return out;
    }

    /** Write mode: typed German for a card. A wrong/missing article is "close", with a hint. */
    public static Check checkDe(Card card, String input) {
        String given = normDe(input);
        if (given.isEmpty()) {
            return Check.of("empty");
        }
        boolean typedUmlaut = UMLAUT_ANY_CASE.matcher(nz(input)).find();
        List<String> forms = acceptedDe(card);
        for (String f : forms) {
            if (given.equals(normDe(f))) {
                // any-case: "Übung" typed as "Uebung" still gets the proper spelling shown
                return UMLAUT_ANY_CASE.matcher(f).find() && !typedUmlaut ? new Check("correct", f, null) : Check.of("correct");
            }
        }
        if (card.isNoun() && !forms.isEmpty()) {
            String bare = normDe(ARTICLE.matcher(forms.get(0)).replaceFirst(""));
            if (given.equals(bare)) {
                return new Check("close", null, "Right word — add the article: " + card.cat() + ".");
            }
            if (given.replaceFirst("^(der|die|das)\\s+", "").equals(bare)) {
                return new Check("close", null, "Wrong article — it's “" + card.cat() + "”.");
            }
        }
        return Check.of("wrong");
    }

    public static String stripArticle(String de) {
        return nz(de).replaceFirst("^(der|die|das)\\s+", "");
    }

    /** The bare noun(s) of a card, without article or "(Pl.)". */
    public static List<String> nounForms(Card card) {
        String de = PLURAL_NOTE.matcher(nz(card.de())).replaceAll("").trim();
        List<String> out = new ArrayList<>();
        for (String s : de.split(" / ")) {
            String f = ARTICLE.matcher(s).replaceFirst("").trim();
            if (!f.isEmpty()) {
                out.add(f);
            }
        }
        return out;
    }

    /** A noun's example sentence split around the noun (for Fill-in). */
    public record Cloze(String before, String answer, String after) {
    }

    public static Cloze clozeMatch(Card card) {
        String sentence = nz(card.example());
        if (sentence.isEmpty()) {
            return null;
        }
        for (String f : nounForms(card)) {
            Matcher m = Pattern.compile(Pattern.quote(f), Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(sentence);
            if (m.find()) {
                return new Cloze(sentence.substring(0, m.start()), m.group(), sentence.substring(m.end()));
            }
        }
        return null;
    }

    /** Infinitive and separable prefix of a separable verb card. */
    public record SepParts(String inf, String prefix) {
    }

    public static SepParts sepParts(Card card) {
        String de = nz(card.de()).trim();
        de = de.replaceFirst("(?i)^sich\\s+", "").replaceFirst("(?i)\\s+(mit|auf|an|über|für|zu|nach|von|in|bei|um)$", "").trim();
        String inf = de.split(" ")[0];
        if (inf.isEmpty()) {
            inf = de;
        }
        String prefix = card.prefix();
        if (prefix == null || prefix.isEmpty()) {
            String li = lower(inf);
            prefix = SEP_PREFIXES.stream().filter(li::startsWith).findFirst().orElse("");
        }
        return new SepParts(inf, lower(prefix));
    }

    /** The example sentence with the (last) free-standing prefix blanked out. */
    public static Cloze sepCloze(Card card, String prefix) {
        String ex = nz(card.example()).trim();
        if (ex.isEmpty() || prefix == null || prefix.isEmpty()) {
            return null;
        }
        Matcher m = Pattern.compile("(^|[\\s(])(" + Pattern.quote(prefix) + ")(?=[\\s.,!?;:)]|$)",
                Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE).matcher(ex);
        int at = -1;
        while (m.find()) {
            at = m.start(2);
        }
        if (at < 0) {
            return null;
        }
        return new Cloze(ex.substring(0, at), ex.substring(at, at + prefix.length()), ex.substring(at + prefix.length()));
    }

    // ---- Phasentest production check (stricter list of accepted spellings) ----

    static String ptNorm(String s) {
        return foldUmlaut(lower(s)).replaceAll("[.,!?;:…\"„“”'()]", " ").replaceAll("\\s+", " ").trim();
    }

    /** Each " / " alternative, with "(…)" dropped and spelled out: "beschränken(sich)" → also "sich beschränken". */
    static List<String> ptForms(String de) {
        List<String> out = new ArrayList<>();
        for (String f : PLURAL_NOTE.matcher(nz(de)).replaceAll("").split("\\s+/\\s+")) {
            String plain = f.replaceAll("\\s*\\([^)]*\\)\\s*", " ").trim();
            out.add(plain);
            Matcher m = Pattern.compile("\\(([^)]*)\\)").matcher(f);
            if (m.find()) {
                out.add(f.replaceAll("\\s*\\(([^)]*)\\)", " $1").trim());
                if (m.group(1).matches("^sich\\b.*")) {
                    out.add(m.group(1) + " " + plain);
                }
            }
        }
        out.removeIf(String::isEmpty);
        return out;
    }

    /** Lenient on case, punctuation, ae/oe/ue/ss and a leading "sich"; not on the article. */
    public static Check ptCheck(Card word, String input) {
        String given = ptNorm(input);
        if (given.isEmpty()) {
            return Check.of("empty");
        }
        boolean typedUmlaut = UMLAUT_ANY_CASE.matcher(nz(input)).find();
        for (String f : ptForms(word.de())) {
            String nf = ptNorm(f);
            if (given.equals(nf) || given.equals(nf.replaceFirst("^sich ", ""))) {
                // any-case: "Übung" typed as "Uebung" still gets the proper spelling shown
                return UMLAUT_ANY_CASE.matcher(f).find() && !typedUmlaut ? new Check("correct", f, null) : Check.of("correct");
            }
        }
        Check r = checkDe(word, input);
        return "close".equals(r.verdict()) ? r : Check.of("wrong");
    }

    public static String ptBare(Card word) {
        List<String> forms = acceptedDe(word);
        String f = forms.isEmpty() ? nz(word.de()) : forms.get(0);
        return f.replaceFirst("(?i)^(der|die|das)\\s+", "").replaceFirst("(?i)^sich\\s+", "");
    }

    /** Example with the target word blanked — a retrieval cue, not the answer. Null if not usable. */
    public static String ptCloze(Card word, String type) {
        if (word.example() == null || "phrases".equals(type)) {
            return null;
        }
        String bare = lower(ptBare(word).split("\\s+")[0]);
        if (bare.length() < 3) {
            return null;
        }
        String stem = bare.substring(0, Math.max(3, Math.min(5, bare.length() - 2)));
        Matcher m = Pattern.compile("[A-Za-zÄÖÜäöüß]+").matcher(word.example());
        StringBuilder sb = new StringBuilder();
        boolean hit = false;
        while (m.find()) {
            String tok = m.group();
            if (lower(tok).startsWith(stem)) {
                hit = true;
                m.appendReplacement(sb, "_".repeat(Math.min(tok.length(), 10)));
            } else {
                m.appendReplacement(sb, Matcher.quoteReplacement(tok));
            }
        }
        m.appendTail(sb);
        return hit ? sb.toString() : null;
    }


    private static String nz(String s) {
        return s == null ? "" : s;
    }
}
