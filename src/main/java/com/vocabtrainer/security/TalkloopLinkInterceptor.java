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
 * Talkloop's calls (learnt words, mistake log) carry a Talkloop link ("Authorization:
 * Bearer …", see {@link JwtService#issueLink}) instead of a session. It sets the
 * same request attribute as {@link SessionInterceptor}, so controllers can take
 * a Ctx as usual, but nothing is renewed: a link simply runs out.
 */
@Component
public class TalkloopLinkInterceptor implements HandlerInterceptor {

    private final JwtService jwt;

    public TalkloopLinkInterceptor(JwtService jwt) {
        this.jwt = jwt;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        if (CorsUtils.isPreFlightRequest(request)) {
            return true;
        }
        String header = request.getHeader(HttpHeaders.AUTHORIZATION);
        String token = header != null && header.startsWith("Bearer ") ? header.substring(7).trim() : null;
        JwtService.Session link = jwt.verifyLink(token);
        if (link == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Talkloop link missing or expired: link again from the vocab trainer");
        }
        request.setAttribute(SessionInterceptor.SESSION_ATTRIBUTE, link);
        return true;
    }
}
