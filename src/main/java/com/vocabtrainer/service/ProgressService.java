package com.vocabtrainer.service;

import static com.vocabtrainer.repository.ProgressRepository.FieldWrite.delete;
import static com.vocabtrainer.repository.ProgressRepository.FieldWrite.set;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.ProgressRepository.FieldWrite;
import com.vocabtrainer.repository.ProgressRepository;
import org.springframework.stereotype.Service;

/**
 * What happens to the learner's record when they answer: the spaced-repetition
 * schedule, today's counters and streak, the Review list, the quiz all-time score.
 * Reads and saves go through {@link ProgressRepository}; every change is one save.
 */
@Service
public class ProgressService {

    private final ProgressRepository repo;

    public ProgressService(ProgressRepository repo) {
        this.repo = repo;
    }

    public Map<String, Object> doc(Ctx ctx) {
        return repo.find(ctx);
    }

    public Map<String, Map<String, Object>> srs(Ctx ctx) {
        return mapOfMaps(repo.find(ctx), "srs");
    }

    public Map<String, Object> daily(Ctx ctx) {
        return map(repo.find(ctx), "daily");
    }

    public Map<String, Map<String, Object>> mistakes(Ctx ctx) {
        return mapOfMaps(repo.find(ctx), "mistakes");
    }

    public Map<String, Object> prefs(Ctx ctx) {
        return map(repo.find(ctx), "prefs");
    }

    public Map<String, Object> storiesRead(Ctx ctx) {
        return map(repo.find(ctx), "storiesRead");
    }

    public Map<String, Map<String, Object>> phaseTests(Ctx ctx) {
        return mapOfMaps(repo.find(ctx), "phaseTests");
    }

    public long[] allTime(Ctx ctx) {
        Map<String, Object> d = repo.find(ctx);
        return new long[] {Srs.num(d.get("right"), 0), Srs.num(d.get("total"), 0)};
    }

    /** Study / Write grade ("again" | "good" | "easy"): schedule + today's counters. */
    public void grade(Ctx ctx, Card card, String grade) {
        List<FieldWrite> w = new ArrayList<>();
        addGrade(ctx, card, grade, w);
        repo.save(ctx, w, null);
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
        repo.save(ctx, w, inc);
    }

    private void addGrade(Ctx ctx, Card card, String grade, List<FieldWrite> w) {
        Map<String, Object> prev = srs(ctx).get(card.key());
        Map<String, Object> next = Srs.advance(prev, grade, System.currentTimeMillis());
        w.add(set(next, "srs", card.key()));
        w.add(set(Srs.advanceDaily(daily(ctx), prev == null, ctx.today(), ctx.yesterday()), "daily"));
    }

    /** One activity toward today's goal without touching the schedule (sentence patterns). */
    public void tickDaily(Ctx ctx) {
        repo.save(ctx, List.of(set(Srs.advanceDaily(daily(ctx), false, ctx.today(), ctx.yesterday()), "daily")), null);
    }

    public void removeMistake(Ctx ctx, String key) {
        if (mistakes(ctx).containsKey(key)) {
            repo.save(ctx, List.of(delete("mistakes", key)), null);
        }
    }

    public void clearMistakes(Ctx ctx) {
        repo.save(ctx, List.of(set(new LinkedHashMap<>(), "mistakes")), null);
    }

    public boolean toggleStoryRead(Ctx ctx, String id) {
        boolean read = !storiesRead(ctx).containsKey(id);
        repo.save(ctx, List.of(read ? set(System.currentTimeMillis(), "storiesRead", id) : delete("storiesRead", id)), null);
        return read;
    }

    public void savePrefs(Ctx ctx, Map<String, Object> changes) {
        List<FieldWrite> w = new ArrayList<>();
        changes.forEach((k, v) -> w.add(set(v, "prefs", k)));
        repo.save(ctx, w, null);
    }

    public void savePhaseTest(Ctx ctx, String index, Map<String, Object> state) {
        Map<String, Object> s = new LinkedHashMap<>(state);
        s.put("updated", System.currentTimeMillis());
        repo.save(ctx, List.of(set(s, "phaseTests", index)), null);
    }

    // ---- saved quiz rounds (their own subcollection) ----

    public List<Map<String, Object>> sessions(Ctx ctx) {
        return repo.findSessions(ctx, 15);
    }

    public void addSession(Ctx ctx, long right, long total, List<String> cats) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("right", right);
        s.put("total", total);
        s.put("cats", cats);
        s.put("timestamp", System.currentTimeMillis());
        repo.saveSession(ctx, s);
    }

    public void clearSessions(Ctx ctx) {
        repo.deleteSessions(ctx);
    }

    // ---- typed views of the document ----

    @SuppressWarnings("unchecked")
    private static Map<String, Object> map(Map<String, Object> doc, String field) {
        Object v = doc.get(field);
        return v instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Map<String, Object>> mapOfMaps(Map<String, Object> doc, String field) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        map(doc, field).forEach((k, v) -> {
            if (v instanceof Map<?, ?> m) {
                out.put(k, (Map<String, Object>) m);
            }
        });
        return out;
    }
}
