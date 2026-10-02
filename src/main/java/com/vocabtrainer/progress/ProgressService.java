package com.vocabtrainer.progress;

import static com.vocabtrainer.progress.ProgressRepository.FieldWrite.delete;
import static com.vocabtrainer.progress.ProgressRepository.FieldWrite.set;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.progress.ProgressRepository.FieldWrite;
import org.springframework.stereotype.Service;

/**
 * What happens to the learner's record when they answer: the spaced-repetition
 * schedule, today's counters and streak, the Review list, the quiz all-time score.
 * Every change is one Firestore commit (through {@link ProgressStore}).
 */
@Service
public class ProgressService {

    private final ProgressStore store;
    private final ProgressRepository repo;

    public ProgressService(ProgressStore store, ProgressRepository repo) {
        this.store = store;
        this.repo = repo;
    }

    public Map<String, Object> doc(Ctx ctx) {
        return store.doc(ctx);
    }

    public Map<String, Map<String, Object>> srs(Ctx ctx) {
        return ProgressStore.mapOfMaps(store.doc(ctx), "srs");
    }

    public Map<String, Object> daily(Ctx ctx) {
        return ProgressStore.map(store.doc(ctx), "daily");
    }

    public Map<String, Map<String, Object>> mistakes(Ctx ctx) {
        return ProgressStore.mapOfMaps(store.doc(ctx), "mistakes");
    }

    public Map<String, Object> prefs(Ctx ctx) {
        return ProgressStore.map(store.doc(ctx), "prefs");
    }

    public Map<String, Object> storiesRead(Ctx ctx) {
        return ProgressStore.map(store.doc(ctx), "storiesRead");
    }

    public Map<String, Map<String, Object>> phaseTests(Ctx ctx) {
        return ProgressStore.mapOfMaps(store.doc(ctx), "phaseTests");
    }

    public long[] allTime(Ctx ctx) {
        Map<String, Object> d = store.doc(ctx);
        return new long[] {Srs.num(d.get("right"), 0), Srs.num(d.get("total"), 0)};
    }

    /** Study / Write grade ("again" | "good" | "easy"): schedule + today's counters. */
    public void grade(Ctx ctx, Card card, String grade) {
        List<FieldWrite> w = new ArrayList<>();
        addGrade(ctx, card, grade, w);
        store.apply(ctx, w, null);
    }

    /**
     * Any other mode's answer. A miss puts the word on the Review list (or bumps
     * its count); a hit on a listed word records that it went right — nothing is
     * ever taken off the list automatically. Also feeds the schedule
     * (correct → good, wrong → again) and, for the Quiz, the all-time score.
     */
    public void recordResult(Ctx ctx, Card card, boolean correct, boolean countInQuizScore) {
        List<FieldWrite> w = new ArrayList<>();
        addGrade(ctx, card, correct ? "good" : "again", w);
        Map<String, Object> cur = mistakes(ctx).get(card.key());
        if (!correct || cur != null) {
            Map<String, Object> value = new LinkedHashMap<>();
            if (correct) {
                value.putAll(cur);
                value.put("right", Srs.num(cur.get("right"), 0) + 1);
            } else {
                value.put("wrong", (cur == null ? 0 : Srs.num(cur.get("wrong"), 0)) + 1);
                value.put("right", cur == null ? 0 : Srs.num(cur.get("right"), 0));
                value.put("ts", System.currentTimeMillis());
            }
            w.add(set(value, "mistakes", card.key()));
        }
        Map<String, Long> inc = null;
        if (countInQuizScore) {
            inc = new HashMap<>();
            inc.put("right", correct ? 1L : 0L);
            inc.put("total", 1L);
        }
        store.apply(ctx, w, inc);
    }

    private void addGrade(Ctx ctx, Card card, String grade, List<FieldWrite> w) {
        Map<String, Object> prev = srs(ctx).get(card.key());
        Map<String, Object> next = Srs.advance(prev, grade, System.currentTimeMillis());
        w.add(set(next, "srs", card.key()));
        w.add(set(Srs.advanceDaily(daily(ctx), prev == null, ctx.today(), ctx.yesterday()), "daily"));
    }

    /** One activity toward today's goal without touching the schedule (sentence patterns). */
    public void tickDaily(Ctx ctx) {
        store.apply(ctx, List.of(set(Srs.advanceDaily(daily(ctx), false, ctx.today(), ctx.yesterday()), "daily")), null);
    }

    public void removeMistake(Ctx ctx, String key) {
        if (mistakes(ctx).containsKey(key)) {
            store.apply(ctx, List.of(delete("mistakes", key)), null);
        }
    }

    public void clearMistakes(Ctx ctx) {
        store.apply(ctx, List.of(set(new LinkedHashMap<>(), "mistakes")), null);
    }

    public boolean toggleStoryRead(Ctx ctx, String id) {
        boolean read = !storiesRead(ctx).containsKey(id);
        store.apply(ctx, List.of(read ? set(System.currentTimeMillis(), "storiesRead", id) : delete("storiesRead", id)), null);
        return read;
    }

    public void savePrefs(Ctx ctx, Map<String, Object> changes) {
        List<FieldWrite> w = new ArrayList<>();
        changes.forEach((k, v) -> w.add(set(v, "prefs", k)));
        store.apply(ctx, w, null);
    }

    public void savePhaseTest(Ctx ctx, String index, Map<String, Object> state) {
        Map<String, Object> s = new LinkedHashMap<>(state);
        s.put("updated", System.currentTimeMillis());
        store.apply(ctx, List.of(set(s, "phaseTests", index)), null);
    }

    // ---- saved quiz rounds (their own subcollection, not cached) ----

    public List<Map<String, Object>> sessions(Ctx ctx) {
        return repo.recentSessions(ctx, 15);
    }

    public void addSession(Ctx ctx, long right, long total, List<String> cats) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("right", right);
        s.put("total", total);
        s.put("cats", cats);
        s.put("timestamp", System.currentTimeMillis());
        repo.addSession(ctx, s);
    }

    public void clearSessions(Ctx ctx) {
        repo.clearSessions(ctx);
    }
}
