package com.vocabtrainer.controller;

import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.PatternService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Muster: the sentence patterns (see {@link PatternService}). */
@RestController
@RequestMapping("/api/patterns")
public class PatternsController {

    private final PatternService patterns;

    public PatternsController(PatternService patterns) {
        this.patterns = patterns;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return patterns.all();
    }

    @PostMapping("/{key}/seen")
    public Map<String, Object> seen(Ctx ctx, @PathVariable String key) {
        return patterns.seen(ctx, key);
    }
}
