package com.vocabtrainer.settings;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.cards.CardCatalog;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressService;
import com.vocabtrainer.progress.Srs;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The page's frame: header numbers, settings and their summary line. */
@RestController
@RequestMapping("/api")
public class AppController {

    private static final Map<String, String> LEVEL_META = Map.of("A1", "BREAKTHROUGH", "A2", "WAYSTAGE", "B1", "THRESHOLD");

    private final SettingsService settings;
    private final ProgressService progress;
    private final CardCatalog catalog;

    public AppController(SettingsService settings, ProgressService progress, CardCatalog catalog) {
        this.settings = settings;
        this.progress = progress;
        this.catalog = catalog;
    }

    /** Everything around the practice area. {@code ai}: whether the page holds a Gemini key (for the label). */
    @GetMapping("/summary")
    public Map<String, Object> summary(Ctx ctx, @RequestParam(defaultValue = "false") boolean ai) {
        Settings s = settings.get(ctx);
        Map<String, Map<String, Object>> srs = progress.srs(ctx);
        Map<String, Object> daily = progress.daily(ctx);
        long now = System.currentTimeMillis();
        List<Card> pool = catalog.pool(s.levels(), s.cats());
        long due = pool.stream().filter(c -> srs.containsKey(c.key()) && Srs.num(srs.get(c.key()).get("due"), 0) <= now).count();
        long fresh = pool.stream().filter(c -> !srs.containsKey(c.key())).count();
        boolean today = ctx.today().equals(daily.get("date"));
        long reviewed = today ? Srs.num(daily.get("reviewed"), 0) : 0;

        Map<String, Object> header = new LinkedHashMap<>();
        header.put("streak", Srs.num(daily.get("streak"), 0));
        header.put("reviewed", reviewed);
        header.put("goal", Srs.DAILY_GOAL);
        header.put("pct", Math.min(100, Math.round(reviewed * 100.0 / Srs.DAILY_GOAL)));
        header.put("due", due);
        header.put("new", fresh);
        header.put("focus", s.focus());

        Map<String, Object> v = new LinkedHashMap<>();
        v.put("settings", s.view());
        v.put("settingsLabel", SettingsService.label(s, ai));
        v.put("levelTitle", s.levels().size() == 1
                ? s.levels().get(0) + " · " + LEVEL_META.get(s.levels().get(0)) : String.join("  +  ", s.levels()));
        v.put("cardCount", catalog.levelCards(s.levels()).size());
        v.put("header", header);
        v.put("mistakeCount", progress.mistakes(ctx).keySet().stream().filter(k -> catalog.card(k) != null).count());
        v.put("levels", CardCatalog.LEVELS);
        v.put("cats", CardCatalog.CATS);
        return v;
    }

    /** One named settings change (toggleLevel, toggleCat, toggleDirection, …); returns the new settings. */
    @PostMapping("/settings/{action}")
    public Map<String, Object> change(Ctx ctx, @PathVariable String action, @RequestBody(required = false) Map<String, Object> body) {
        return settings.apply(ctx, action, body == null ? null : body.get("value")).view();
    }
}
