package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.service.UserService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Creating users — a call made from Postman or curl, not from the page. Open
 * to any caller. Each user starts with an empty record at scores/{uid}, or a
 * copy of the old shared one with "importLegacyProgress": true.
 */
@RestController
@RequestMapping("/api/users")
public class UserController {

    private final UserService users;

    public UserController(UserService users) {
        this.users = users;
    }

    public record CreateUserRequest(String email, String password, Boolean importLegacyProgress) {
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Map<String, Object> create(@RequestBody CreateUserRequest body) {
        return users.create(body.email(), body.password(), Boolean.TRUE.equals(body.importLegacyProgress()));
    }
}
