package com.vocabtrainer.service.drill;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.PhaseTestService;
import com.vocabtrainer.service.Srs;
import com.vocabtrainer.service.StoryService.PhaseWord;
import com.vocabtrainer.util.Rand;

/**
 * One Phasentest round. Each word is first recognised (DE→EN: pick the meaning
 * out of 4) and later in the round produced (EN→DE: pick the German word out
 * of 4). Only a correct FIRST attempt counts toward mastery; a miss comes back
 * a few items later (no credit) until it's right. Distractors never share the
 * asked word's meaning, so exactly one option is right.
 */
class PhaseDrill implements Drill {

    private static final class Item {
        final PhaseWord w;
        final String dir; // "de-en" | "en-de"
        final int id;
        final boolean relearn;

        Item(PhaseWord w, String dir, int id, boolean relearn) {
            this.w = w;
            this.dir = dir;
            this.id = id;
            this.relearn = relearn;
        }
    }

    private final String phase;    // the phase, e.g. "2"
    private final String set;      // "words" | "verbs"
    private final String idx;      // where progress is saved, e.g. "2" or "2-verbs"
    private final boolean refresh;
    private final List<PhaseWord> words;
    private final List<PhaseWord> optionPool;
    private final PhaseTestService tests;
    private final List<Item> queue;
    private int pos;
    private int seq = 1000;
    // the current question
    private List<PhaseWord> options;
    private Map<String, Object> answer; // what happened, for the view
    // round results
    private int first;
    private int right;
    private Map<String, Object> finished;

    PhaseDrill(Ctx ctx, String phase, String set, boolean refresh, PhaseTestService tests) {
        this.phase = phase;
        this.set = set;
        this.idx = PhaseTestService.storageKey(phase, set);
        this.refresh = refresh;
        this.tests = tests;
        this.words = tests.phaseWords(phase, set);
        this.optionPool = tests.optionPool(phase, set);
        this.queue = buildRound(words, PhaseTestService.words(tests.state(ctx, idx)), refresh);
        prepare();
    }

    static List<Item> buildRound(List<PhaseWord> words, Map<String, Map<String, Object>> ws, boolean refresh) {
        List<PhaseWord> pick;
        if (refresh) {
            List<PhaseWord> s = new ArrayList<>(Rand.shuffle(words));
            s.sort(Comparator.comparingLong(w -> -miss(ws.get(w.card().de())))); // weakest first
            pick = s.subList(0, Math.min(PhaseTestService.REFRESH_WORDS, s.size()));
        } else {
            // words in progress come back first (that's the spacing), topped up with new ones
            List<PhaseWord> open = words.stream().filter(w -> !PhaseTestService.mastered(ws.get(w.card().de()))).toList();
            List<PhaseWord> started = Rand.shuffle(open.stream().filter(w -> ws.containsKey(w.card().de())).toList());
            List<PhaseWord> fresh = open.stream().filter(w -> !ws.containsKey(w.card().de())).toList();
            pick = new ArrayList<>(started.subList(0, Math.min(8, started.size())));
            pick.addAll(fresh.subList(0, Math.min(PhaseTestService.ROUND_WORDS - pick.size(), fresh.size())));
            if (pick.size() < PhaseTestService.ROUND_WORDS && started.size() > 8) {
                pick.addAll(started.subList(8, Math.min(started.size(), 8 + PhaseTestService.ROUND_WORDS - pick.size())));
            }
        }
        // all recognition first, then production — each word is seen DE→EN before it must be produced
        List<PhaseWord> rec = new ArrayList<>();
        List<PhaseWord> prod = new ArrayList<>();
        for (PhaseWord w : pick) {
            Map<String, Object> s = ws.getOrDefault(w.card().de(), Map.of());
            if (refresh || Srs.num(s.get("r"), 0) < PhaseTestService.MASTER) {
                rec.add(w);
            }
            if (refresh || Srs.num(s.get("p"), 0) < PhaseTestService.MASTER) {
                prod.add(w);
            }
        }
        List<Item> items = new ArrayList<>();
        int id = 1;
        for (PhaseWord w : Rand.shuffle(rec)) {
            items.add(new Item(w, "de-en", id++, false));
        }
        for (PhaseWord w : Rand.shuffle(prod)) {
            items.add(new Item(w, "en-de", id++, false));
        }
        return items;
    }

    private static long miss(Map<String, Object> s) {
        return s == null ? 0 : Srs.num(s.get("miss"), 0);
    }

    /** Distractors of the same kind (nouns with nouns, verbs with verbs …) from the given pool. */
    static List<PhaseWord> options(PhaseWord word, List<PhaseWord> words) {
        Card c = word.card();
        List<PhaseWord> others = words.stream()
                .filter(w -> !w.card().de().equals(c.de()) && !w.card().en().equals(c.en())).toList();
        List<PhaseWord> same = others.stream().filter(w -> w.card().isNoun() == c.isNoun()
                && (c.isNoun() || w.type().equals(word.type()))).toList();
        List<PhaseWord> src = same.size() >= 3 ? same : others;
        List<PhaseWord> opts = new ArrayList<>(Rand.shuffle(src).subList(0, Math.min(3, src.size())));
        opts.add(word);
        return Rand.shuffle(opts);
    }

    private Item item() {
        return finished == null && pos < queue.size() ? queue.get(pos) : null;
    }

