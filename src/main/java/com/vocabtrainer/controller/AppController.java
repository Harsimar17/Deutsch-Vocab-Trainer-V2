package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.SettingsService;
import com.vocabtrainer.service.SummaryService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** The page's frame (see {@link SummaryService}) and settings changes (see {@link SettingsService}). */
@RestController
@RequestMapping("/api")
public class AppController {

    private final SummaryService summary;
    private final SettingsService settings;

    public AppController(SummaryService summary, SettingsService settings) {
        this.summary = summary;
        this.settings = settings;
    }

    /** Everything around the practice area. {@code ai}: whether the page holds a Gemini key (for the label). */
    @GetMapping("/summary")
    public Map<String, Object> summary(Ctx ctx, @RequestParam(defaultValue = "false") boolean ai) {
        return summary.summary(ctx, ai);
    }

    /** One named settings change (toggleLevel, toggleCat, toggleDirection, …); returns the new settings. */
    @PostMapping("/settings/{action}")
    public Map<String, Object> change(Ctx ctx, @PathVariable String action, @RequestBody(required = false) Map<String, Object> body) {
        return settings.change(ctx, action, body == null ? null : body.get("value"));
    }
}
