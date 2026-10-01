package com.harsimar.vocab.cards;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * One vocabulary card. {@code key} ("lvl|cat|de") is the card's identity
 * everywhere — in the API, in the spaced-repetition schedule and in the
 * Review list — because it stays stable when german_vocab.json changes.
 */
public record Card(String key, String de, String en, String cat, String lvl, String example, String prefix) {

    public static String key(String lvl, String cat, String de) {
        return lvl + "|" + cat + "|" + de;
    }

    public boolean isNoun() {
        return "der".equals(cat) || "die".equals(cat) || "das".equals(cat);
    }

    /** What the page renders for a card. */
    public Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("key", key);
        m.put("de", de);
        m.put("en", en);
        m.put("cat", cat);
        m.put("lvl", lvl);
        m.put("example", example);
        m.put("prefix", prefix);
        return m;
    }

    /** The side shown first / asked for, by direction ("de-en" or "en-de"). */
    public String prompt(String direction) {
        return "en-de".equals(direction) ? en : de;
    }

    public String answer(String direction) {
        return "en-de".equals(direction) ? de : en;
    }
}
