package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.AnswerService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Answers of the rounds the page runs itself, and the quiz's saved rounds (see {@link AnswerService}). */
@RestController
@RequestMapping("/api")
public class AnswersController {

    private final AnswerService answers;

    public AnswersController(AnswerService answers) {
        this.answers = answers;
    }

    /** {mode, key, pick} → {correct, summary[, allTime]}. */
    @PostMapping("/answers")
    public Map<String, Object> answer(Ctx ctx, @RequestBody Map<String, Object> body) {
        return answers.answer(ctx, str(body.get("mode")), str(body.get("key")), str(body.get("pick")));
    }

    /** Cards: {results: [{key, knew}, …]} → {saved, summary}. */
    @PostMapping("/answers/batch")
    public Map<String, Object> batch(Ctx ctx, @RequestBody Map<String, Object> body) {
        return answers.batch(ctx, body.get("results"));
    }

    @GetMapping("/quiz-sessions")
    public Map<String, Object> quizHistory(Ctx ctx) {
        return answers.quizHistory(ctx);
    }

    /** {right, total, cats} → {sessions, allTime}. */
    @PostMapping("/quiz-sessions")
    public Map<String, Object> saveQuizRound(Ctx ctx, @RequestBody Map<String, Object> body) {
        return answers.saveQuizRound(ctx, body.get("right"), body.get("total"), body.get("cats"));
    }

    @DeleteMapping("/quiz-sessions")
    public Map<String, Object> clearQuizHistory(Ctx ctx) {
        return answers.clearQuizHistory(ctx);
    }

    private static String str(Object o) {
        return o == null ? null : String.valueOf(o);
    }
}
