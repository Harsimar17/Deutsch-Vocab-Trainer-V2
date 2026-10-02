package com.vocabtrainer.auth;

import java.util.Map;

import com.vocabtrainer.security.SessionInterceptor;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Logging in. Email + password are checked by Firebase Auth; the answer is the
 * app's own session JWT (see {@link JwtService}), sent as "Authorization:
 * Bearer …" with every other /api call.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final FirebaseAuthClient firebase;
    private final JwtService jwt;
    private final IdTokenCache idTokens;

    public AuthController(FirebaseAuthClient firebase, JwtService jwt, IdTokenCache idTokens) {
        this.firebase = firebase;
        this.jwt = jwt;
        this.idTokens = idTokens;
    }

    public record LoginRequest(String email, String password) {
    }

    /** token: the session JWT; expiresIn: seconds of inactivity it survives; user: who logged in. */
    public record LoginResponse(String token, long expiresIn, Map<String, String> user) {
    }

    @PostMapping("/login")
    public LoginResponse login(@RequestBody LoginRequest body) {
        String email = Credentials.email(body.email());
        String password = Credentials.password(body.password());
        FirebaseAuthClient.FirebaseSession s = firebase.signIn(email, password);
        idTokens.put(s.uid(), s.idToken(), s.expiresIn());
        return new LoginResponse(jwt.issue(s.uid(), s.email(), s.refreshToken()), jwt.idleTimeout().toSeconds(),
                Map.of("uid", s.uid(), "email", s.email()));
    }

    /** Who the current token belongs to. */
    @GetMapping("/me")
    public Map<String, String> me(HttpServletRequest request) {
        if (!(request.getAttribute(SessionInterceptor.SESSION_ATTRIBUTE) instanceof JwtService.Session s)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "not logged in");
        }
        return Map.of("uid", s.uid(), "email", s.email() == null ? "" : s.email());
    }
}
