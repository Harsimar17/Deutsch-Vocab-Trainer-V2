package com.vocabtrainer.cards;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.vocab.VocabService;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/**
 * german_vocab.json as cards and stories. Rebuilt whenever VocabService has a
 * new copy of the file (GitHub change or a commit from "+ Add word").
 */
@Service
public class CardCatalog {

    public static final List<String> LEVELS = List.of("A1", "A2", "B1");
    public static final List<String> CATS = List.of("der", "die", "das", "adj", "verb", "sep", "func", "phrase");
    public static final List<String> NOUN_CATS = List.of("der", "die", "das");
    private static final Map<String, String> PLAIN_CATS = orderedMap(
            "adjectives", "adj", "verbs", "verb", "separable_verbs", "sep", "function_words", "func", "phrases", "phrase");

    /** Everything derived from one version of the file. */
    public record Data(List<Card> cards, Map<String, Card> byKey, Map<String, Object> stories) {
    }

    private final VocabService vocab;
    private final JsonMapper json;
    private volatile String builtFor;
    private volatile Data data;

    public CardCatalog(VocabService vocab, JsonMapper json) {
        this.vocab = vocab;
        this.json = json;
    }

    public Data data() {
        VocabService.Snapshot snap = vocab.current();
        if (!snap.etag().equals(builtFor)) {
            synchronized (this) {
                if (!snap.etag().equals(builtFor)) {
                    data = build(json.readValue(snap.json(), LinkedHashMap.class));
                    builtFor = snap.etag();
                }
            }
        }
        return data;
    }

    public List<Card> cards() {
        return data().cards();
    }

    public Card card(String key) {
        return key == null ? null : data().byKey().get(key);
    }

    /** Cards of the selected levels and categories, in file order. */
    public List<Card> pool(Collection<String> levels, Collection<String> cats) {
        return cards().stream().filter(c -> levels.contains(c.lvl()) && cats.contains(c.cat())).toList();
    }

    public List<Card> levelCards(Collection<String> levels) {
        return cards().stream().filter(c -> levels.contains(c.lvl())).toList();
    }

    @SuppressWarnings("unchecked")
    static Data build(Map<String, Object> doc) {
        List<Card> cards = new ArrayList<>();
        Map<String, Object> levels = doc.get("levels") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of();
        for (String lvl : LEVELS) {
            if (!(levels.get(lvl) instanceof Map<?, ?> lm)) {
                continue;
            }
            Map<String, Object> level = (Map<String, Object>) lm;
            Map<String, Object> nouns = level.get("nouns") instanceof Map<?, ?> n ? (Map<String, Object>) n : Map.of();
            for (String art : NOUN_CATS) {
                for (Map<String, Object> e : list(nouns.get(art))) {
                    cards.add(card(lvl, art, e));
                }
            }
            PLAIN_CATS.forEach((field, cat) -> {
                for (Map<String, Object> e : list(level.get(field))) {
                    cards.add(card(lvl, cat, e));
                }
            });
        }
        Map<String, Card> byKey = new LinkedHashMap<>();
        cards.forEach(c -> byKey.putIfAbsent(c.key(), c));
        Map<String, Object> stories = doc.get("stories") instanceof Map<?, ?> s ? (Map<String, Object>) s : Map.of();
        return new Data(List.copyOf(byKey.values()), byKey, stories);
    }

    private static Card card(String lvl, String cat, Map<String, Object> e) {
        String de = str(e.get("de"));
        return new Card(Card.key(lvl, cat, de), de, str(e.get("en")), cat, lvl,
                blankToNull(e.get("example")), blankToNull(e.get("prefix")));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> list(Object v) {
        if (!(v instanceof List<?> l)) {
            return List.of();
        }
        List<Map<String, Object>> out = new ArrayList<>();
        l.forEach(x -> {
            if (x instanceof Map<?, ?> m) {
                out.add((Map<String, Object>) m);
            }
        });
        return out;
    }

    private static String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }

    private static String blankToNull(Object o) {
        return o == null || String.valueOf(o).isEmpty() ? null : String.valueOf(o);
    }

    private static Map<String, String> orderedMap(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i < kv.length; i += 2) {
            m.put(kv[i], kv[i + 1]);
        }
        return m;
    }
}
