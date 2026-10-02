package com.vocabtrainer.auth;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Firebase ID tokens (≈1 h) per user, so Firestore calls don't need a token
 * exchange each time. Missing or nearly expired → exchanged again from the
 * refresh token carried in the user's session JWT.
 */
@Component
public class IdTokenCache {

    private static final long MARGIN_MS = 5 * 60 * 1000L;

    private record Cached(String idToken, long expiresAt) {
    }

    private final FirebaseAuthClient firebase;
    private final Map<String, Cached> byUid = new ConcurrentHashMap<>();

    public IdTokenCache(FirebaseAuthClient firebase) {
        this.firebase = firebase;
    }

    public String idToken(String uid, String refreshToken) {
        long now = System.currentTimeMillis();
        Cached c = byUid.get(uid);
        if (c != null && c.expiresAt() - MARGIN_MS > now) {
            return c.idToken();
        }
        // compute(): concurrent requests of one user wait for a single exchange.
        return byUid.compute(uid, (k, cur) -> {
            if (cur != null && cur.expiresAt() - MARGIN_MS > System.currentTimeMillis()) {
                return cur;
            }
            FirebaseAuthClient.FirebaseSession s = firebase.refresh(refreshToken);
            return new Cached(s.idToken(), System.currentTimeMillis() + s.expiresIn() * 1000);
        }).idToken();
    }

    /** Right after login/sign-up: the ID token is fresh, no need to exchange. */
    public void put(String uid, String idToken, long expiresInSeconds) {
        byUid.put(uid, new Cached(idToken, System.currentTimeMillis() + expiresInSeconds * 1000));
        byUid.values().removeIf(c -> c.expiresAt() < System.currentTimeMillis());
    }
}
