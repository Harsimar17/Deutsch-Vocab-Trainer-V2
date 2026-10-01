package com.vocabtrainer.progress;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.progress.ProgressRepository.FieldWrite;
import org.springframework.stereotype.Component;

/**
 * The learner's progress document, cached in memory and written through to
 * Firestore. There is one shared record (single-learner app), so every change
 * goes through {@link #apply} — Firestore first, then the cached copy — and the
 * cache is re-read after a short time so changes made from another device or
 * server instance show up.
 */
@Component
public class ProgressStore {

    static final long TTL_MS = 30_000;

    private final ProgressRepository repo;
    private Map<String, Object> doc;
    private long loadedAt;

    public ProgressStore(ProgressRepository repo) {
        this.repo = repo;
    }

    /** The current document (read-only for callers). */
    public synchronized Map<String, Object> doc(Ctx ctx) {
        if (doc == null || System.currentTimeMillis() - loadedAt > TTL_MS) {
            doc = repo.load(ctx.token());
            loadedAt = System.currentTimeMillis();
        }
        return doc;
    }

    public synchronized void apply(Ctx ctx, List<FieldWrite> writes, Map<String, Long> increments) {
        repo.write(ctx.token(), writes, increments);
        if (doc == null) {
            return;
        }
        for (FieldWrite w : writes) {
            if (w.delete()) {
                removePath(doc, w.path());
            } else {
                ProgressRepository.putPath(doc, w.path(), w.value());
            }
        }
        if (increments != null) {
            increments.forEach((f, by) -> doc.put(f, Srs.num(doc.get(f), 0) + by));
        }
    }

    @SuppressWarnings("unchecked")
    private static void removePath(Map<String, Object> root, List<String> path) {
        Map<String, Object> m = root;
        for (int i = 0; i < path.size() - 1; i++) {
            Object next = m.get(path.get(i));
            if (!(next instanceof Map)) {
                return;
            }
            m = (Map<String, Object>) next;
        }
        m.remove(path.get(path.size() - 1));
    }

    // ---- typed views of the document ----

    @SuppressWarnings("unchecked")
    public static Map<String, Object> map(Map<String, Object> doc, String field) {
        Object v = doc.get(field);
        return v instanceof Map<?, ?> m ? (Map<String, Object>) m : new LinkedHashMap<>();
    }

    @SuppressWarnings("unchecked")
    public static Map<String, Map<String, Object>> mapOfMaps(Map<String, Object> doc, String field) {
        Map<String, Map<String, Object>> out = new LinkedHashMap<>();
        map(doc, field).forEach((k, v) -> {
            if (v instanceof Map<?, ?> m) {
                out.put(k, (Map<String, Object>) m);
            }
        });
        return out;
    }
}
