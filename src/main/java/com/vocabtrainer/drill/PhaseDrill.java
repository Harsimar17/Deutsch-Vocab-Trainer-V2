package com.vocabtrainer.drill;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.cards.German;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.Srs;
import com.vocabtrainer.stories.PhaseTests;
import com.vocabtrainer.stories.StoryService.PhaseWord;
import com.vocabtrainer.util.Rand;

/**
 * One Phasentest round. Each word is first recognised (DE→EN, 4 choices) and
 * later in the round produced (EN→DE, typed). Only a correct FIRST attempt
 * counts toward mastery; a miss comes back a few items later (no credit) until
 * it's right. Hints and synonyms neither earn nor cost credit.
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

    private record Undo(String key, Map<String, Object> prev, String field, int relearnId) {
    }

    private final String idx;
    private final boolean refresh;
    private final List<PhaseWord> words;
    private final PhaseTests tests;
    private final List<Item> queue;
    private int pos;
    private int seq = 1000;
    // the current question
    private List<PhaseWord> options;
    private List<PhaseWord> synonyms;
    private boolean hint;
    private Map<String, Object> answer; // what happened, for the view
    private Undo undo;
    // round results
    private int first;
    private int right;
    private Map<String, Object> finished;

    PhaseDrill(Ctx ctx, String idx, boolean refresh, PhaseTests tests) {
        this.idx = idx;
        this.refresh = refresh;
        this.tests = tests;
        this.words = tests.phaseWords(idx);
        this.queue = buildRound(words, PhaseTests.words(tests.state(ctx, idx)), refresh);
        prepare();
    }

    static List<Item> buildRound(List<PhaseWord> words, Map<String, Map<String, Object>> ws, boolean refresh) {
        List<PhaseWord> pick;
        if (refresh) {
            List<PhaseWord> s = new ArrayList<>(Rand.shuffle(words));
            s.sort(Comparator.comparingLong(w -> -miss(ws.get(w.card().de())))); // weakest first
            pick = s.subList(0, Math.min(PhaseTests.REFRESH_WORDS, s.size()));
        } else {
            // words in progress come back first (that's the spacing), topped up with new ones
            List<PhaseWord> open = words.stream().filter(w -> !PhaseTests.mastered(ws.get(w.card().de()))).toList();
            List<PhaseWord> started = Rand.shuffle(open.stream().filter(w -> ws.containsKey(w.card().de())).toList());
            List<PhaseWord> fresh = open.stream().filter(w -> !ws.containsKey(w.card().de())).toList();
            pick = new ArrayList<>(started.subList(0, Math.min(8, started.size())));
            pick.addAll(fresh.subList(0, Math.min(PhaseTests.ROUND_WORDS - pick.size(), fresh.size())));
            if (pick.size() < PhaseTests.ROUND_WORDS && started.size() > 8) {
                pick.addAll(started.subList(8, Math.min(started.size(), 8 + PhaseTests.ROUND_WORDS - pick.size())));
            }
        }
        // all recognition first, then production — each word is seen DE→EN before it must be produced
        List<PhaseWord> rec = new ArrayList<>();
        List<PhaseWord> prod = new ArrayList<>();
        for (PhaseWord w : pick) {
            Map<String, Object> s = ws.getOrDefault(w.card().de(), Map.of());
            if (refresh || Srs.num(s.get("r"), 0) < PhaseTests.MASTER) {
                rec.add(w);
            }
            if (refresh || Srs.num(s.get("p"), 0) < PhaseTests.MASTER) {
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

    /** Distractors of the same kind (nouns with nouns, verbs with verbs …) from this phase. */
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

    /** Per-question setup: options for recognition, same-meaning words for production. */
    private void prepare() {
        Item it = item();
        hint = false;
        answer = null;
        undo = null;
        if (it == null) {
            return;
        }
        options = "de-en".equals(it.dir) ? options(it.w, words) : List.of();
        String en = it.w.card().en().toLowerCase();
        synonyms = words.stream().filter(o -> !o.card().de().equals(it.w.card().de()) && o.card().en().toLowerCase().equals(en)).toList();
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        List<PhaseWord> all = words;
        Map<String, Object> st = tests.state(ctx, idx);
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("phase", idx);
        v.put("refresh", refresh);
        v.put("status", PhaseTests.status(all, st));
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
        v.put("typeLabel", PhaseTests.TYPE_LABEL.getOrDefault(it.w.type(), it.w.type()));
        v.put("chapter", it.w.chapter());
        if (deEn) {
            v.put("prompt", c.de());
            List<Map<String, Object>> opts = new ArrayList<>();
            for (PhaseWord o : options) {
                opts.add(Map.of("key", o.card().de(), "text", o.card().en()));
            }
            v.put("options", opts);
        } else {
            v.put("prompt", c.en());
            v.put("isNoun", c.isNoun());
            v.put("synonyms", synonyms.size());
            v.put("startsWith", firstTwo(German.ptBare(c)));
            if (hint) {
                v.put("hint", Map.of("startsWith", firstTwo(German.ptBare(c)),
                        "cloze", java.util.Objects.toString(German.ptCloze(c, it.w.type()), "")));
            }
        }
        if (answer != null) {
            v.put("answer", answer);
            v.put("card", c.view()); // revealed only once answered
            v.put("canOverrule", undo != null && !deEn && !it.relearn);
        }
        return v;
    }

    private static String firstTwo(String s) {
        return s.substring(0, Math.min(2, s.length()));
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        Item it = item();
        switch (action) {
            case "choose" -> {
                if (it == null || answer != null || !"de-en".equals(it.dir)) {
                    return;
                }
                String key = Drill.str(payload, "key");
                if (options.stream().noneMatch(o -> o.card().de().equals(key))) {
                    return;
                }
                boolean correct = key.equals(it.w.card().de());
                answer = new LinkedHashMap<>(Map.of("correct", correct, "pick", key, "verdict", correct ? "correct" : "wrong"));
                record(ctx, it, correct, false);
            }
            case "hint" -> {
                if (it != null && answer == null && "en-de".equals(it.dir)) {
                    hint = true;
                }
            }
            case "check" -> {
                if (it == null || answer != null || !"en-de".equals(it.dir)) {
                    return;
                }
                String input = Drill.str(payload, "input");
                German.Check res = German.ptCheck(it.w.card(), input);
                if ("empty".equals(res.verdict())) {
                    return;
                }
                String verdict = res.verdict();
                String other = null;
                if (!res.correct()) {
                    // a same-meaning word of this phase is a right translation: no penalty, no credit
                    for (PhaseWord o : synonyms) {
                        if (German.ptCheck(o.card(), input).correct()) {
                            verdict = "synonym";
                            other = o.card().de();
                            break;
                        }
                    }
                }
                boolean correct = res.correct() || "synonym".equals(verdict);
                boolean hinted = hint || "synonym".equals(verdict);
                answer = new LinkedHashMap<>();
                answer.put("correct", correct);
                answer.put("verdict", verdict);
                answer.put("hinted", hinted);
                answer.put("spelled", res.spelled());
                answer.put("hintText", res.hint());
                answer.put("other", other);
                record(ctx, it, correct, hinted);
            }
            case "overrule" -> overrule(ctx, it); // "ich hatte recht (Tippfehler)"
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

    private void record(Ctx ctx, Item it, boolean correct, boolean hinted) {
        if (it.relearn) {
            if (!correct) {
                requeue(it);
            }
            return;
        }
        String key = it.w.card().de();
        String f = "de-en".equals(it.dir) ? "r" : "p";
        Map<String, Object> st = new LinkedHashMap<>(tests.state(ctx, idx));
        Map<String, Map<String, Object>> ws = PhaseTests.words(st);
        Map<String, Object> prev = ws.get(key);
        Map<String, Object> cur = withDefaults(prev);
        if (correct && !hinted) {
            cur.put(f, Math.min(PhaseTests.MASTER, Srs.num(cur.get(f), 0) + 1));
        } else if (!correct) {
            cur.put(f, 0L);
            cur.put("miss", Srs.num(cur.get("miss"), 0) + 1);
        }
        saveWord(ctx, st, ws, key, cur);
        first++;
        right += correct && !hinted ? 1 : 0;
        if (!correct) {
            tests.progress().grade(ctx, it.w.card(), "again");
        } else if ("en-de".equals(it.dir) && !hinted) {
            tests.progress().grade(ctx, it.w.card(), "good");
        }
        undo = correct ? null : new Undo(key, prev, f, requeue(it));
    }

    /** Puts a missed item back a few places later (relearning within the round). */
    private int requeue(Item it) {
        int id = ++seq;
        queue.add(Math.min(pos + 4, queue.size()), new Item(it.w, it.dir, id, true));
        return id;
    }

    private void overrule(Ctx ctx, Item it) {
        if (undo == null || it == null) {
            return;
        }
        Map<String, Object> st = new LinkedHashMap<>(tests.state(ctx, idx));
        Map<String, Map<String, Object>> ws = PhaseTests.words(st);
        Map<String, Object> cur = withDefaults(undo.prev());
        cur.put(undo.field(), Math.min(PhaseTests.MASTER, Srs.num(cur.get(undo.field()), 0) + 1));
        saveWord(ctx, st, ws, undo.key(), cur);
        int relearnId = undo.relearnId();
        queue.removeIf(q -> q.id == relearnId);
        right++;
        tests.progress().grade(ctx, it.w.card(), "good");
        answer.put("correct", true);
        answer.put("overruled", true);
        undo = null;
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
            int stage = (int) Math.min(Srs.num(st.get("stage"), 0) + 1, PhaseTests.REFRESH_DAYS.length - 1);
            st.put("stage", stage);
            st.put("due", now + PhaseTests.REFRESH_DAYS[stage] * Srs.DAY_MS);
            tests.save(ctx, idx, st);
        } else if (st.get("passed") == null) {
            Map<String, Map<String, Object>> ws = PhaseTests.words(st);
            if (words.stream().allMatch(w -> PhaseTests.mastered(ws.get(w.card().de())))) {
                passedNow = true;
                st.put("passed", now);
                st.put("stage", 0);
                st.put("due", now + PhaseTests.REFRESH_DAYS[0] * Srs.DAY_MS);
                tests.save(ctx, idx, st);
            }
        }
        finished = new LinkedHashMap<>(Map.of("passedNow", passedNow));
    }
}
