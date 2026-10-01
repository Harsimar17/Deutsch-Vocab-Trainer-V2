package com.vocabtrainer.drill;

import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.cards.German;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressService;
import com.vocabtrainer.util.Rand;

/** Articles: der, die or das for a noun. */
class ArticlesDrill implements Drill {

    private static final List<String> ARTICLES = List.of("der", "die", "das");

    private final List<Card> nouns;
    private final boolean noRepeat;
    private final ProgressService progress;
    private final Set<String> asked = new HashSet<>();
    private Card word;
    private String picked;
    private long right;
    private long total;
    private boolean done;

    ArticlesDrill(List<Card> pool, boolean noRepeat, ProgressService progress) {
        this.nouns = pool.stream().filter(Card::isNoun).toList();
        this.noRepeat = noRepeat;
        this.progress = progress;
        resetRound();
    }

    private void resetRound() {
        if (nouns.isEmpty()) {
            return;
        }
        asked.clear();
        word = Rand.pick(nouns);
        if (noRepeat) {
            asked.add(word.key());
        }
        picked = null;
        done = false;
    }

    @Override
    public Map<String, Object> view(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("empty", nouns.isEmpty());
        v.put("done", done);
        v.put("score", Map.of("right", right, "total", total));
        v.put("noRepeat", noRepeat);
        v.put("asked", asked.size());
        v.put("poolSize", nouns.size());
        v.put("articles", ARTICLES);
        if (word != null && !done) {
            v.put("bare", German.stripArticle(word.de()));
            v.put("en", word.en());
            v.put("picked", picked);
            v.put("answer", picked == null ? null : word.cat());
            // read the bare noun before answering, the full noun after
            v.put("speak", picked == null ? German.stripArticle(word.de()) : word.de());
            v.put("card", picked == null ? null : word.view());
        }
        return v;
    }

    @Override
    public void act(Ctx ctx, String action, Map<String, Object> payload) {
        switch (action) {
            case "answer" -> {
                String article = Drill.str(payload, "article");
                if (word == null || picked != null || done || !ARTICLES.contains(article)) {
                    return;
                }
                picked = article;
                boolean correct = article.equals(word.cat());
                right += correct ? 1 : 0;
                total += 1;
                progress.recordResult(ctx, word, correct, false);
            }
            case "next" -> {
                if (word == null) {
                    return;
                }
                if (noRepeat) {
                    List<Card> remaining = nouns.stream().filter(d -> !asked.contains(d.key())).toList();
                    if (remaining.isEmpty()) {
                        done = true;
                        picked = null;
                        return;
                    }
                    word = Rand.pick(remaining);
                    asked.add(word.key());
                } else {
                    word = Rand.pick(nouns);
                }
                picked = null;
            }
            case "restart" -> resetRound();
            default -> throw Drill.unknown(action);
        }
    }
}
