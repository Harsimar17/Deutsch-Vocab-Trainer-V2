package com.vocabtrainer.service.drill;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.German;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.util.Rand;

/** Fill-in: a noun's example sentence with the noun blanked; pick it from four same-gender nouns. */
class ClozeDrill implements Drill {

    private final List<Card> clozePool;
    private final boolean noRepeat;
    private final ProgressService progress;
    private final Set<String> asked = new HashSet<>();
    private Card correct;
    private German.Cloze hit;
    private List<Card> options;
    private String picked;
    private long right;
    private long total;
    private boolean done;

    ClozeDrill(List<Card> pool, boolean noRepeat, ProgressService progress) {
        this.clozePool = pool.stream().filter(d -> d.isNoun() && d.example() != null && German.clozeMatch(d) != null).toList();
        this.noRepeat = noRepeat;
        this.progress = progress;
        resetRound();
    }

    private void makeQuestion(List<Card> source) {
        correct = Rand.pick(source != null && !source.isEmpty() ? source : clozePool);
        hit = German.clozeMatch(correct);
        Card c = correct;
        List<Card> sameCat = clozePool.stream().filter(d -> d.cat().equals(c.cat()) && !d.key().equals(c.key())).toList();
        List<Card> distract = sameCat.size() >= 3 ? sameCat : clozePool.stream().filter(d -> !d.key().equals(c.key())).toList();
        List<Card> opts = new ArrayList<>(Rand.shuffle(distract).subList(0, Math.min(3, distract.size())));
        opts.add(correct);
        options = Rand.shuffle(opts);
        picked = null;
    }

    private void resetRound() {
        if (clozePool.size() < 4) {
            return;
        }
        asked.clear();
        makeQuestion(null);
        if (noRepeat) {
            asked.add(correct.key());
        }
        done = false;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("tooFew", clozePool.size() < 4);
        v.put("done", done);
        v.put("score", Map.of("right", right, "total", total));
        v.put("noRepeat", noRepeat);
        v.put("asked", asked.size());
        v.put("poolSize", clozePool.size());
        if (correct != null && !done) {
            v.put("cat", correct.cat());
            v.put("before", hit.before());
            v.put("after", hit.after());
            v.put("gap", hit.answer());
            List<Map<String, Object>> opts = new ArrayList<>();
            for (Card o : options) {
                opts.add(Map.of("key", o.key(), "label", German.nounForms(o).isEmpty() ? o.de() : German.nounForms(o).get(0)));
            }
            v.put("options", opts);
            v.put("picked", picked);
            v.put("correctKey", picked == null ? null : correct.key());
            v.put("sentence", (hit.before() + hit.answer() + hit.after()).trim());
            v.put("card", picked == null ? null : correct.view());
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "answer" -> {
                String key = Drill.str(payload, "key");
                if (correct == null || picked != null || done || options.stream().noneMatch(o -> o.key().equals(key))) {
                    return;
                }
                picked = key;
                boolean ok = key.equals(correct.key());
                right += ok ? 1 : 0;
                total += 1;
                progress.recordResult(ctx, correct, ok, false);
            }
            case "next" -> {
                if (correct == null) {
                    return;
                }
                if (noRepeat) {
                    List<Card> remaining = clozePool.stream().filter(d -> !asked.contains(d.key())).toList();
                    if (remaining.isEmpty()) {
                        done = true;
                        picked = null;
                        return;
                    }
                    makeQuestion(remaining);
                    asked.add(correct.key());
                } else {
                    makeQuestion(null);
                }
            }
            case "restart" -> resetRound();
            default -> throw Drill.unknown(action);
        }
    }
}
