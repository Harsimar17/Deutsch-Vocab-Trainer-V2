package com.vocabtrainer.stories;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressService;
import com.vocabtrainer.progress.Srs;
import org.springframework.stereotype.Service;

/**
 * The end-of-phase vocabulary test's rules and bookkeeping (the rounds
 * themselves are {@code PhaseDrill}). Built on successive relearning:
 * a word is mastered after a correct first try in two separate rounds, in
 * both directions; after passing, refreshers come due at 1/7/30/90/180 days.
 */
@Service
public class PhaseTests {

    public static final int MASTER = 2;
    public static final int ROUND_WORDS = 12;
    public static final int REFRESH_WORDS = 20;
    public static final int[] REFRESH_DAYS = {1, 7, 30, 90, 180};
    public static final Map<String, String> TYPE_LABEL = Map.of(
            "noun", "Nomen · mit Artikel", "verbs", "Verb", "adjectives", "Adjektiv",
            "separable_verbs", "trennbares Verb", "function_words", "Konnektor", "phrases", "Redemittel");

    private final ProgressService progress;
    private final StoryService stories;

    public PhaseTests(ProgressService progress, StoryService stories) {
        this.progress = progress;
        this.stories = stories;
    }

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

    public Map<String, Object> overview(Ctx ctx, String idx) {
        StoryService.Group g = stories.group(idx);
        List<StoryService.PhaseWord> words = stories.phaseWords(idx);
        Map<String, Object> st = state(ctx, idx);
        Map<String, Map<String, Object>> ws = words(st);
        Map<String, Object> status = status(words, st);
        List<Map<String, Object>> missed = words.stream()
                .filter(w -> ws.containsKey(w.card().de()) && Srs.num(ws.get(w.card().de()).get("miss"), 0) > 0)
                .sorted(Comparator.comparingLong(w -> -Srs.num(ws.get(w.card().de()).get("miss"), 0)))
                .limit(8)
                .map(w -> Map.<String, Object>of("de", w.card().de(), "miss", Srs.num(ws.get(w.card().de()).get("miss"), 0)))
                .toList();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("phase", Map.of("index", idx, "name", g.phase().getOrDefault("name", ""),
                "chapters", g.phase().get("chapter_ids") instanceof List<?> l ? l.size() : g.stories().size()));
        v.put("status", status);
        v.put("recDone", words.stream().filter(w -> Srs.num(ws.getOrDefault(w.card().de(), Map.of()).get("r"), 0) >= MASTER).count());
        v.put("prodDone", words.stream().filter(w -> Srs.num(ws.getOrDefault(w.card().de(), Map.of()).get("p"), 0) >= MASTER).count());
        v.put("roundWords", Math.min(ROUND_WORDS, (long) status.get("open")));
        v.put("refreshWords", Math.min(REFRESH_WORDS, words.size()));
        v.put("missed", missed);
        v.put("refreshDays", REFRESH_DAYS);
        return v;
    }

    public void reset(Ctx ctx, String idx) {
        Map<String, Object> st = new LinkedHashMap<>();
        st.put("words", new LinkedHashMap<>());
        progress.savePhaseTest(ctx, idx, st);
    }

    public void save(Ctx ctx, String idx, Map<String, Object> st) {
        progress.savePhaseTest(ctx, idx, st);
    }

    public List<StoryService.PhaseWord> phaseWords(String idx) {
        return stories.phaseWords(idx);
    }

    public ProgressService progress() {
        return progress;
    }

}
