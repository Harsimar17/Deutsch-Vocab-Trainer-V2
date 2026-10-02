package com.vocabtrainer.repository;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.vocabtrainer.config.AppProperties;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.Srs;
import org.springframework.http.HttpStatus;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

/**
 * Firestore in memory, for tests and the local demo server: one document per
 * uid with the same field-write / increment semantics as the real commit, plus
 * the sessions and aiSentences subcollections. Like Firestore's rules, it only
 * serves a uid's data to an ID token issued for that uid ("id-{uid}-…").
 */
public class InMemoryProgressRepository extends ProgressRepository {

    private final Map<String, Map<String, Object>> docs = new ConcurrentHashMap<>();
    private final Map<String, List<Map<String, Object>>> sessions = new ConcurrentHashMap<>();
    private final Map<String, Map<String, Map<String, Object>>> sentences = new ConcurrentHashMap<>();

    public InMemoryProgressRepository() {
        super(RestClient.create(), new AppProperties(new AppProperties.Firebase("fake", "fake-key", "http://unused"),
                "legacy", new AppProperties.Cors(List.of()), null, null, null));
    }

    /** Starts a user off with this document (tests). */
    public synchronized void seed(String uid, Map<String, Object> doc) {
        docs.put(uid, copy(doc));
    }

    /** The stored document of a user (a copy). */
    public Map<String, Object> raw(String uid) {
        return copy(docs.getOrDefault(uid, Map.of()));
    }

    private static void rules(Ctx ctx) {
        if (ctx.token() == null || !ctx.token().startsWith("id-" + ctx.uid() + "-")) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "rules deny: token is not for " + ctx.uid());
        }
    }

    @Override
    public synchronized Map<String, Object> find(Ctx ctx) {
        rules(ctx);
        return raw(ctx.uid());
    }

    @Override
    public boolean copyLegacyProgress(Ctx ctx) {
        return false;
    }

    @Override
    public synchronized void save(Ctx ctx, List<FieldWrite> writes, Map<String, Long> increments) {
        rules(ctx);
        Map<String, Object> doc = docs.computeIfAbsent(ctx.uid(), k -> new LinkedHashMap<>());
        for (FieldWrite w : writes) {
            if (w.delete()) {
                remove(doc, w.path());
            } else {
                putPath(doc, w.path(), copyValue(w.value()));
            }
        }
        if (increments != null) {
            increments.forEach((f, by) -> doc.put(f, Srs.num(doc.get(f), 0) + by));
        }
    }

    @Override
    public synchronized List<Map<String, Object>> findSessions(Ctx ctx, int limit) {
        rules(ctx);
        return sessions.getOrDefault(ctx.uid(), List.of()).stream()
                .sorted(Comparator.comparingLong((Map<String, Object> s) -> Srs.num(s.get("timestamp"), 0)).reversed())
                .limit(limit).map(InMemoryProgressRepository::copy).toList();
    }

    @Override
    public synchronized void saveSession(Ctx ctx, Map<String, Object> session) {
        rules(ctx);
        Map<String, Object> s = copy(session);
        s.put("id", UUID.randomUUID().toString());
        sessions.computeIfAbsent(ctx.uid(), k -> new ArrayList<>()).add(s);
    }

    @Override
    public synchronized void deleteSessions(Ctx ctx) {
        rules(ctx);
        sessions.remove(ctx.uid());
    }

    @Override
    public synchronized Map<String, Object> findSentence(Ctx ctx, String word) {
        rules(ctx);
        Map<String, Object> s = sentences.getOrDefault(ctx.uid(), Map.of()).get(word);
        return s == null ? null : copy(s);
    }

    @Override
    public synchronized void saveSentence(Ctx ctx, String word, String de, String en) {
        rules(ctx);
        sentences.computeIfAbsent(ctx.uid(), k -> new LinkedHashMap<>()).put(word, Map.of("word", word, "de", de, "en", en));
    }

    @SuppressWarnings("unchecked")
    private static void remove(Map<String, Object> root, List<String> path) {
        Map<String, Object> m = root;
        for (int i = 0; i < path.size() - 1; i++) {
            if (!(m.get(path.get(i)) instanceof Map<?, ?> next)) {
                return;
            }
            m = (Map<String, Object>) next;
        }
        m.remove(path.get(path.size() - 1));
    }

    /** Deep copies, so nothing outside shares mutable state with what is "stored". */
    @SuppressWarnings("unchecked")
    private static Object copyValue(Object v) {
        if (v instanceof Map<?, ?> m) {
            return copy((Map<String, Object>) m);
        }
        if (v instanceof List<?> l) {
            List<Object> out = new ArrayList<>();
            l.forEach(x -> out.add(copyValue(x)));
            return out;
        }
        if (v instanceof Integer i) {
            return i.longValue(); // Firestore hands integers back as longs
        }
        return v;
    }

    private static Map<String, Object> copy(Map<String, Object> m) {
        Map<String, Object> out = new LinkedHashMap<>();
        m.forEach((k, v) -> out.put(k, copyValue(v)));
        return out;
    }
}
