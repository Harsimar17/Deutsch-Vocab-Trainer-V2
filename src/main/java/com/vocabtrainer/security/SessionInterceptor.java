package com.vocabtrainer.security;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.cors.CorsUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * Every protected /api call must carry the session JWT ("Authorization: Bearer
 * …"). A valid one is answered with a re-issued token in X-Auth-Token — the
 * client swaps it in, which is what makes the session expire only after the
 * idle timeout without a request.
 *
 * An interceptor rather than a servlet filter so Spring's CORS handling runs
 * first — a 401 then still carries CORS headers and the page can read it.
 */
@Component
public class SessionInterceptor implements HandlerInterceptor {

    public static final String SESSION_ATTRIBUTE = "session";
    public static final String RENEWED_TOKEN_HEADER = "X-Auth-Token";

    private final JwtService jwt;

    public SessionInterceptor(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (CorsUtils.isPreFlightRequest(request)) {
            return true;
        }
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        String token = header != null && header.startsWith("Bearer ") ? header.substring(7).trim() : null;
        JwtService.Session session = jwt.verify(token);
        if (session == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "not logged in or session expired");
        }
        request.setAttribute(SESSION_ATTRIBUTE, session);
        response.setHeader(RENEWED_TOKEN_HEADER, jwt.reissue(session));
        return true;
    }
}
