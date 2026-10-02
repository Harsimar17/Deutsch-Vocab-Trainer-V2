package com.vocabtrainer.repository;

import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import com.vocabtrainer.config.AppProperties;

/**
 * Firebase Auth in memory, for tests and the local demo server: email/password
 * users, and refresh tokens that can be exchanged for ID tokens. Nothing leaves
 * the JVM.
 */
public class FakeFirebaseAuth extends FirebaseAuthClient {

    private record User(String uid, String email, String password) {
    }

    private final Map<String, User> byEmail = new ConcurrentHashMap<>();
    private final Map<String, String> uidByRefreshToken = new ConcurrentHashMap<>();
    private final AtomicInteger seq = new AtomicInteger();
    public final AtomicInteger refreshCalls = new AtomicInteger();

    public FakeFirebaseAuth() {
        super(new AppProperties(new AppProperties.Firebase("fake", "fake-key", "http://unused"), "legacy",
                new AppProperties.Cors(List.of()), null, null, null));
    }

    public String addUser(String email, String password) {
        String uid = "uid" + seq.incrementAndGet();
        byEmail.put(email, new User(uid, email, password));
        return uid;
    }

    @Override
    public FirebaseSession signUp(String email, String password) {
        if (byEmail.containsKey(email)) {
            throw refused(400, "EMAIL_EXISTS");
        }
        addUser(email, password);
        return signIn(email, password);
    }

    @Override
    public FirebaseSession signIn(String email, String password) {
        User u = byEmail.get(email);
        if (u == null || !u.password().equals(password)) {
            throw refused(400, "INVALID_LOGIN_CREDENTIALS");
        }
        String rt = "rt-" + u.uid() + "-" + seq.incrementAndGet();
        uidByRefreshToken.put(rt, u.uid());
        return new FirebaseSession(u.uid(), u.email(), "id-" + u.uid() + "-" + seq.incrementAndGet(), rt, 3600);
    }

    @Override
    public FirebaseSession refresh(String refreshToken) {
        refreshCalls.incrementAndGet();
        String uid = uidByRefreshToken.get(refreshToken);
        if (uid == null) {
            throw refused(400, "INVALID_REFRESH_TOKEN");
        }
        return new FirebaseSession(uid, null, "id-" + uid + "-" + seq.incrementAndGet(), refreshToken, 3600);
    }

    /** What a password change does to existing sessions. */
    public void revokeAll() {
        uidByRefreshToken.clear();
    }
}
