package com.vocabtrainer.drill;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.cards.German;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressService;
import com.vocabtrainer.progress.Srs;

/** Write: the English is shown; type the German. Graded leniently (case, umlaut spelling, punctuation). */
class WriteDrill implements Drill {

    private final List<Card> pool;
    private final String focus;
    private final ProgressService progress;
    private List<Card> queue;
    private int i;
    private German.Check res;
    private int typed;

    WriteDrill(Ctx ctx, List<Card> pool, String focus, ProgressService progress) {
        this.pool = pool;
        this.focus = focus;
        this.progress = progress;
        newRound(ctx);
    }

    private void newRound(Ctx ctx) {
        queue = Srs.queue(pool, progress.srs(ctx), progress.daily(ctx), focus, ctx.today(), System.currentTimeMillis());
        i = 0;
        res = null;
        typed = 0;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        if (pool.isEmpty()) {
            v.put("state", "noCategories");
        } else if (queue.isEmpty()) {
            v.put("state", "nothingDue");
        } else if (i >= queue.size()) {
            v.put("state", "roundDone");
            v.put("typed", typed);
        } else {
            Card card = queue.get(i);
            v.put("state", "card");
            v.put("position", i + 1);
            v.put("total", queue.size());
            v.put("en", card.en());
            v.put("cat", card.cat());
            v.put("isNoun", card.isNoun());
            if (res != null) {
                v.put("verdict", res.verdict());
                v.put("spelled", res.spelled());
                v.put("hint", res.hint());
                v.put("forms", String.join("  /  ", German.acceptedDe(card)));
                v.put("card", card.view());
            }
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "check" -> {
                if (i >= queue.size() || res != null) {
                    return;
                }
                Card card = queue.get(i);
                German.Check r = German.checkDe(card, Drill.str(payload, "input"));
                if ("empty".equals(r.verdict())) {
                    return;
                }
                res = r;
                progress.grade(ctx, card, r.correct() ? "good" : "again");
                typed++;
            }
            case "next" -> {
                if (res != null) {
                    res = null;
                    i++;
                }
            }
            case "keepGoing" -> newRound(ctx);
            default -> throw Drill.unknown(action);
        }
    }
}
