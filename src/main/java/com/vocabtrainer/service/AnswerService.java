package com.vocabtrainer.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Checking and saving answers of the rounds the page runs itself (Quiz,
 * Articles, Separable verbs, Fill-in, Cards): the page builds the questions
 * from german_vocab.json and sends only what was asked and what was picked.
 * Each answer is checked here against the card, saved like any other result,
 * and answered with the header numbers it changed.
 */
@Service
public class AnswerService {

    public static final int MAX_BATCH = 500;

    private final CardCatalog catalog;
    private final ProgressService progress;
    private final SummaryService summary;

    public AnswerService(CardCatalog catalog, ProgressService progress, SummaryService summary) {
        this.catalog = catalog;
        this.progress = progress;
        this.summary = summary;
    }

    /**
     * One answer: {@code key} is the card that was asked, {@code pick} what was
     * chosen — a card key (quiz, cloze), an article (articles) or a prefix (sep).
     * Returns {correct, summary} and, for the quiz, the all-time score.
     */
    public Map<String, Object> answer(Ctx ctx, String mode, String key, String pick) {
        Card card = card(key);
        if (pick == null || pick.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "pick is missing");
        }
        boolean correct = switch (mode == null ? "" : mode) {
            case "quiz", "cloze" -> pick.equals(card.key());
            case "articles" -> card.isNoun() && pick.equals(card.cat());
            case "sep" -> pick.equals(German.sepParts(card).prefix());
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown mode: " + mode);
        };
        boolean quiz = "quiz".equals(mode);
        progress.recordResult(ctx, card, correct, quiz);
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("correct", correct);
        if (quiz) {
            r.put("allTime", allTime(ctx));
        }
        r.put("summary", summary.afterAnswer(ctx));
        return r;
    }

    /** Cards: {results: [{key, knew}, …]}, saved in order; unknown cards are skipped. Returns {saved, summary}. */
    public Map<String, Object> batch(Ctx ctx, Object results) {
        if (!(results instanceof List<?> list) || list.size() > MAX_BATCH) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "results must be a list of at most " + MAX_BATCH);
        }
        int saved = 0;
        for (Object o : list) {
            if (o instanceof Map<?, ?> m && catalog.card(String.valueOf(m.get("key"))) instanceof Card card) {
                progress.recordResult(ctx, card, Boolean.TRUE.equals(m.get("knew")), false);
                saved++;
            }
        }
        return Map.of("saved", saved, "summary", summary.afterAnswer(ctx));
    }

    /** The quiz's saved rounds and all-time score: {sessions, allTime}. */
    public Map<String, Object> quizHistory(Ctx ctx) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("sessions", progress.sessions(ctx));
        r.put("allTime", allTime(ctx));
        return r;
    }

    /** Saves a finished quiz round, then {sessions, allTime}. */
    public Map<String, Object> saveQuizRound(Ctx ctx, Object right, Object total, Object cats) {
        long r = right instanceof Number n ? n.longValue() : -1;
        long t = total instanceof Number n ? n.longValue() : -1;
        if (t <= 0 || r < 0 || r > t) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "right and total must be 0 ≤ right ≤ total, total > 0");
        }
        List<String> c = cats instanceof List<?> l ? l.stream().map(String::valueOf).toList() : List.of();
        progress.addSession(ctx, r, t, c);
        return quizHistory(ctx);
    }

    public Map<String, Object> clearQuizHistory(Ctx ctx) {
        progress.clearSessions(ctx);
        return quizHistory(ctx);
    }

    private Map<String, Object> allTime(Ctx ctx) {
        long[] all = progress.allTime(ctx);
        return Map.of("right", all[0], "total", all[1]);
    }

    private Card card(String key) {
        Card card = catalog.card(key);
        if (card == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no such card: " + key);
        }
        return card;
    }
}
