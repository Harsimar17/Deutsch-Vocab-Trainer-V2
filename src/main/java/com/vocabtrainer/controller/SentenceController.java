package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.SentenceService.GenerateRequest;
import com.vocabtrainer.service.SentenceService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Example sentences shown with a card (see {@link SentenceService}). */
@RestController
@RequestMapping("/api/sentences")
public class SentenceController {

    private final SentenceService sentences;

    public SentenceController(SentenceService sentences) {
        this.sentences = sentences;
    }

    /** The saved sentence for a word, or 404 if there isn't one yet. */
    @GetMapping
    public ResponseEntity<Map<String, Object>> get(Ctx ctx, @RequestParam String word) {
        Map<String, Object> s = sentences.find(ctx, word);
        return s == null ? ResponseEntity.notFound().build() : ResponseEntity.ok(s);
    }

    /** Saved sentence if there is one; otherwise generate with Gemini (key in X-Gemini-Key), save, and return it. */
    @PostMapping("/generate")
    public Map<String, Object> generate(Ctx ctx, @RequestHeader(name = "X-Gemini-Key", required = false) String key,
                                        @RequestBody GenerateRequest req) {
        return sentences.findOrGenerate(ctx, key, req);
    }
}
