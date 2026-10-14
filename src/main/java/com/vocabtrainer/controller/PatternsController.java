package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.PatternService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Muster: looking at a pattern counts toward today (the patterns themselves are static/data/patterns.json). */
@RestController
@RequestMapping("/api/patterns")
public class PatternsController {

    private final PatternService patterns;

    public PatternsController(PatternService patterns) {
        this.patterns = patterns;
    }

    @PostMapping("/{key}/seen")
    public Map<String, Object> seen(Ctx ctx, @PathVariable String key) {
        return patterns.seen(ctx, key);
    }
}
