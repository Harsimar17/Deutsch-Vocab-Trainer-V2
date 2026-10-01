package com.vocabtrainer.settings;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.cards.CardCatalog;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Settings live in the progress record ("prefs") and are changed only through
 * named actions, so every rule (keep at least one level, valid values, …) is
 * applied here rather than in the page.
 */
@Service
public class SettingsService {

    private static final Set<String> FOCUS = Set.of("due", "all", "trouble");

    private final ProgressService progress;

    public SettingsService(ProgressService progress) {
        this.progress = progress;
    }

    @SuppressWarnings("unchecked")
    public Settings get(Ctx ctx) {
        Map<String, Object> p = progress.prefs(ctx);
        List<String> levels = p.get("levels") instanceof List<?> l && !l.isEmpty()
                ? ordered((List<String>) l, CardCatalog.LEVELS) : List.of("A2");
        List<String> cats = p.get("cats") instanceof List<?> c ? ordered((List<String>) c, CardCatalog.CATS) : CardCatalog.CATS;
        String direction = "en-de".equals(p.get("direction")) ? "en-de" : "de-en";
        String focus = p.get("focus") instanceof String f && FOCUS.contains(f) ? f : "due"; // Set.of rejects contains(null)
        String theme = "dark".equals(p.get("theme")) || "light".equals(p.get("theme")) ? (String) p.get("theme") : null;
        return new Settings(levels, cats, direction, Boolean.TRUE.equals(p.get("noRepeat")), focus, theme,
                Boolean.TRUE.equals(p.get("storyMode")), str(p.get("storyOpen")), Boolean.TRUE.equals(p.get("storyShowEn")),
                str(p.get("storyTest")));
    }

    /** Applies one named change and returns the new settings. */
    public Settings apply(Ctx ctx, String action, Object value) {
        Settings s = get(ctx);
        Map<String, Object> change = new LinkedHashMap<>();
        switch (action) {
            case "toggleLevel" -> {
                String lv = requireIn(value, CardCatalog.LEVELS);
                List<String> next = new ArrayList<>(s.levels());
                if (next.contains(lv)) {
                    if (next.size() > 1) {
                        next.remove(lv); // keep at least one level selected
                    }
                } else {
                    next.add(lv);
                }
                change.put("levels", ordered(next, CardCatalog.LEVELS));
            }
            case "toggleCat" -> {
                String c = requireIn(value, CardCatalog.CATS);
                List<String> next = new ArrayList<>(s.cats());
                if (!next.remove(c)) {
                    next.add(c);
                }
                change.put("cats", ordered(next, CardCatalog.CATS));
            }
            case "toggleDirection" -> change.put("direction", "de-en".equals(s.direction()) ? "en-de" : "de-en");
            case "toggleNoRepeat" -> change.put("noRepeat", !s.noRepeat());
            case "setFocus" -> change.put("focus", requireIn(value, List.copyOf(FOCUS)));
            case "setTheme" -> change.put("theme", requireIn(value, List.of("light", "dark")));
            case "setStoryMode" -> change.put("storyMode", Boolean.TRUE.equals(value));
            case "setStoryShowEn" -> change.put("storyShowEn", Boolean.TRUE.equals(value));
            case "openStory" -> {
                change.put("storyOpen", value == null ? null : String.valueOf(value));
                change.put("storyTest", null);
            }
            case "openPhaseTest" -> change.put("storyTest", value == null ? null : String.valueOf(value));
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown settings action: " + action);
        }
        progress.savePrefs(ctx, change);
        return get(ctx);
    }

    /** The one-line summary on the settings button. */
    public static String label(Settings s, boolean geminiKey) {
        StringBuilder sb = new StringBuilder(String.join("+", s.levels()));
        sb.append(" · ").append(s.cats().size() == CardCatalog.CATS.size()
                ? "all categories" : s.cats().size() + "/" + CardCatalog.CATS.size() + " categories");
        sb.append(" · ").append("de-en".equals(s.direction()) ? "DE→EN" : "EN→DE");
        if (s.noRepeat()) {
            sb.append(" · no repeats");
        }
        if (!"due".equals(s.focus())) {
            sb.append(" · focus: ").append(s.focus());
        }
        if (geminiKey) {
            sb.append(" · ✨ AI");
        }
        return sb.toString();
    }

    private static List<String> ordered(List<String> chosen, List<String> order) {
        return order.stream().filter(chosen::contains).toList();
    }

    private static String requireIn(Object v, List<String> allowed) {
        if (!(v instanceof String s) || !allowed.contains(s)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid value: " + v);
        }
        return s;
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
