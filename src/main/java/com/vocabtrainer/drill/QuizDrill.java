package com.vocabtrainer.drill;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressService;
import com.vocabtrainer.util.Rand;

/** Quiz: pick the meaning from four (same-category distractors). Keeps the all-time score and saved rounds. */
class QuizDrill implements Drill {

    record Question(Card correct, List<Card> options) {
    }

    private final List<Card> pool;
    private final List<String> cats;
    private final String direction;
    private final boolean noRepeat;
    private final ProgressService progress;
    private final Set<String> asked = new HashSet<>();
    private Question q;
    private String picked;
    private long right;
    private long total;
    private boolean saved;
    private boolean done;
    private List<Map<String, Object>> sessions; // loaded on first view, refreshed after saving/clearing

    QuizDrill(List<Card> pool, List<String> cats, String direction, boolean noRepeat, ProgressService progress) {
        this.pool = pool;
        this.cats = cats;
        this.direction = direction;
        this.noRepeat = noRepeat;
        this.progress = progress;
        if (pool.size() >= 4) {
            resetRound();
        }
    }

    /** Correct answer from {@code source} (or the pool); 3 distractors of the same category if there are enough. */
    static Question makeQuestion(List<Card> pool, List<Card> source) {
        Card correct = Rand.pick(source != null && !source.isEmpty() ? source : pool);
        List<Card> sameCat = pool.stream().filter(d -> d.cat().equals(correct.cat()) && !d.key().equals(correct.key())).toList();
        List<Card> distractPool = sameCat.size() >= 3 ? sameCat : pool.stream().filter(d -> !d.key().equals(correct.key())).toList();
        List<Card> opts = new ArrayList<>(Rand.shuffle(distractPool).subList(0, Math.min(3, distractPool.size())));
        opts.add(correct);
        return new Question(correct, Rand.shuffle(opts));
    }

    private void resetRound() {
        asked.clear();
        q = makeQuestion(pool, null);
        if (noRepeat) {
            asked.add(q.correct().key());
        }
        picked = null;
        done = false;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("tooFew", pool.size() < 4);
        v.put("done", done);
        v.put("score", Map.of("right", right, "total", total));
        long[] all = progress.allTime(ctx);
        v.put("allTime", Map.of("right", all[0], "total", all[1]));
        v.put("noRepeat", noRepeat);
        v.put("asked", asked.size());
        v.put("poolSize", pool.size());
        v.put("saved", saved);
        if (sessions == null) {
            sessions = progress.sessions(ctx);
        }
        v.put("sessions", sessions);
        if (q != null && !done) {
            v.put("card", q.correct().view());
            v.put("prompt", q.correct().prompt(direction));
            v.put("direction", direction);
            List<Map<String, Object>> options = new ArrayList<>();
            for (Card o : q.options()) {
                options.add(Map.of("key", o.key(), "text", o.answer(direction)));
            }
            v.put("options", options);
            v.put("picked", picked);
            v.put("correctKey", picked == null ? null : q.correct().key());
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "answer" -> {
                if (q == null || picked != null || done) {
                    return;
                }
                String key = Drill.str(payload, "key");
                if (q.options().stream().noneMatch(o -> o.key().equals(key))) {
                    return;
                }
                picked = key;
                boolean correct = key.equals(q.correct().key());
                right += correct ? 1 : 0;
                total += 1;
                saved = false;
                progress.recordResult(ctx, q.correct(), correct, true);
            }
            case "next" -> {
                if (q == null) {
                    return;
                }
                if (noRepeat) {
                    List<Card> remaining = pool.stream().filter(d -> !asked.contains(d.key())).toList();
                    if (remaining.isEmpty()) {
                        done = true;
                        picked = null;
                        return;
                    }
                    q = makeQuestion(pool, remaining);
                    asked.add(q.correct().key());
                } else {
                    q = makeQuestion(pool, null);
                }
                picked = null;
            }
            case "finish" -> {
                if (total == 0) {
                    return;
                }
                progress.addSession(ctx, right, total, cats);
                sessions = null;
                saved = true;
                right = 0;
                total = 0;
            }
            case "restart" -> {
                if (pool.size() >= 4) {
                    resetRound();
                }
            }
            case "clearHistory" -> {
                progress.clearSessions(ctx);
                sessions = List.of();
            }
            default -> throw Drill.unknown(action);
        }
    }
}