    /** Per-question setup: the four choices (same for both directions, shown in the other language). */
    private void prepare() {
        Item it = item();
        answer = null;
        if (it == null) {
            return;
        }
        options = options(it.w, optionPool);
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> st = tests.state(ctx, idx);
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("phase", phase);
        v.put("set", set);
        v.put("refresh", refresh);
        v.put("status", PhaseTestService.status(words, st));
        if (finished != null) {
            v.put("state", "finished");
            v.putAll(finished);
            v.put("first", first);
            v.put("right", right);
            return v;
        }
        Item it = item();
        Card c = it.w.card();
        boolean deEn = "de-en".equals(it.dir);
        v.put("state", "question");
        v.put("dir", it.dir);
        v.put("relearn", it.relearn);
        v.put("position", pos + 1);
        v.put("total", queue.size());
        v.put("cat", c.cat());
        v.put("typeLabel", PhaseTestService.TYPE_LABEL.getOrDefault(it.w.type(), it.w.type()));
        v.put("chapter", it.w.chapter());
        v.put("prompt", deEn ? c.de() : c.en());
        List<Map<String, Object>> opts = new ArrayList<>();
        for (PhaseWord o : options) {
            opts.add(Map.of("key", o.card().de(), "text", deEn ? o.card().en() : o.card().de()));
        }
        v.put("options", opts);
        if (answer != null) {
            v.put("answer", answer);
            v.put("card", c.view()); // revealed only once answered
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        Item it = item();
        switch (action) {
            case "choose" -> {
                if (it == null || answer != null) {
                    return;
                }
                String key = Drill.str(payload, "key");
                if (options.stream().noneMatch(o -> o.card().de().equals(key))) {
                    return;
                }
                boolean correct = key.equals(it.w.card().de());
                answer = new LinkedHashMap<>(Map.of("correct", correct, "pick", key, "verdict", correct ? "correct" : "wrong"));
                record(ctx, it, correct);
            }
            case "next" -> {
                if (it == null || answer == null) {
                    return;
                }
                if (pos + 1 >= queue.size()) {
                    finishRound(ctx);
                } else {
                    pos++;
                    prepare();
                }
            }
            default -> throw Drill.unknown(action);
        }
    }

    private void record(Ctx ctx, Item it, boolean correct) {
        if (it.relearn) {
            if (!correct) {
                requeue(it);
            }
            return;
        }
        String key = it.w.card().de();
        String f = "de-en".equals(it.dir) ? "r" : "p";
        Map<String, Object> st = new LinkedHashMap<>(tests.state(ctx, idx));
        Map<String, Map<String, Object>> ws = PhaseTestService.words(st);
        Map<String, Object> cur = withDefaults(ws.get(key));
        if (correct) {
            cur.put(f, Math.min(PhaseTestService.MASTER, Srs.num(cur.get(f), 0) + 1));
        } else {
            cur.put(f, 0L);
            cur.put("miss", Srs.num(cur.get("miss"), 0) + 1);
        }
        saveWord(ctx, st, ws, key, cur);
        first++;
        right += correct ? 1 : 0;
        if (!correct) {
            tests.progress().grade(ctx, it.w.card(), "again");
            requeue(it);
        } else if ("en-de".equals(it.dir)) {
            tests.progress().grade(ctx, it.w.card(), "good");
        }
    }

    /** Puts a missed item back a few places later (relearning within the round). */
    private void requeue(Item it) {
        queue.add(Math.min(pos + 4, queue.size()), new Item(it.w, it.dir, ++seq, true));
    }

    private void saveWord(Ctx ctx, Map<String, Object> st, Map<String, Map<String, Object>> ws, String key, Map<String, Object> cur) {
        Map<String, Object> nextWords = new LinkedHashMap<>(ws);
        nextWords.put(key, cur);
        st.put("words", nextWords);
        tests.save(ctx, idx, st);
    }

    private static Map<String, Object> withDefaults(Map<String, Object> prev) {
        Map<String, Object> cur = new LinkedHashMap<>(Map.of("r", 0L, "p", 0L, "miss", 0L));
        if (prev != null) {
            cur.putAll(prev);
        }
        return cur;
    }

    private void finishRound(Ctx ctx) {
        long now = System.currentTimeMillis();
        Map<String, Object> st = new LinkedHashMap<>(tests.state(ctx, idx));
        boolean passedNow = false;
        if (refresh) {
            int stage = (int) Math.min(Srs.num(st.get("stage"), 0) + 1, PhaseTestService.REFRESH_DAYS.length - 1);
            st.put("stage", stage);
            st.put("due", now + PhaseTestService.REFRESH_DAYS[stage] * Srs.DAY_MS);
            tests.save(ctx, idx, st);
        } else if (st.get("passed") == null) {
            Map<String, Map<String, Object>> ws = PhaseTestService.words(st);
            if (words.stream().allMatch(w -> PhaseTestService.mastered(ws.get(w.card().de())))) {
                passedNow = true;
                st.put("passed", now);
                st.put("stage", 0);
                st.put("due", now + PhaseTestService.REFRESH_DAYS[0] * Srs.DAY_MS);
                tests.save(ctx, idx, st);
            }
        }
        finished = new LinkedHashMap<>(Map.of("passedNow", passedNow));
    }
}
