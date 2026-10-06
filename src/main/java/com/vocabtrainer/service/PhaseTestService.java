package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.model.Ctx;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The end-of-phase vocabulary test's rules and bookkeeping (the rounds
 * themselves are {@code PhaseDrill}). Built on successive relearning:
 * a word is mastered after a correct first try in two separate rounds, in
 * both directions; after passing, refreshers come due at 1/7/30/90/180 days.
 *
 * Each phase has two tests with their own progress: "words" (the stories'
 * target words) and "verbs" (the B1 verbs used in the stories).
 *
 * A test can be retaken at any time ("short": a few random words, "all":
 * every word). A retake changes no progress — only its score is kept, in
 * "attempts".
 */
@Service
public class PhaseTestService {

    public static final int MASTER = 2;
    public static final int ROUND_WORDS = 12;
    public static final int REFRESH_WORDS = 20;
    public static final int[] REFRESH_DAYS = {1, 7, 30, 90, 180};
    public static final Map<String, String> TYPE_LABEL = Map.of(
            "noun", "Nomen · mit Artikel", "verbs", "Verb", "adjectives", "Adjektiv",
            "separable_verbs", "trennbares Verb", "function_words", "Konnektor", "phrases", "Redemittel");

    public static final String WORDS = "words";
    public static final String VERBS = "verbs";
    public static final String RETAKE_SHORT = "short";
    public static final String RETAKE_ALL = "all";
    public static final int RETAKE_SHORT_WORDS = 10;
    private static final int KEEP_ATTEMPTS = 20;

    private final ProgressService progress;
    private final StoryService stories;

    public PhaseTestService(ProgressService progress, StoryService stories) {
        this.progress = progress;
        this.stories = stories;
    }

    /** The test set asked for: "words" (default) or "verbs"; anything else is a 400. */
    public static String set(Object value) {
        if (value == null || WORDS.equals(value)) {
            return WORDS;
        }
        if (VERBS.equals(value)) {
            return VERBS;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "set must be words or verbs");
    }

