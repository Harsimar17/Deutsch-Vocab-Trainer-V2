package com.vocabtrainer.repository;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import com.vocabtrainer.service.TalkloopScreen;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Saves and finds Talkloop practices running in ChatGPT — kept in memory, like
 * {@link DrillRepository}: a practice is the conversation on the screen, while every
 * mistake and word is saved to Firestore as it happens, so losing one (restart, idle
 * for hours) only means starting a new practice. Its id is random and unguessable:
 * the screen in ChatGPT reads it with nothing but the id.
 */
@Component
public class TalkloopScreenRepository {

    private static final Duration IDLE_LIMIT = Duration.ofHours(6);

    private record Entry(TalkloopScreen screen, long touched) {
    }

    private final Map<String, Entry> screens = new ConcurrentHashMap<>();

    /** Saves a new practice and returns its id. */
    public String save(TalkloopScreen screen) {
        long now = System.currentTimeMillis();
        screens.values().removeIf(e -> now - e.touched() > IDLE_LIMIT.toMillis());
        String id = UUID.randomUUID().toString();
        screens.put(id, new Entry(screen, now));
        return id;
    }

    /** The practice with this id (410 if it expired, or if owner is given and isn't its learner). */
    public TalkloopScreen find(String id, String owner) {
        Entry e = id == null ? null : screens.get(id);
        if (e == null || (owner != null && !e.screen().owner().equals(owner))) {
            throw new ResponseStatusException(HttpStatus.GONE, "This practice has ended: start a new one with start_talkloop.");
        }
        screens.put(id, new Entry(e.screen(), System.currentTimeMillis()));
        return e.screen();
    }
}
