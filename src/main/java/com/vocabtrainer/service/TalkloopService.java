package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Pattern;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.ProgressRepository;
import com.vocabtrainer.security.JwtService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The bridge to Talkloop, the speaking-practice app: a link for it, the learnt
 * words (every card with a spaced-repetition record) so its conversation partner
 * can use them, and its mistake log, kept here so it follows the learner from
 * device to device.
 */
@Service
public class TalkloopService {

    static final int MAX_MISTAKES_PER_LANGUAGE = 300;
    private static final int MAX_LANGUAGES = 20;
    private static final int MAX_ENTRIES_PER_SYNC = 2000;
    private static final int MAX_TEXT = 300;
    private static final Pattern LANGUAGE = Pattern.compile("[\\p{L} ]{1,40}");
    private static final Pattern MISTAKE_TYPE = Pattern.compile("[a-z_]{1,40}");
    private static final int MAX_SPOKEN_WORDS = 5000;
    private static final int MAX_WORD = 100;
    private static final Pattern DAY = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    private final JwtService jwt;
    private final ProgressService progress;
    private final CardCatalog catalog;
    private final ProgressRepository repo;
    // One sync at a time per user (striped), so two devices syncing at once can't drop each other's entries.
    private final Object[] syncLocks = new Object[64];

    public TalkloopService(JwtService jwt, ProgressService progress, CardCatalog catalog, ProgressRepository repo) {
        this.jwt = jwt;
        this.progress = progress;
        this.catalog = catalog;
        this.repo = repo;
        for (int i = 0; i < syncLocks.length; i++) {
            syncLocks[i] = new Object();
        }
    }

