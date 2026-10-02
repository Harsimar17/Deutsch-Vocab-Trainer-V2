package com.vocabtrainer.model;

import java.time.LocalDate;
import java.time.ZoneId;

/**
 * Per-request context: the logged-in user (their Firebase uid — their record is
 * scores/{uid}), a Firebase ID token to act as them in Firestore, and their time
 * zone — "today", streaks and the daily new-word cap follow the learner's local
 * midnight, not the server's.
 */
public record Ctx(String uid, String token, ZoneId zone) {

    public String today() {
        return LocalDate.now(zone).toString(); // yyyy-MM-dd
    }

    public String yesterday() {
        return LocalDate.now(zone).minusDays(1).toString();
    }
}
