package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.config.AppProperties;
import com.vocabtrainer.service.UserService;
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

    private final UserService users;

    public UserController(UserService users, AppProperties props) {
        this.users = users;
    }

    public record CreateUserRequest(String email, String password, Boolean importLegacyProgress) {
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestHeader(name = ADMIN_KEY_HEADER, required = false) String key,
                                      @RequestBody CreateUserRequest body) {
        return users.create(body.email(), body.password(), Boolean.TRUE.equals(body.importLegacyProgress()));
    }
}