    /** token: the link Talkloop keeps; expiresAt: when it stops working (ms). */
    public Map<String, Object> link(JwtService.Session session) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("token", jwt.issueLink(session));
        v.put("expiresAt", System.currentTimeMillis() + JwtService.LINK_VALIDITY.toMillis());
        return v;
    }

    /**
     * Learnt words, the ones that most need using first: lowest box (least
     * secure), then most often forgotten, then most recently practised.
     */
    public Map<String, Object> learntWords(Ctx ctx) {
        List<Map<String, Object>> words = new ArrayList<>();
        progress.srs(ctx).forEach((key, st) -> {
            Card c = catalog.card(key);
            if (c == null) {
                return;
            }
            Map<String, Object> w = new LinkedHashMap<>();
            w.put("de", c.de());
            w.put("en", c.en());
            w.put("cat", c.cat());
            w.put("lvl", c.lvl());
            w.put("example", c.example());
            w.put("box", Srs.num(st.get("box"), 1));
            w.put("lapses", Srs.num(st.get("lapses"), 0));
            w.put("last", Srs.num(st.get("last"), 0));
            words.add(w);
        });
        words.sort(Comparator.<Map<String, Object>>comparingLong(w -> (long) w.get("box"))
                .thenComparing(w -> (long) w.get("lapses"), Comparator.reverseOrder())
                .thenComparing(w -> (long) w.get("last"), Comparator.reverseOrder()));
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("count", words.size());
        v.put("words", words);
        return v;
    }

    /**
     * Talkloop's mistake log, merged with what one device sends; the whole log
     * (every language) comes back for the device to keep. The body and the answer
     * are {languages: {German: {resetAt, entries: [{type, at, said, fix}]}}}: a device
     * sends only what it recorded since its last sync, plus its reset times. Per
     * language the newest resetAt wins and drops every entry from before it; entries
     * are deduplicated (same at, type and said), and only the newest
     * {@value #MAX_MISTAKES_PER_LANGUAGE} are kept. Malformed entries are skipped.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> syncMistakes(Ctx ctx, Map<String, Object> body) {
        if (!(body.get("languages") instanceof Map<?, ?> incoming)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "languages: expected an object");
        }
        synchronized (syncLocks[Math.floorMod(ctx.uid().hashCode(), syncLocks.length)]) {
            Map<String, Object> stored = repo.findTalkloopMistakes(ctx);
            Map<String, Object> languages = new TreeMap<>(
                    stored != null && stored.get("languages") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
            boolean changed = false;
            int budget = MAX_ENTRIES_PER_SYNC;
            for (Map.Entry<?, ?> e : incoming.entrySet()) {
                if (!(e.getKey() instanceof String language) || !LANGUAGE.matcher(language).matches()
                        || !(e.getValue() instanceof Map<?, ?> sent)
                        || (!languages.containsKey(language) && languages.size() >= MAX_LANGUAGES)) {
                    continue;
                }
                Map<String, Object> have = languages.get(language) instanceof Map<?, ?> h ? (Map<String, Object>) h : Map.of();
                long resetAt = Math.max(Srs.num(have.get("resetAt"), 0), Math.max(0, Srs.num(sent.get("resetAt"), 0)));
                Map<String, Map<String, Object>> byKey = new LinkedHashMap<>();
                for (Object o : have.get("entries") instanceof List<?> l ? l : List.of()) {
                    if (o instanceof Map<?, ?> m) {
                        byKey.putIfAbsent(mistakeKey(m), (Map<String, Object>) m);
                    }
                }
                for (Object o : sent.get("entries") instanceof List<?> l ? l : List.of()) {
                    if (budget-- <= 0) {
                        break;
                    }
                    Map<String, Object> entry = mistake(o);
                    if (entry != null) {
                        byKey.putIfAbsent(mistakeKey(entry), entry);
                    }
                }
                List<Map<String, Object>> entries = byKey.values().stream()
                        .filter(m -> Srs.num(m.get("at"), 0) > resetAt)
                        .sorted(Comparator.comparingLong(m -> Srs.num(m.get("at"), 0)))
                        .toList();
                entries = entries.subList(Math.max(0, entries.size() - MAX_MISTAKES_PER_LANGUAGE), entries.size());
                Map<String, Object> merged = new LinkedHashMap<>();
                merged.put("resetAt", resetAt);
                merged.put("entries", entries);
                if (!merged.equals(normalized(have))) {
                    languages.put(language, merged);
                    changed = true;
                }
            }
            if (changed) { // a device that only pulls costs no write
                repo.saveTalkloopMistakes(ctx, Map.of("languages", languages));
            }
            return Map.of("languages", languages);
        }
    }

    /**
     * Talkloop's speaking schedule, merged with what one device sends; the whole
     * schedule comes back. The body and the answer are {words: {de: {stage, due, uses,
     * lastDay, updatedAt}}}: stage 0–4 (4 = automatic), due and updatedAt in ms, lastDay
     * the learner's day (yyyy-mm-dd) it was last said correctly. Per word the newest
     * updatedAt wins. Malformed words are skipped.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Object> syncSpoken(Ctx ctx, Map<String, Object> body) {
        if (!(body.get("words") instanceof Map<?, ?> incoming)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "words: expected an object");
        }
        synchronized (syncLocks[Math.floorMod(ctx.uid().hashCode(), syncLocks.length)]) {
            Map<String, Object> stored = repo.findTalkloopSpoken(ctx);
            Map<String, Object> words = new TreeMap<>(
                    stored != null && stored.get("words") instanceof Map<?, ?> m ? (Map<String, Object>) m : Map.of());
            boolean changed = false;
            for (Map.Entry<?, ?> e : incoming.entrySet()) {
                Map<String, Object> sent = spokenWord(e.getValue());
                if (!(e.getKey() instanceof String de) || de.isBlank() || de.length() > MAX_WORD || sent == null
                        || (!words.containsKey(de) && words.size() >= MAX_SPOKEN_WORDS)) {
                    continue;
                }
                long have = words.get(de) instanceof Map<?, ?> h ? Srs.num(h.get("updatedAt"), 0) : -1;
                if ((long) sent.get("updatedAt") > have) {
                    words.put(de, sent);
                    changed = true;
                }
            }
            if (changed) { // a device that only pulls costs no write
                repo.saveTalkloopSpoken(ctx, Map.of("words", words));
            }
            return Map.of("words", words);
        }
    }

    /** A valid speaking-schedule entry, or null. */
    private static Map<String, Object> spokenWord(Object o) {
        if (!(o instanceof Map<?, ?> m) || !(m.get("stage") instanceof Number stage) || !(m.get("updatedAt") instanceof Number at)) {
            return null;
        }
        long updatedAt = at.longValue();
        if (stage.intValue() < 0 || stage.intValue() > 4 || updatedAt <= 0 || updatedAt > System.currentTimeMillis() + 86_400_000L) {
            return null;
        }
        Map<String, Object> w = new LinkedHashMap<>();
        w.put("stage", (long) stage.intValue());
        w.put("due", Math.max(0, Srs.num(m.get("due"), 0)));
        w.put("uses", Math.max(0, Srs.num(m.get("uses"), 0)));
        w.put("lastDay", m.get("lastDay") instanceof String day && DAY.matcher(day).matches() ? day : "");
        w.put("updatedAt", updatedAt);
        return w;
    }

    /** A valid entry, with its texts cut to {@value #MAX_TEXT} characters, or null. */
    private static Map<String, Object> mistake(Object o) {
        if (!(o instanceof Map<?, ?> m) || !(m.get("type") instanceof String type) || !MISTAKE_TYPE.matcher(type).matches()
                || !(m.get("at") instanceof Number at) || !(m.get("said") instanceof String said)
                || !(m.get("fix") instanceof String fix)) {
            return null;
        }
        long when = at.longValue();
        if (when <= 0 || when > System.currentTimeMillis() + 86_400_000L) {
            return null;
        }
        Map<String, Object> entry = new LinkedHashMap<>();
        entry.put("type", type);
        entry.put("at", when);
        entry.put("said", clip(said));
        entry.put("fix", clip(fix));
        return entry;
    }

    private static String clip(String s) {
        return s.length() > MAX_TEXT ? s.substring(0, MAX_TEXT) : s;
    }

    private static String mistakeKey(Map<?, ?> m) {
        return Srs.num(m.get("at"), 0) + "|" + m.get("type") + "|" + m.get("said");
    }

    /** A stored language in the shape {@link #syncMistakes} builds, to tell whether anything changed. */
    private static Map<String, Object> normalized(Map<String, Object> have) {
        Map<String, Object> n = new LinkedHashMap<>();
        n.put("resetAt", Srs.num(have.get("resetAt"), 0));
        n.put("entries", have.get("entries") instanceof List<?> l ? l : List.of());
        return n;
    }
}
