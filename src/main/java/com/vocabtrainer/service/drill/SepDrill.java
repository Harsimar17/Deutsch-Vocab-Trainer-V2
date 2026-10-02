package com.vocabtrainer.service.drill;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.German;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.util.Rand;

/** Trennbare Verben: which prefix belongs in the gap at the end of the clause? */
class SepDrill implements Drill {

    private final List<Card> playable;
    private final ProgressService progress;
    private Card card;
    private String answer;
    private German.Cloze cloze;
    private List<String> options;
    private String picked;
    private long right;
    private long total;

    SepDrill(List<Card> pool, ProgressService progress) {
        this.playable = pool.stream().filter(d -> {
            if (!"sep".equals(d.cat())) {
                return false;
            }
            String prefix = German.sepParts(d).prefix();
            return !prefix.isEmpty() && German.sepCloze(d, prefix) != null;
        }).toList();
        this.progress = progress;
        if (playable.size() >= 4) {
            newQuestion(null);
        }
    }

    private void newQuestion(String avoidKey) {
        List<Card> src = playable.size() > 1 && avoidKey != null
                ? playable.stream().filter(d -> !d.key().equals(avoidKey)).toList() : playable;
        card = Rand.pick(src);
        answer = German.sepParts(card).prefix();
        cloze = German.sepCloze(card, answer);
        List<String> opts = new ArrayList<>(Rand.shuffle(German.SEP_COMMON.stream().filter(p -> !p.equals(answer)).toList()).subList(0, 3));
        opts.add(answer);
        options = Rand.shuffle(opts);
        picked = null;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("tooFew", playable.size() < 4);
        v.put("score", Map.of("right", right, "total", total));
        v.put("verbs", playable.size());
        if (card != null) {
            v.put("en", card.en());
            v.put("inf", German.sepParts(card).inf());
            v.put("before", cloze.before());
            v.put("after", cloze.after());
            v.put("gap", cloze.answer());
            v.put("options", options);
            v.put("picked", picked);
            v.put("answer", picked == null ? null : answer);
            v.put("sentence", (cloze.before() + cloze.answer() + cloze.after()).trim());
            v.put("card", card.view());
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "answer" -> {
                String opt = Drill.str(payload, "prefix");
                if (card == null || picked != null || !options.contains(opt)) {
                    return;
                }
                picked = opt;
                boolean correct = opt.equals(answer);
                right += correct ? 1 : 0;
                total += 1;
                progress.recordResult(ctx, card, correct, false);
            }
            case "next" -> {
                if (card != null) {
                    newQuestion(card.key());
                }
            }
            default -> throw Drill.unknown(action);
        }
    }
}
