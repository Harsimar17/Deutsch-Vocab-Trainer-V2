package com.vocabtrainer.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.model.Settings;
import org.springframework.stereotype.Service;

/** The page's frame: header numbers (streak, today's count, due / new cards), settings and their summary line. */
@Service
public class SummaryService {

    private static final Map<String, String> LEVEL_META = Map.of("A1", "BREAKTHROUGH", "A2", "WAYSTAGE", "B1", "THRESHOLD");

    private final SettingsService settings;
    private final ProgressService progress;
    private final CardCatalog catalog;

    public SummaryService(SettingsService settings, ProgressService progress, CardCatalog catalog) {
        this.settings = settings;
        this.progress = progress;
        this.catalog = catalog;
    }

    /** One settings change, answered with the whole new summary (settings, label, header …). */
    public Map<String, Object> change(Ctx ctx, String action, Object value, boolean ai) {
        settings.change(ctx, action, value);
        return summary(ctx, ai);
    }

    /** What an answer can change in the frame: the header numbers and the Review count. */
    public Map<String, Object> afterAnswer(Ctx ctx) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("header", header(ctx, settings.get(ctx)));
        v.put("mistakeCount", mistakeCount(ctx));
        return v;
    }

    /** Everything around the practice area. {@code ai}: whether the page holds a Gemini key (for the label). */
    public Map<String, Object> summary(Ctx ctx, boolean ai) {
        Settings s = settings.get(ctx);
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("settings", s.view());
        v.put("settingsLabel", SettingsService.label(s, ai));
        v.put("levelTitle", s.levels().size() == 1
                ? s.levels().get(0) + " · " + LEVEL_META.get(s.levels().get(0)) : String.join("  +  ", s.levels()));
        v.put("cardCount", catalog.levelCards(s.levels()).size());
        v.put("header", header(ctx, s));
        v.put("mistakeCount", mistakeCount(ctx));
        v.put("levels", CardCatalog.LEVELS);
        v.put("cats", CardCatalog.CATS);
        return v;
    }

    private long mistakeCount(Ctx ctx) {
        return progress.mistakes(ctx).keySet().stream().filter(k -> catalog.card(k) != null).count();
    }

    private Map<String, Object> header(Ctx ctx, Settings s) {
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
        return header;
    }
}