    /** A retake's size: "short", "all", or null for a normal round; anything else is a 400. */
    public static String retake(Object value) {
        if (value == null || RETAKE_SHORT.equals(value) || RETAKE_ALL.equals(value)) {
            return (String) value;
        }
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "retake must be short or all");
    }

    /** Where a phase test's progress is saved: "2" for the words, "2-verbs" for the verbs. */
    public static String storageKey(String idx, String set) {
        return VERBS.equals(set) ? idx + "-verbs" : idx;
    }

    /** The state saved under a storage key (see {@link #storageKey}). */
    public Map<String, Object> state(Ctx ctx, String idx) {
        Map<String, Object> st = progress.phaseTests(ctx).get(idx);
        return st == null ? new LinkedHashMap<>(Map.of("words", new LinkedHashMap<>())) : st;
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Map<String, Object>> words(Map<String, Object> st) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        if (st.get("words") instanceof Map<?, ?> m) {
            m.forEach((k, v) -> {
                if (v instanceof Map<?, ?> w) {
                    out.put(String.valueOf(k), (Map<String, Object>) w);
                }
            });
        }
        return out;
    }

    /** Saved retake results ({at, right, total, size}), oldest first. */
    @SuppressWarnings("unchecked")
    public static List<Map<String, Object>> attempts(Map<String, Object> st) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (st.get("attempts") instanceof List<?> l) {
            l.forEach(a -> {
                if (a instanceof Map<?, ?> m) {
                    out.add((Map<String, Object>) m);
                }
            });
        }
        return out;
    }

    /** Adds one retake result (the last {@value #KEEP_ATTEMPTS} are kept); nothing else changes. */
    public void saveAttempt(Ctx ctx, String key, Map<String, Object> attempt) {
        Map<String, Object> st = new LinkedHashMap<>(state(ctx, key));
        List<Map<String, Object>> all = attempts(st);
        all.add(attempt);
        st.put("attempts", all.subList(Math.max(0, all.size() - KEEP_ATTEMPTS), all.size()));
        save(ctx, key, st);
    }

    public static boolean mastered(Map<String, Object> ws) {
        return ws != null && Srs.num(ws.get("r"), 0) >= MASTER && Srs.num(ws.get("p"), 0) >= MASTER;
    }

    /** Status for the phase card and overview: kind + numbers; the page words it. */
    public static Map<String, Object> status(List<StoryService.PhaseWord> words, Map<String, Object> st) {
        Map<String, Map<String, Object>> ws = words(st);
        long mastered = words.stream().filter(w -> mastered(ws.get(w.card().de()))).count();
        boolean started = words.stream().anyMatch(w -> ws.containsKey(w.card().de()));
        boolean passed = st.get("passed") != null;
        long due = Srs.num(st.get("due"), 0);
        boolean dueNow = passed && due > 0 && due <= System.currentTimeMillis();
        String kind;
        if (passed && dueNow) {
            kind = "refreshDue";
        } else if (passed && mastered < words.size()) {
            kind = "practiceAgain";
        } else if (passed) {
            kind = "passed";
        } else if (started) {
            kind = "inProgress";
        } else {
            kind = "notStarted";
        }
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("kind", kind);
        s.put("mastered", mastered);
        s.put("total", words.size());
        s.put("open", words.size() - mastered);
        s.put("passed", passed);
        s.put("dueNow", dueNow);
        s.put("due", due == 0 ? null : due);
        s.put("started", started);
        return s;
    }

    public Map<String, Object> overview(Ctx ctx, String idx, String set) {
        StoryService.Group g = stories.group(idx);
        List<StoryService.PhaseWord> words = phaseWords(idx, set);
        Map<String, Object> st = state(ctx, storageKey(idx, set));
        Map<String, Map<String, Object>> ws = words(st);
        Map<String, Object> status = status(words, st);
        List<Map<String, Object>> missed = words.stream()
                .filter(w -> ws.containsKey(w.card().de()) && Srs.num(ws.get(w.card().de()).get("miss"), 0) > 0)
                .sorted(Comparator.comparingLong(w -> -Srs.num(ws.get(w.card().de()).get("miss"), 0)))
                .limit(8)
                .map(w -> Map.<String, Object>of("de", w.card().de(), "miss", Srs.num(ws.get(w.card().de()).get("miss"), 0)))
                .toList();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("set", set);
        v.put("phase", Map.of("index", idx, "name", g.phase().getOrDefault("name", ""),
                "chapters", g.phase().get("chapter_ids") instanceof List<?> l ? l.size() : g.stories().size()));
        v.put("status", status);
        v.put("recDone", words.stream().filter(w -> Srs.num(ws.getOrDefault(w.card().de(), Map.of()).get("r"), 0) >= MASTER).count());
        v.put("prodDone", words.stream().filter(w -> Srs.num(ws.getOrDefault(w.card().de(), Map.of()).get("p"), 0) >= MASTER).count());
        v.put("roundWords", Math.min(ROUND_WORDS, (long) status.get("open")));
        v.put("refreshWords", Math.min(REFRESH_WORDS, words.size()));
        v.put("missed", missed);
        v.put("refreshDays", REFRESH_DAYS);
        v.put("retakeShortWords", Math.min(RETAKE_SHORT_WORDS, words.size()));
        List<Map<String, Object>> attempts = new ArrayList<>(attempts(st));
        Collections.reverse(attempts); // newest first
        v.put("attempts", attempts);
        return v;
    }

    /** Starts a phase's test over (404 for an unknown phase) and returns the fresh overview. */
    public Map<String, Object> resetAndOverview(Ctx ctx, String idx, String set) {
        stories.group(idx);
        reset(ctx, storageKey(idx, set));
        return overview(ctx, idx, set);
    }

    public void reset(Ctx ctx, String idx) {
        Map<String, Object> st = new LinkedHashMap<>();
        st.put("words", new LinkedHashMap<>());
        progress.savePhaseTest(ctx, idx, st);
    }

    public void save(Ctx ctx, String idx, Map<String, Object> st) {
        progress.savePhaseTest(ctx, idx, st);
    }

    /** What a phase's test asks: its target words, or the B1 verbs used in its stories. */
    public List<StoryService.PhaseWord> phaseWords(String idx, String set) {
        return VERBS.equals(set) ? stories.phaseVerbs(idx) : stories.phaseWords(idx);
    }

    /**
     * Where wrong options come from: the test's own words — and for the verbs,
     * also every B1 verb, since a phase may use only a handful.
     */
    public List<StoryService.PhaseWord> optionPool(String idx, String set) {
        List<StoryService.PhaseWord> pool = new ArrayList<>(phaseWords(idx, set));
        if (VERBS.equals(set)) {
            Set<String> have = new HashSet<>();
            pool.forEach(w -> have.add(w.card().de()));
            stories.b1Verbs().stream().filter(w -> have.add(w.card().de())).forEach(pool::add); // each verb once
        }
        return pool;
    }

    public ProgressService progress() {
        return progress;
    }

}
