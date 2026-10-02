package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.PhaseTestService;
import com.vocabtrainer.service.StoryListService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Story mode (see {@link StoryListService}) and each phase test's overview (see {@link PhaseTestService}). */
@RestController
@RequestMapping("/api")
public class StoriesController {

    private final StoryListService stories;
    private final PhaseTestService tests;

    public StoriesController(StoryListService stories, PhaseTestService tests) {
        this.stories = stories;
        this.tests = tests;
    }

    @GetMapping("/stories")
    public Map<String, Object> list(Ctx ctx) {
        return stories.list(ctx);
    }

    @GetMapping("/stories/{id}")
    public Map<String, Object> story(Ctx ctx, @PathVariable String id) {
        return stories.reader(ctx, id);
    }

    @PostMapping("/stories/{id}/read")
    public Map<String, Object> toggleRead(Ctx ctx, @PathVariable String id) {
        return stories.toggleRead(ctx, id);
    }

    @GetMapping("/phase-tests/{idx}")
    public Map<String, Object> phaseTest(Ctx ctx, @PathVariable String idx) {
        return tests.overview(ctx, idx);
    }

    @PostMapping("/phase-tests/{idx}/reset")
    public Map<String, Object> reset(Ctx ctx, @PathVariable String idx) {
        return tests.resetAndOverview(ctx, idx);
    }
}
