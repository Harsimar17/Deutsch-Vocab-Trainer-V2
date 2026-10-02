package com.vocabtrainer.repository;

import java.util.Map;

import com.vocabtrainer.config.AppProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Firebase Auth REST API with the project's web API key: email/password
 * accounts are the user store (Firebase keeps the password hashes), and the
 * ID tokens it hands out are what Firestore checks its security rules against.
 */
@Component
public class FirebaseAuthClient {

    private static final String SIGN_UP = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={key}";
    private static final String SIGN_IN = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={key}";
    private static final String REFRESH = "https://securetoken.googleapis.com/v1/token?key={key}";

    private final RestClient http;
    private final String apiKey;

    public FirebaseAuthClient(AppProperties props) {
        this.http = RestClient.create();
        this.apiKey = props.firebase().webApiKey();
    }

    /** idToken (≈1 h), refreshToken (long-lived), the user's uid, idToken lifetime in seconds. */
    public record FirebaseSession(String uid, String email, String idToken, String refreshToken, long expiresIn) {
    }

    public FirebaseSession signUp(String email, String password) {
        Map<?, ?> r = call(() -> http.post().uri(SIGN_UP, apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("email", email, "password", password, "returnSecureToken", true))
                .retrieve().body(Map.class));
        return session(r);
    }

    public FirebaseSession signIn(String email, String password) {
        Map<?, ?> r = call(() -> http.post().uri(SIGN_IN, apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("email", email, "password", password, "returnSecureToken", true))
                .retrieve().body(Map.class));
        return session(r);
    }

    /** A fresh ID token for a refresh token (fails once the user is deleted, disabled or changes password). */
    public FirebaseSession refresh(String refreshToken) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "refresh_token");
        form.add("refresh_token", refreshToken);
        Map<?, ?> r = call(() -> http.post().uri(REFRESH, apiKey)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve().body(Map.class));
        return new FirebaseSession((String) r.get("user_id"), null, (String) r.get("id_token"),
                (String) r.get("refresh_token"), seconds(r.get("expires_in")));
    }

    private static FirebaseSession session(Map<?, ?> r) {
        return new FirebaseSession((String) r.get("localId"), (String) r.get("email"), (String) r.get("idToken"),
                (String) r.get("refreshToken"), seconds(r.get("expiresIn")));
    }

    private static long seconds(Object v) {
        try {
            return Long.parseLong(String.valueOf(v));
        } catch (NumberFormatException e) {
            return 3600;
        }
    }

    private interface Call {
        Map<?, ?> run();
    }

    private static Map<?, ?> call(Call c) {
        try {
            Map<?, ?> r = c.run();
            if (r == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "empty response from Firebase Auth");
            }
            return r;
        } catch (RestClientResponseException e) {
            throw refused(e.getStatusCode().value(), e.getResponseBodyAsString());
        } catch (ResourceAccessException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Firebase Auth unreachable");
        }
    }

    /** Firebase's error codes (in the body) → what the caller should see. */
    static ResponseStatusException refused(int status, String body) {
        String b = body == null ? "" : body;
        if (b.contains("EMAIL_EXISTS")) {
            return new ResponseStatusException(HttpStatus.CONFLICT, "a user with this email already exists");
        }
        if (b.contains("WEAK_PASSWORD")) {
            return new ResponseStatusException(HttpStatus.BAD_REQUEST, "password is too weak (at least 6 characters)");
        }
        if (b.contains("INVALID_EMAIL")) {
            return new ResponseStatusException(HttpStatus.BAD_REQUEST, "invalid email");
        }
        if (b.contains("INVALID_LOGIN_CREDENTIALS") || b.contains("INVALID_PASSWORD") || b.contains("EMAIL_NOT_FOUND")) {
            return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "wrong email or password");
        }
        if (b.contains("USER_DISABLED")) {
            return new ResponseStatusException(HttpStatus.FORBIDDEN, "this account is disabled");
        }
        if (b.contains("TOO_MANY_ATTEMPTS")) {
            return new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "too many attempts — try again later");
        }
        if (b.contains("OPERATION_NOT_ALLOWED")) {
            return new ResponseStatusException(HttpStatus.BAD_GATEWAY,
                    "Email/Password sign-in is not enabled in the Firebase project (Authentication → Sign-in method)");
        }
        if (b.contains("TOKEN_EXPIRED") || b.contains("USER_NOT_FOUND") || b.contains("INVALID_REFRESH_TOKEN")) {
            return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "session no longer valid — log in again");
        }
        HttpStatus s = status == 400 ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_GATEWAY;
        return new ResponseStatusException(s, "Firebase Auth refused the request");
    }
}
