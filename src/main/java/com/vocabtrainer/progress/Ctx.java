package com.vocabtrainer.progress;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Per-request context: the caller's Firebase ID token (used for every Firestore
 * call) and their time zone — "today", streaks and the daily new-word cap follow
 * the learner's local midnight, not the server's.
 */
public record Ctx(String token, ZoneId zone) {

    public String today() {
        return LocalDate.now(zone).toString(); // yyyy-MM-dd
    }

    public String yesterday() {
        return LocalDate.now(zone).minusDays(1).toString();
    }
}
