package com.vocabtrainer.progress;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import com.vocabtrainer.progress.ProgressRepository.FieldWrite;
import org.springframework.stereotype.Component;

/**
 * Each user's progress document, cached in memory and written through to
 * Firestore. Every change goes through {@link #apply} — Firestore first, then
 * the cached copy — and a cached copy is re-read after a short time so changes
 * made from another device or server instance show up. The cache is keyed by
 * uid, so users never see each other's record.
 */
@Component
public class ProgressStore {

    static final long TTL_MS = 30_000;
    static final long EVICT_AFTER_MS = 60 * 60 * 1000L;

    private static final class Entry {
        Map<String, Object> doc;
        long loadedAt;
        volatile long used;
    }

    private final ProgressRepository repo;
    private final Map<String, Entry> byUser = new ConcurrentHashMap<>();

    public ProgressStore(ProgressRepository repo) {
        this.repo = repo;
    }

    private Entry entry(Ctx ctx) {
        long now = System.currentTimeMillis();
        byUser.values().removeIf(x -> now - x.used > EVICT_AFTER_MS);
        Entry e = byUser.computeIfAbsent(ctx.uid(), k -> new Entry());
        e.used = now;
        return e;
    }

    /** The user's current document (read-only for callers). */
    public Map<String, Object> doc(Ctx ctx) {
        Entry e = entry(ctx);
        synchronized (e) {
            if (e.doc == null || System.currentTimeMillis() - e.loadedAt > TTL_MS) {
                e.doc = repo.load(ctx);
                e.loadedAt = System.currentTimeMillis();
            }
            return e.doc;
        }
    }

    public void apply(Ctx ctx, List<FieldWrite> writes, Map<String, Long> increments) {
        Entry e = entry(ctx);
        synchronized (e) {
            repo.write(ctx, writes, increments);
            Map<String, Object> doc = e.doc;
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
