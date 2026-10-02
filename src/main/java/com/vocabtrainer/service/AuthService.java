package com.vocabtrainer.service;

import java.util.Map;

import com.vocabtrainer.repository.FirebaseAuthClient;
import com.vocabtrainer.security.IdTokenCache;
import com.vocabtrainer.security.JwtService;
import org.springframework.stereotype.Service;

/**
 * Logging in: Firebase Auth checks email + password; the answer is the app's
 * own session JWT (see {@link JwtService}).
 */
@Service
public class AuthService {

    private final FirebaseAuthClient firebase;
    private final JwtService jwt;
    private final IdTokenCache idTokens;

    public AuthService(FirebaseAuthClient firebase, JwtService jwt, IdTokenCache idTokens) {
        this.firebase = firebase;
        this.jwt = jwt;
        this.idTokens = idTokens;
    }

    /** token: the session JWT; expiresIn: seconds of inactivity it survives; user: who logged in. */
    public record LoginResult(String token, long expiresIn, Map<String, String> user) {
    }

    public LoginResult login(String email, String password) {
        FirebaseAuthClient.FirebaseSession s = firebase.signIn(Credentials.email(email), Credentials.password(password));
        idTokens.put(s.uid(), s.idToken(), s.expiresIn());
        return new LoginResult(jwt.issue(s.uid(), s.email(), s.refreshToken()), jwt.idleTimeout().toSeconds(),
                Map.of("uid", s.uid(), "email", s.email()));
    }
}
