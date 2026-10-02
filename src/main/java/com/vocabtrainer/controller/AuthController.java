package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.security.JwtService;
import com.vocabtrainer.security.SessionInterceptor;
import com.vocabtrainer.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Logging in (see {@link AuthService}). The returned session JWT is sent as
 * "Authorization: Bearer …" with every other /api call.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    public record LoginRequest(String email, String password) {
    }

    @PostMapping("/login")
    public AuthService.LoginResult login(@RequestBody LoginRequest body) {
        return auth.login(body.email(), body.password());
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
