package com.vocabtrainer.service.drill;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.German;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.service.SentencePracticeService.Sentence;
import com.vocabtrainer.util.Rand;

/**
 * The Phasentest's Sentences tab, like Duolingo: the English sentence on top,
 * the German words as tiles (plus {@value #EXTRA_TILES} wrong ones) to tap into
 * order, for the phase's words and verbs — one sentence per word in a round.
 * After checking, a note shows how the word is used. Every checked sentence
 * counts for its word, graded like the Phasentest grades it.
 */
class SentenceDrill implements Drill {

    static final int ROUND = 6;
    static final int EXTRA_TILES = 2;

    private record Item(Sentence sentence, List<String> tiles) {
    }

    private final String phase;
    private final ProgressService progress;
    private final List<Sentence> pool;
    private final int wordCount;
    private List<Item> items;
    private int idx;
    private int right;
    private String verdict;

    SentenceDrill(String phase, List<Sentence> pool, ProgressService progress) {
        this.phase = phase;
        this.pool = pool;
        this.progress = progress;
        this.wordCount = (int) pool.stream().map(s -> s.card().de()).distinct().count();
        newRound();
    }

    private void newRound() {
        List<Item> round = new ArrayList<>();
        Set<String> words = new HashSet<>();
        for (Sentence s : Rand.shuffle(pool)) {
            if (round.size() == ROUND) {
                break;
            }
            if (!words.add(s.card().de())) {
                continue; // one sentence per word in a round
            }
            List<String> tiles = new ArrayList<>(s.words());
            tiles.addAll(extraTiles(s, pool));
            round.add(new Item(s, Rand.shuffle(tiles)));
        }
        items = round;
        idx = 0;
        right = 0;
        verdict = null;
    }

    /** Words from other sentences that don't appear in this one. */
    private static List<String> extraTiles(Sentence s, List<Sentence> all) {
        Set<String> own = new HashSet<>();
        s.words().forEach(w -> own.add(German.lower(w)));
        List<String> out = new ArrayList<>();
        for (Sentence other : Rand.shuffle(all)) {
            String w = Rand.pick(other.words());
            if (own.add(German.lower(w))) {
                out.add(w);
            }
            if (out.size() == EXTRA_TILES) {
                break;
            }
        }
        return out;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("phase", phase);
        v.put("words", wordCount);
        v.put("sentences", pool.size());
        v.put("empty", items.isEmpty());
        v.put("done", !items.isEmpty() && idx >= items.size());
        v.put("right", right);
        v.put("total", items.size());
        v.put("position", Math.min(idx + 1, items.size()));
        if (idx < items.size()) {
            Item it = items.get(idx);
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("word", it.sentence().card().de());
            item.put("meaning", it.sentence().card().en());
            item.put("en", it.sentence().en());
            item.put("tiles", it.tiles());
            v.put("item", item);
            if (verdict != null) {
                v.put("verdict", verdict);
                v.put("answer", Map.of("de", it.sentence().de(), "en", it.sentence().en(), "use", it.sentence().use()));
            }
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "check" -> {
                if (idx >= items.size() || verdict != null) {
                    return;
                }
                Sentence s = items.get(idx).sentence();
                boolean ok = payload.get("words") instanceof List<?> given
                        && given.stream().map(String::valueOf).toList().equals(s.words());
                verdict = ok ? "correct" : "wrong";
                if (ok) {
                    right++;
                }
                progress.grade(ctx, s.card(), ok ? "good" : "again");
            }
            case "skip" -> {
                if (idx < items.size() && verdict == null) {
                    verdict = "skipped";
                }
            }
            case "next" -> {
                if (verdict != null) {
                    verdict = null;
                    idx++;
                }
            }
            case "restart" -> newRound();
            default -> throw Drill.unknown(action);
        }
    }
}
