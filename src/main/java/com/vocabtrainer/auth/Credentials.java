package com.vocabtrainer.auth;

import java.util.Locale;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Input checks for email/password before anything is sent to Firebase. */
final class Credentials {

    private Credentials() {
    }

    static String email(String email) {
        String e = email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
        if (e.length() > 254 || !e.matches("[^@\\s]+@[^@\\s]+\\.[^@\\s]+")) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "a valid email is required");
        }
        return e;
    }

    static String password(String password) {
        if (password == null || password.length() < 6 || password.length() > 128) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "password must be 6–128 characters");
        }
        return password;
    }
}
