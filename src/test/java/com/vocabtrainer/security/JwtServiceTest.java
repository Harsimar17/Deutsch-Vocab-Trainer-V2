package com.vocabtrainer.security;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;

import com.vocabtrainer.config.AppProperties;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class JwtServiceTest {

    private static final String SECRET = "0123456789abcdef0123456789abcdef";

    private static JwtService jwt(String secret, Duration idle) {
        AppProperties props = new AppProperties(null, null, null, null, null, new AppProperties.Auth(secret, idle, null));
        return new JwtService(props, JsonMapper.builder().build());
    }

    @Test
    void roundTripsTheSession() {
        JwtService j = jwt(SECRET, Duration.ofHours(24));
        JwtService.Session s = j.verify(j.issue("uid-1", "a@b.de", "firebase-refresh"));
        assertNotNull(s);
        assertEquals("uid-1", s.uid());
        assertEquals("a@b.de", s.email());
        assertEquals("firebase-refresh", s.firebaseRefreshToken());
        long in24h = System.currentTimeMillis() + Duration.ofHours(24).toMillis();
        assertTrue(Math.abs(s.expiresAt() - in24h) < 5_000);
    }

    @Test
    void theFirebaseRefreshTokenIsNotReadableInTheToken() {
        JwtService j = jwt(SECRET, Duration.ofHours(24));
        String payload = new String(Base64.getUrlDecoder().decode(j.issue("u", "a@b.de", "very-secret-refresh").split("\\.")[1]),
                StandardCharsets.UTF_8);
        assertFalse(payload.contains("very-secret-refresh"));
    }

    @Test
    void rejectsTamperedForeignAndExpiredTokens() {
        JwtService j = jwt(SECRET, Duration.ofHours(24));
        String token = j.issue("uid-1", "a@b.de", "r");
        String[] p = token.split("\\.");
        String otherUser = Base64.getUrlEncoder().withoutPadding().encodeToString(
                new String(Base64.getUrlDecoder().decode(p[1]), StandardCharsets.UTF_8).replace("uid-1", "uid-2")
                        .getBytes(StandardCharsets.UTF_8));
        assertNull(j.verify(p[0] + "." + otherUser + "." + p[2]));
        assertNull(jwt("another-secret-another-secret-xx", Duration.ofHours(24)).verify(token));
        assertNull(jwt(SECRET, Duration.ZERO).verify(jwt(SECRET, Duration.ZERO).issue("uid-1", "a@b.de", "r")));
        assertNull(j.verify("aaa.bbb.ccc"));
        assertNull(j.verify(null));
    }

    @Test
    void reissuingKeepsTheUserAndPushesExpiryOut() {
        JwtService j = jwt(SECRET, Duration.ofHours(24));
        JwtService.Session s = j.verify(j.issue("uid-1", "a@b.de", "r"));
        JwtService.Session again = j.verify(j.reissue(s));
        assertEquals(s.uid(), again.uid());
        assertEquals("r", again.firebaseRefreshToken());
        assertTrue(again.expiresAt() >= s.expiresAt());
    }

    @Test
    void withoutASecretTokensStillWorkWithinOneRun() {
        JwtService j = jwt("", Duration.ofHours(24));
        assertNotNull(j.verify(j.issue("uid-1", "a@b.de", "r")));
    }
}
