package com.harsimar.vocab.auth;

import java.util.Map;

import com.harsimar.vocab.config.AppProperties;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Anonymous Firebase sign-in, done by the backend so the page needs no Firebase
 * SDK (and so writes nothing to browser storage). Uses the Firebase Auth REST
 * API with the project's web API key — the same thing firebase.auth()
 * .signInAnonymously() did in the browser. The page keeps the tokens in memory.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private static final String SIGN_UP = "https://identitytoolkit.googleapis.com/v1/accounts:signUp?key={key}";
    private static final String REFRESH = "https://securetoken.googleapis.com/v1/token?key={key}";

    private final RestClient http;
    private final String apiKey;

    public AuthController(AppProperties props) {
        this.http = RestClient.create();
        this.apiKey = props.firebase().webApiKey();
    }

    /** Session tokens for the page: idToken (≈1 h), refreshToken, expiresIn seconds. */
    public record Session(String idToken, String refreshToken, long expiresIn) {
    }

    @PostMapping("/anonymous")
    public Session anonymous() {
        Map<?, ?> r = call(() -> http.post().uri(SIGN_UP, apiKey)
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("returnSecureToken", true))
                .retrieve().body(Map.class));
        return new Session((String) r.get("idToken"), (String) r.get("refreshToken"), seconds(r.get("expiresIn")));
    }

    public record RefreshRequest(String refreshToken) {
    }

    @PostMapping("/refresh")
    public Session refresh(@RequestBody RefreshRequest body) {
        if (body.refreshToken() == null || body.refreshToken().isBlank() || body.refreshToken().length() > 2048) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "refreshToken is required");
        }
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("grant_type", "refresh_token");
        form.add("refresh_token", body.refreshToken());
        Map<?, ?> r = call(() -> http.post().uri(REFRESH, apiKey)
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .retrieve().body(Map.class));
        return new Session((String) r.get("id_token"), (String) r.get("refresh_token"), seconds(r.get("expires_in")));
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
            // 400 from Firebase Auth = bad/expired refresh token, or anonymous sign-in disabled
            HttpStatus status = e.getStatusCode().value() == 400 ? HttpStatus.UNAUTHORIZED : HttpStatus.BAD_GATEWAY;
            throw new ResponseStatusException(status, "Firebase Auth refused: " + e.getResponseBodyAsString());
        } catch (ResourceAccessException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "Firebase Auth unreachable");
        }
    }
}
