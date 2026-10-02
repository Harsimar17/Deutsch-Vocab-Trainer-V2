package com.vocabtrainer.service;

import java.io.IOException;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.vocabtrainer.model.Ctx;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Muster: German sentence patterns as colour-coded slots, each with real
 * example sentences (patterns.json). Looking at a pattern counts toward
 * today's goal once per pattern, user and day.
 */
@Service
public class PatternService {

    private final List<Map<String, Object>> patterns;
    private final ProgressService progress;
    private final Set<String> seenToday = ConcurrentHashMap.newKeySet(); // "yyyy-MM-dd|uid|key"

    @SuppressWarnings("unchecked")
    public PatternService(JsonMapper json, ProgressService progress) throws IOException {
        this.progress = progress;
        try (InputStream in = new ClassPathResource("patterns.json").getInputStream()) {
            List<Map<String, Object>> raw = json.readValue(in, List.class);
            List<Map<String, Object>> out = new ArrayList<>();
            for (Map<String, Object> p : raw) {
                Map<String, Object> copy = new LinkedHashMap<>(p);
                List<Map<String, Object>> examples = new ArrayList<>();
                for (Map<String, Object> e : (List<Map<String, Object>>) p.get("examples")) {
                    Map<String, Object> ex = new LinkedHashMap<>(e);
                    ex.put("sentence", sentence((List<Map<String, Object>>) e.get("chunks")));
                    examples.add(ex);
                }
                copy.put("examples", examples);
                out.add(copy);
            }
            this.patterns = List.copyOf(out);
        }
    }

    /** The chunks read as one sentence (for 🔊). */
    static String sentence(List<Map<String, Object>> chunks) {
        StringBuilder sb = new StringBuilder();
        for (Map<String, Object> c : chunks) {
            if (!sb.isEmpty()) {
                sb.append(' ');
            }
            sb.append(c.get("text"));
        }
        return sb.toString().replaceAll("\\s+([,.!?])", "$1");
    }

    public List<Map<String, Object>> all() {
        return patterns;
    }

    /** Records that the learner looked at a pattern; {counted}: whether it counted toward today. */
    public Map<String, Object> seen(Ctx ctx, String key) {
        if (patterns.stream().noneMatch(p -> key.equals(p.get("key")))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no such pattern");
        }
        // once per pattern, user and (their) day. Zones are up to 26 h apart, so
        // another user's "today" can be 2 days behind — anything older is done.
        String oldest = LocalDate.now(ctx.zone()).minusDays(2).toString();
        seenToday.removeIf(s -> s.substring(0, 10).compareTo(oldest) < 0);
        boolean counted = seenToday.add(ctx.today() + "|" + ctx.uid() + "|" + key);
        if (counted) {
            progress.tickDaily(ctx);
        }
        return Map.of("counted", counted);
    }
}
