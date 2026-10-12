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
 * order. A round goes through every word and verb of the phase once, one of its
 * sentences each; afterwards the missed words can be asked again
 * ("retryMissed", with another of their sentences where there is one). After
 * checking, a note shows how the word is used. Every checked sentence counts
 * for its word, graded like the Phasentest grades it.
 */
class SentenceDrill implements Drill {

    static final int EXTRA_TILES = 2;

    private record Item(Sentence sentence, List<String> tiles) {
    }

    private final String phase;
    private final ProgressService progress;
    private final List<Sentence> pool;
    private final Map<String, List<Sentence>> byWord = new LinkedHashMap<>();
    private List<Item> items;
    private final List<String> missed = new ArrayList<>();
    private boolean retry;
    private int idx;
    private int right;
    private String verdict;

    SentenceDrill(String phase, List<Sentence> pool, ProgressService progress) {
        this.phase = phase;
        this.pool = pool;
        this.progress = progress;
        pool.forEach(s -> byWord.computeIfAbsent(s.card().de(), k -> new ArrayList<>()).add(s));
        start(new ArrayList<>(byWord.keySet()), false);
    }

    /** A round over these words, in random order, one random sentence each (not the one asked last time). */
    private void start(List<String> words, boolean retry) {
        Set<String> lastSeen = new HashSet<>();
        if (items != null) {
            items.forEach(it -> lastSeen.add(it.sentence().de()));
        }
        List<Item> round = new ArrayList<>();
        for (String w : Rand.shuffle(words)) {
            List<Sentence> options = byWord.get(w);
            List<Sentence> fresh = options.stream().filter(s -> !lastSeen.contains(s.de())).toList();
            Sentence s = Rand.pick(fresh.isEmpty() ? options : fresh);
            List<String> tiles = new ArrayList<>(s.words());
            tiles.addAll(extraTiles(s, pool));
            round.add(new Item(s, Rand.shuffle(tiles)));
        }
        items = round;
        this.retry = retry;
        missed.clear();
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
        v.put("words", byWord.size());
        v.put("sentences", pool.size());
        v.put("retry", retry);
        v.put("empty", items.isEmpty());
        v.put("done", !items.isEmpty() && idx >= items.size());
        v.put("right", right);
        v.put("missed", missed.size());
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
                } else {
                    missed.add(s.card().de());
                }
                progress.grade(ctx, s.card(), ok ? "good" : "again");
            }
            case "skip" -> {
                if (idx < items.size() && verdict == null) {
                    verdict = "skipped";
                    missed.add(items.get(idx).sentence().card().de());
                }
            }
            case "next" -> {
                if (verdict != null) {
                    verdict = null;
                    idx++;
                }
            }
            case "retryMissed" -> {
                if (idx >= items.size() && !missed.isEmpty()) {
                    start(new ArrayList<>(missed), true);
                }
            }
            case "restart" -> start(new ArrayList<>(byWord.keySet()), false);
            default -> throw Drill.unknown(action);
        }
    }
}
