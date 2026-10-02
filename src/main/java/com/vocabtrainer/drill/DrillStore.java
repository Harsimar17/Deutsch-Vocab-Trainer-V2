package com.vocabtrainer.drill;

import java.time.Duration;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Rounds in progress, in memory. A round is short-lived working state — every
 * answer is saved to Firestore as it happens — so losing one (restart, idle for
 * hours) only means starting a new round. Each round belongs to the user who
 * started it; anyone else asking for it gets the same answer as for a missing one.
 */
@Component
public class DrillStore {

    private static final Duration IDLE_LIMIT = Duration.ofHours(6);

    private record Entry(String owner, Drill drill, long touched) {
    }

    private final Map<String, Entry> rounds = new ConcurrentHashMap<>();

    public String put(String owner, Drill drill) {
        long now = System.currentTimeMillis();
        rounds.values().removeIf(e -> now - e.touched() > IDLE_LIMIT.toMillis());
        String id = UUID.randomUUID().toString();
        rounds.put(id, new Entry(owner, drill, now));
        return id;
    }

    public Drill get(String owner, String id) {
        Entry e = id == null ? null : rounds.get(id);
        if (e == null || !e.owner().equals(owner)) {
            throw new ResponseStatusException(HttpStatus.GONE, "This round has expired — start again.");
        }
        rounds.put(id, new Entry(owner, e.drill(), System.currentTimeMillis()));
        return e.drill();
    }
}
