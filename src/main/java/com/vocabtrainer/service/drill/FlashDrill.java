package com.vocabtrainer.service.drill;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.util.Rand;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Cards: the whole shuffled deck is handed to the page in one view, so flipping,
 * moving and shuffling happen in the browser without a call. The "✗ review this"
 * / "✓ knew it" marks are collected there and sent back in one "results" action.
 */
class FlashDrill implements Drill {

    static final int MAX_RESULTS = 500;

    private final List<Card> deck;
    private final Map<String, Card> byKey;
    private final String direction;
    private final boolean noRepeat;
    private final ProgressService progress;

    FlashDrill(List<Card> pool, String direction, boolean noRepeat, ProgressService progress) {
        this.deck = Rand.shuffle(pool);
        this.byKey = pool.stream().collect(Collectors.toMap(Card::key, Function.identity(), (a, b) -> a));
        this.direction = direction;
        this.noRepeat = noRepeat;
        this.progress = progress;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("empty", deck.isEmpty());
        v.put("noRepeat", noRepeat);
        v.put("direction", direction);
        v.put("cards", deck.stream().map(Card::view).toList());
        return v;
    }

    /** "results" {results: [{key, knew}, …]}: records each mark in the order it was given. */
    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        if (!"results".equals(action)) {
            throw Drill.unknown(action);
        }
        if (!(payload.get("results") instanceof List<?> results) || results.size() > MAX_RESULTS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "results must be a list of at most " + MAX_RESULTS);
        }
        for (Object r : results) {
            if (r instanceof Map<?, ?> m && byKey.get(String.valueOf(m.get("key"))) instanceof Card card) {
                progress.recordResult(ctx, card, Boolean.TRUE.equals(m.get("knew")), false);
            }
        }
    }
}
