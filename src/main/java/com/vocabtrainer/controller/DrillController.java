package com.vocabtrainer.controller;

import java.util.LinkedHashMap;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.DrillService;
import com.vocabtrainer.service.SummaryService;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Practice rounds (see {@link DrillService}). The page starts a round, shows
 * the returned view, and sends each action back; every response is the next view.
 */
@RestController
@RequestMapping("/api/drills")
public class DrillController {

    private final DrillService drills;
    private final SummaryService summary;

    public DrillController(DrillService drills, SummaryService summary) {
        this.drills = drills;
        this.summary = summary;
    }

    /** Starts a round: study, write, review, phase, sentences (the last two take {phase}). Cards, Quiz, Articles, Separable verbs and Fill-in run in the page. */
    @PostMapping("/{mode}")
    public Map<String, Object> start(Ctx ctx, @PathVariable String mode, @RequestBody(required = false) Map<String, Object> params) {
        return drills.start(ctx, mode, params);
    }

    @PostMapping("/{id}/{action}")
    public Map<String, Object> act(Ctx ctx, @PathVariable String id, @PathVariable String action,
                                   @RequestBody(required = false) Map<String, Object> payload) {
        Map<String, Object> r = new LinkedHashMap<>(drills.act(ctx, id, action, payload));
        r.put("summary", summary.afterAnswer(ctx)); // the header numbers, so the page needs no second call
        return r;
    }
}
