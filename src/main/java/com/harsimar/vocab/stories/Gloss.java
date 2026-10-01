package com.harsimar.vocab.stories;

import java.util.LinkedHashMap;
import java.util.Map;

/** A meaning shown in the reader's tooltip: dictionary form, English, category, level, example. */
public record Gloss(String head, String en, String cat, String lvl, String example) {

    public Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("head", head);
        m.put("en", en);
        m.put("cat", cat);
        m.put("lvl", lvl);
        m.put("example", example);
        return m;
    }
}
