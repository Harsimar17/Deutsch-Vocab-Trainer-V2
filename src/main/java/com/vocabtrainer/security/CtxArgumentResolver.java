package com.vocabtrainer.security;

import java.time.DateTimeException;
import java.time.ZoneId;
import java.time.ZoneOffset;

import com.vocabtrainer.model.Ctx;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.server.ResponseStatusException;

/**
 * Lets controllers take a {@link Ctx}: the logged-in user (checked by
 * {@link SessionInterceptor}), a Firebase ID token to act as them in Firestore,
 * and their time zone from X-Time-Zone (an IANA name like "Asia/Kolkata"; UTC
 * if missing or unknown).
 */
public class CtxArgumentResolver implements HandlerMethodArgumentResolver {

    public static final String TIME_ZONE_HEADER = "X-Time-Zone";

    private final IdTokenCache idTokens;

    public CtxArgumentResolver(IdTokenCache idTokens) {
        this.idTokens = idTokens;
    }

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return Ctx.class.equals(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mav, NativeWebRequest request,
                                  WebDataBinderFactory binderFactory) {
        Object s = request.getAttribute(SessionInterceptor.SESSION_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        if (!(s instanceof JwtService.Session session)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "not logged in");
        }
        String idToken = idTokens.idToken(session.uid(), session.firebaseRefreshToken());
        return new Ctx(session.uid(), idToken, zone(request.getHeader(TIME_ZONE_HEADER)));
    }

    static ZoneId zone(String header) {
        if (header == null || header.isBlank() || header.length() > 64) {
            return ZoneOffset.UTC;
        }
        try {
            return ZoneId.of(header.trim());
        } catch (DateTimeException e) {
            return ZoneOffset.UTC;
        }
    }
}
