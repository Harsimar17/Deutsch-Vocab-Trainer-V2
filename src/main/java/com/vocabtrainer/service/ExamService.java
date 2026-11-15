package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.ProgressRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The marks of the Prüfung tab (the Goethe B1 exam simulation). The exam is written, timed
 * and marked in the page with the learner's own AI; only each finished module's mark is
 * kept here, in scores/{uid}/exam/results, so the learner sees their earlier results on
 * every device. Newest first; only the newest {@value #MAX_RESULTS} are kept.
 */
@Service
public class ExamService {

    static final int MAX_RESULTS = 60;
    private static final Set<String> MODULES = Set.of("lesen", "hoeren", "schreiben", "sprechen");
    private static final Set<String> DIFFICULTIES = Set.of("real", "hard", "extreme");
    private static final Set<String> LEVELS = Set.of("A1", "A2", "B1");

    private final ProgressRepository repo;

    public ExamService(ProgressRepository repo) {
        this.repo = repo;
    }

    public Map<String, Object> results(Ctx ctx) {
        return Map.of("results", stored(ctx));
    }

    /** The body is {result: {module, diff, points (0–100), passed, at (ms)}}. */
    public synchronized Map<String, Object> add(Ctx ctx, Map<String, Object> body) {
        if (!(body.get("result") instanceof Map<?, ?> r)
                || !(r.get("module") instanceof String module) || !MODULES.contains(module)
                || !(r.get("diff") instanceof String diff) || !DIFFICULTIES.contains(diff)
                || (r.get("level") != null && (!(r.get("level") instanceof String level) || !LEVELS.contains(level)))
                || !(r.get("points") instanceof Number points) || points.intValue() < 0 || points.intValue() > 100
                || !(r.get("passed") instanceof Boolean passed)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "result: expected {module, diff, points, passed}");
        }
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("module", module);
        result.put("diff", diff);
        result.put("level", r.get("level") instanceof String level ? level : "B1");
        result.put("points", points.intValue());
        result.put("passed", passed);
        result.put("at", r.get("at") instanceof Number at && at.longValue() > 0 ? at.longValue() : System.currentTimeMillis());
        List<Map<String, Object>> all = new ArrayList<>(stored(ctx));
        all.add(0, result);
        all = new ArrayList<>(all.subList(0, Math.min(MAX_RESULTS, all.size())));
        repo.saveExamResults(ctx, Map.of("results", all));
        return Map.of("results", all);
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> stored(Ctx ctx) {
        Map<String, Object> doc = repo.findExamResults(ctx);
        return doc != null && doc.get("results") instanceof List<?> l ? (List<Map<String, Object>>) l : List.of();
    }
}
