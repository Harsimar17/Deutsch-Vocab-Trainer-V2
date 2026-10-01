package com.harsimar.vocab.patterns;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.harsimar.vocab.progress.Ctx;
import com.harsimar.vocab.progress.ProgressService;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * Muster: German sentence patterns as colour-coded slots, each with real
 * example sentences (patterns.json). Looking at a pattern counts toward
 * today's goal once per pattern per day.
 */
@RestController
@RequestMapping("/api/patterns")
public class PatternsController {

    private final List<Map<String, Object>> patterns;
    private final ProgressService progress;
    private final Set<String> seenToday = ConcurrentHashMap.newKeySet();

    @SuppressWarnings("unchecked")
    public PatternsController(JsonMapper json, ProgressService progress) throws IOException {
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

    @GetMapping
    public List<Map<String, Object>> list() {
        return patterns;
    }

    @PostMapping("/{key}/seen")
    public Map<String, Object> seen(Ctx ctx, @PathVariable String key) {
        if (patterns.stream().noneMatch(p -> key.equals(p.get("key")))) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no such pattern");
        }
        boolean counted = seenToday.add(ctx.today() + "|" + key);
        if (counted) {
            progress.tickDaily(ctx);
        }
        return Map.of("counted", counted);
    }
}
