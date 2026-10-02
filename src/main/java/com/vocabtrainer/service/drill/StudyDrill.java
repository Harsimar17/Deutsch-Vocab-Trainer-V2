package com.vocabtrainer.service.drill;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.service.Srs;

/**
 * Study: spaced repetition. Serves what's due plus today's new words; "again"
 * brings the card back at the end of the round; every 5th graded card pauses
 * for a "say it out loud" sentence.
 */
class StudyDrill implements Drill {

    private static final Set<String> GRADES = Set.of("again", "good", "easy");

    private final List<Card> pool;
    private final String focus;
    private final String direction;
    private final ProgressService progress;
    private List<Card> queue;
    private int i;
    private int graded;
    private Card sentenceBreak;

    StudyDrill(Ctx ctx, List<Card> pool, String focus, String direction, ProgressService progress) {
        this.pool = pool;
        this.focus = focus;
        this.direction = direction;
        this.progress = progress;
        newRound(ctx);
    }

    private void newRound(Ctx ctx) {
        queue = new ArrayList<>(Srs.queue(pool, progress.srs(ctx), progress.daily(ctx), focus, ctx.today(), System.currentTimeMillis()));
        i = 0;
        graded = 0;
        sentenceBreak = null;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("focus", focus);
        v.put("direction", direction);
        if (pool.isEmpty()) {
            v.put("state", "noCategories");
        } else if (queue.isEmpty()) {
            v.put("state", "trouble".equals(focus) ? "noTrouble" : "caughtUp");
            v.put("troubleLapses", Srs.TROUBLE_LAPSES);
            v.put("newPerDay", Srs.NEW_PER_DAY);
        } else if (i >= queue.size()) {
            v.put("state", "roundDone");
            v.put("graded", graded);
        } else if (sentenceBreak != null) {
            v.put("state", "sentenceBreak");
            v.put("card", sentenceBreak.view());
        } else {
            Card card = queue.get(i);
            v.put("state", "card");
            v.put("card", card.view());
            v.put("front", card.prompt(direction));
            v.put("back", card.answer(direction));
            v.put("isNew", !progress.srs(ctx).containsKey(card.key()));
            v.put("position", i + 1);
            v.put("total", queue.size());
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "grade" -> {
                String g = Drill.str(payload, "grade");
                if (!GRADES.contains(g) || sentenceBreak != null || i >= queue.size()) {
                    return;
                }
                Card card = queue.get(i);
                progress.grade(ctx, card, g);
                graded++;
                if ("again".equals(g)) {
                    queue.add(card); // see it again before the round ends
                    i++;
                } else if (graded % 5 == 0) {
                    sentenceBreak = card;
                } else {
                    i++;
                }
            }
            case "continue" -> {
                if (sentenceBreak != null) {
                    sentenceBreak = null;
                    i++;
                }
            }
            case "keepGoing" -> newRound(ctx);
            default -> throw Drill.unknown(action);
        }
    }
}
