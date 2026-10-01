package com.harsimar.vocab.drill;

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
 * hours) only means starting a new round.
 */
@Component
public class DrillStore {

    private static final Duration IDLE_LIMIT = Duration.ofHours(6);

    private record Entry(Drill drill, long touched) {
    }

    private final Map<String, Entry> rounds = new ConcurrentHashMap<>();

    public String put(Drill drill) {
        long now = System.currentTimeMillis();
        rounds.values().removeIf(e -> now - e.touched() > IDLE_LIMIT.toMillis());
        String id = UUID.randomUUID().toString();
        rounds.put(id, new Entry(drill, now));
        return id;
    }

    public Drill get(String id) {
        Entry e = id == null ? null : rounds.get(id);
        if (e == null) {
            throw new ResponseStatusException(HttpStatus.GONE, "This round has expired — start again.");
        }
        rounds.put(id, new Entry(e.drill(), System.currentTimeMillis()));
        return e.drill();
    }
}
