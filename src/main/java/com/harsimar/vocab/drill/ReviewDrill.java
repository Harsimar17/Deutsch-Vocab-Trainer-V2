package com.harsimar.vocab.drill;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.harsimar.vocab.cards.Card;
import com.harsimar.vocab.cards.CardCatalog;
import com.harsimar.vocab.progress.Ctx;
import com.harsimar.vocab.progress.ProgressService;
import com.harsimar.vocab.util.Rand;

/**
 * Review: re-test the words on the Review list (missed anywhere, or flagged on
 * a card). Words leave the list only when the learner takes them off. Ignores
 * the level/category filters so a mistake never silently disappears.
 */
class ReviewDrill implements Drill {

    private final CardCatalog catalog;
    private final String direction;
    private final ProgressService progress;
    private List<Card> queue = List.of();
    private int pos;
    private String picked;
    private List<Card> options = List.of();
    private final Map<String, Boolean> results = new HashMap<>();

    ReviewDrill(Ctx ctx, CardCatalog catalog, String direction, ProgressService progress) {
        this.catalog = catalog;
        this.direction = direction;
        this.progress = progress;
        startRound(ctx, null);
    }

    private List<Card> listed(Ctx ctx) {
        List<Card> out = new ArrayList<>();
        progress.mistakes(ctx).keySet().forEach(k -> {
            Card c = catalog.card(k);
            if (c != null) {
                out.add(c);
            }
        });
        return out;
    }

    private void startRound(Ctx ctx, List<Card> only) {
        queue = Rand.shuffle(only != null && !only.isEmpty() ? only : listed(ctx));
        pos = 0;
        picked = null;
        results.clear();
        makeOptions();
    }

    private void makeOptions() {
        if (pos >= queue.size()) {
            options = List.of();
            return;
        }
        Card card = queue.get(pos);
        List<Card> all = catalog.cards();
        List<Card> sameCat = all.stream().filter(d -> d.cat().equals(card.cat()) && !d.key().equals(card.key())).toList();
        List<Card> distract = sameCat.size() >= 3 ? sameCat : all.stream().filter(d -> !d.key().equals(card.key())).toList();
        List<Card> opts = new ArrayList<>(Rand.shuffle(distract).subList(0, Math.min(3, distract.size())));
        opts.add(card);
        options = Rand.shuffle(opts);
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Map<String, Object>> mistakes = progress.mistakes(ctx);
        int total = listed(ctx).size();
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("total", total);
        v.put("direction", direction);
        if (pos >= queue.size()) {
            v.put("done", true);
            v.put("answered", results.size());
            v.put("gotRight", results.values().stream().filter(b -> b).count());
            v.put("missedThisRound", missedThisRound(mistakes).size());
            return v;
        }
        Card card = queue.get(pos);
        Map<String, Object> info = mistakes.get(card.key());
        v.put("done", false);
        v.put("position", pos + 1);
        v.put("queueSize", queue.size());
        v.put("card", card.view());
        v.put("prompt", card.prompt(direction));
        v.put("wrong", info == null ? 0 : info.getOrDefault("wrong", 0));
        v.put("right", info == null ? 0 : info.getOrDefault("right", 0));
        List<Map<String, Object>> opts = new ArrayList<>();
        for (Card o : options) {
            opts.add(Map.of("key", o.key(), "text", o.answer(direction)));
        }
        v.put("options", opts);
        v.put("picked", picked);
        v.put("correctKey", picked == null ? null : card.key());
        return v;
    }

    private List<Card> missedThisRound(Map<String, Map<String, Object>> mistakes) {
        return queue.stream().filter(c -> Boolean.FALSE.equals(results.get(c.key())) && mistakes.containsKey(c.key())).toList();
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "answer" -> {
                String key = Drill.str(payload, "key");
                if (pos >= queue.size() || picked != null || options.stream().noneMatch(o -> o.key().equals(key))) {
                    return;
                }
                Card card = queue.get(pos);
                picked = key;
                boolean correct = key.equals(card.key());
                results.put(card.key(), correct);
                progress.recordResult(ctx, card, correct, false);
            }
            case "next" -> next();
            case "remove" -> { // "✓ I know this — take it off the list"
                if (pos < queue.size()) {
                    progress.removeMistake(ctx, queue.get(pos).key());
                    next();
                }
            }
            case "redoMissed" -> startRound(ctx, missedThisRound(progress.mistakes(ctx)));
            case "reviewAll", "reshuffle" -> startRound(ctx, null);
            case "clearAll" -> {
                progress.clearMistakes(ctx);
                startRound(ctx, null);
            }
            default -> throw Drill.unknown(action);
        }
    }

    private void next() {
        picked = null;
        pos++;
        makeOptions();
    }
}
