package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.ExamService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** The Prüfung tab's marks (see {@link ExamService}); the exam itself runs in the page with the learner's AI. */
@RestController
@RequestMapping("/api/exam")
public class ExamController {

    private final ExamService exam;

    public ExamController(ExamService exam) {
        this.exam = exam;
    }

    @GetMapping("/results")
    public Map<String, Object> results(Ctx ctx) {
        return exam.results(ctx);
    }

    /** Adds one finished module's mark and returns all of them, newest first. */
    @PostMapping("/results")
    public Map<String, Object> add(Ctx ctx, @RequestBody Map<String, Object> body) {
        return exam.add(ctx, body);
    }
}
