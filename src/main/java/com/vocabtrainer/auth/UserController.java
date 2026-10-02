package com.vocabtrainer.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;

import com.vocabtrainer.config.AppProperties;
import com.vocabtrainer.progress.Ctx;
import com.vocabtrainer.progress.ProgressRepository;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Creating users — an admin call (Postman, curl), not something the page does.
 * Needs "X-Admin-Key" matching app.auth.admin-key; with no key configured it is
 * switched off. Each user starts with an empty record at scores/{uid}, or a
 * copy of the old shared one with "importLegacyProgress": true.
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    public static final String ADMIN_KEY_HEADER = "X-Admin-Key";

    private final FirebaseAuthClient firebase;
    private final ProgressRepository progress;
    private final String adminKey;

    public UserController(FirebaseAuthClient firebase, ProgressRepository progress, AppProperties props) {
        this.firebase = firebase;
        this.progress = progress;
        this.adminKey = props.auth().adminKey();
    }

    public record CreateUserRequest(String email, String password, Boolean importLegacyProgress) {
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestHeader(name = ADMIN_KEY_HEADER, required = false) String key,
                                      @RequestBody CreateUserRequest body) {
        String email = Credentials.email(body.email());
        String password = Credentials.password(body.password());
        FirebaseAuthClient.FirebaseSession s = firebase.signUp(email, password);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("uid", s.uid());
        out.put("email", s.email());
        if (Boolean.TRUE.equals(body.importLegacyProgress())) {
            // Acts as the new user, so the security rules must let them read the old record.
            out.put("importedLegacyProgress", progress.importLegacy(new Ctx(s.uid(), s.idToken(), ZoneOffset.UTC)));
        }
        return out;
    }
}
