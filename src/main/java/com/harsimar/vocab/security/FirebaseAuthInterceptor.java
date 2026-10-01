package com.harsimar.vocab.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Every /api call must carry the page's Firebase ID token ("Authorization:
 * Bearer …"). The token is not trusted here — it is forwarded to Firestore,
 * which verifies it and applies the project's security rules, exactly as when
 * the page talked to Firestore itself. This only rejects requests that
 * obviously carry no token, before any Firestore call is made.
 *
 * An interceptor rather than a servlet filter so Spring's CORS handling runs
 * first — a 401 then still carries CORS headers and the page can read it.
 */
@Component
public class FirebaseAuthInterceptor implements HandlerInterceptor {

    public static final String TOKEN_ATTRIBUTE = "firebaseIdToken";

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (CorsUtils.isPreFlightRequest(request)) {
            return true;
        }
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        String token = header != null && header.startsWith("Bearer ") ? header.substring(7).trim() : "";
        // A Firebase ID token is a JWT: three non-empty dot-separated parts.
        if (token.length() > 4096 || !token.matches("[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+")) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing or malformed Firebase ID token");
        }
        request.setAttribute(TOKEN_ATTRIBUTE, token);
        return true;
    }
}
