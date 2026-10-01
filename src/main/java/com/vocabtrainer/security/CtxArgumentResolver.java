package com.vocabtrainer.security;

import java.time.DateTimeException;
import java.time.ZoneId;
import java.time.ZoneOffset;

import com.vocabtrainer.progress.Ctx;
import org.springframework.core.MethodParameter;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.support.WebDataBinderFactory;
import org.springframework.web.context.request.NativeWebRequest;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.method.support.ModelAndViewContainer;
import org.springframework.web.server.ResponseStatusException;

/**
 * Lets controllers take a {@link Ctx}: the caller's Firebase ID token (checked
 * by {@link FirebaseAuthInterceptor}) and their time zone from X-Time-Zone
 * (an IANA name like "Asia/Kolkata"; UTC if missing or unknown).
 */
public class CtxArgumentResolver implements HandlerMethodArgumentResolver {

    public static final String TIME_ZONE_HEADER = "X-Time-Zone";

    @Override
    public boolean supportsParameter(MethodParameter parameter) {
        return Ctx.class.equals(parameter.getParameterType());
    }

    @Override
    public Object resolveArgument(MethodParameter parameter, ModelAndViewContainer mav, NativeWebRequest request,
                                  WebDataBinderFactory binderFactory) {
        Object token = request.getAttribute(FirebaseAuthInterceptor.TOKEN_ATTRIBUTE, RequestAttributes.SCOPE_REQUEST);
        if (!(token instanceof String t)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "missing Firebase ID token");
        }
        return new Ctx(t, zone(request.getHeader(TIME_ZONE_HEADER)));
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
