package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.DrillService;
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

    public DrillController(DrillService drills) {
        this.drills = drills;
    }

    /** Starts a round: study, write, flash, quiz, articles, sep, cloze, review, phase. */
    @PostMapping("/{mode}")
    public Map<String, Object> start(Ctx ctx, @PathVariable String mode, @RequestBody(required = false) Map<String, Object> params) {
        return drills.start(ctx, mode, params);
    }

    @PostMapping("/{id}/{action}")
    public Map<String, Object> act(Ctx ctx, @PathVariable String id, @PathVariable String action,
                                   @RequestBody(required = false) Map<String, Object> payload) {
        return drills.act(ctx, id, action, payload);
    }
}
