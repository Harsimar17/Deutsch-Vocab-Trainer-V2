package com.harsimar.vocab.drill;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.harsimar.vocab.cards.Card;
import com.harsimar.vocab.progress.Ctx;
import com.harsimar.vocab.progress.ProgressService;
import com.harsimar.vocab.util.Rand;

/** Cards: flip cards in a shuffled order; "✗ review this" / "✓ knew it" record the result. */
class FlashDrill implements Drill {

    private final List<Card> pool;
    private final String direction;
    private final boolean noRepeat;
    private final ProgressService progress;
    private List<Card> order;
    private int idx;
    private boolean done;

    FlashDrill(List<Card> pool, String direction, boolean noRepeat, ProgressService progress) {
        this.pool = pool;
        this.direction = direction;
        this.noRepeat = noRepeat;
        this.progress = progress;
        this.order = Rand.shuffle(pool);
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("empty", pool.isEmpty());
        v.put("done", done);
        v.put("noRepeat", noRepeat);
        v.put("position", idx + 1);
        v.put("total", order.size());
        if (!pool.isEmpty() && !done) {
            Card c = order.get(idx);
            v.put("card", c.view());
            v.put("front", c.prompt(direction));
            v.put("back", c.answer(direction));
            v.put("direction", direction);
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        if (pool.isEmpty()) {
            return;
        }
        switch (action) {
            case "next" -> next();
            case "prev" -> idx = (idx - 1 + order.size()) % order.size();
            case "shuffle" -> {
                order = Rand.shuffle(pool);
                idx = 0;
            }
            case "restart" -> {
                order = Rand.shuffle(pool);
                idx = 0;
                done = false;
            }
            case "knew", "review" -> {
                if (!done) {
                    progress.recordResult(ctx, order.get(idx), "knew".equals(action), false);
                    next();
                }
            }
            default -> throw Drill.unknown(action);
        }
    }

    private void next() {
        if (done) {
            return;
        }
        if (idx + 1 >= order.size()) {
            if (noRepeat) {
                done = true;
            } else {
                idx = 0;
            }
        } else {
            idx++;
        }
    }
}
