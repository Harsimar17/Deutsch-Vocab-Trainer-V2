package com.vocabtrainer.settings;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The learner's choices — what to practise and how the page looks. */
public record Settings(
        List<String> levels,
        List<String> cats,
        String direction,
        boolean noRepeat,
        String focus,
        String theme,
        boolean storyMode,
        String storyOpen,
        boolean storyShowEn,
        String storyTest) {

    public Map<String, Object> view() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("levels", levels);
        m.put("cats", cats);
        m.put("direction", direction);
        m.put("noRepeat", noRepeat);
        m.put("focus", focus);
        m.put("theme", theme);
        m.put("storyMode", storyMode);
        m.put("storyOpen", storyOpen);
        m.put("storyShowEn", storyShowEn);
        m.put("storyTest", storyTest);
        return m;
    }
}
