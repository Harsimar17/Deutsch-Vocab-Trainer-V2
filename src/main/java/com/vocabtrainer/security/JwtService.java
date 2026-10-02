package com.vocabtrainer.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import com.vocabtrainer.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * The app's session token: a JWT signed with HS256. It names the user (sub =
 * Firebase uid, email) and carries their Firebase refresh token, encrypted
 * (AES-GCM), so the backend can get a Firebase ID token for Firestore without
 * keeping any session state — a restart logs nobody out.
 *
 * "exp" is always issue time + the idle timeout, and every authenticated
 * request gets a re-issued token, so a session ends only after that long
 * without a request.
 */
@Component
public class JwtService {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();
    private static final String HEADER = B64.encodeToString("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
    private static final SecureRandom RANDOM = new SecureRandom();

    /** A verified session: who it is and the Firebase refresh token to act as them. */
    public record Session(String uid, String email, String firebaseRefreshToken, long expiresAt) {
    }

    private final SecretKeySpec signKey;
    private final SecretKeySpec encKey;
    private final Duration idle;
    private final JsonMapper json;

    public JwtService(AppProperties props, JsonMapper json) {
        String secret = props.auth().jwtSecret();
        byte[] master;
        if (secret == null || secret.isBlank()) {
            master = new byte[32];
            RANDOM.nextBytes(master);
            log.warn("app.auth.jwt-secret (JWT_SECRET) is not set: using a random key, so sessions end when the app restarts");
        } else {
            if (secret.length() < 32) {
                log.warn("app.auth.jwt-secret is shorter than 32 characters — use a longer random value");
            }
            master = secret.getBytes(StandardCharsets.UTF_8);
        }
        // Separate keys for signing and encrypting, both derived from the one secret.
        this.signKey = new SecretKeySpec(sha256("sign", master), "HmacSHA256");
        this.encKey = new SecretKeySpec(sha256("encrypt", master), "AES");
        this.idle = props.auth().sessionIdleTimeout();
        this.json = json;
    }

    public Duration idleTimeout() {
        return idle;
    }

    public String issue(String uid, String email, String firebaseRefreshToken) {
        long now = System.currentTimeMillis() / 1000;
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("sub", uid);
        claims.put("email", email);
        claims.put("frt", encrypt(firebaseRefreshToken));
        claims.put("iat", now);
        claims.put("exp", now + idle.toSeconds());
        String body = HEADER + "." + B64.encodeToString(json.writeValueAsBytes(claims));
        return body + "." + B64.encodeToString(hmac(body));
    }

    public String reissue(Session s) {
        return issue(s.uid(), s.email(), s.firebaseRefreshToken());
    }

    /** The session in a token, or null if it is malformed, tampered with or expired. */
    public Session verify(String token) {
        if (token == null || token.length() > 8192) {
            return null;
        }
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3 || !HEADER.equals(parts[0])) {
            return null;
        }
        try {
            byte[] sig = B64D.decode(parts[2]);
            if (!MessageDigest.isEqual(sig, hmac(parts[0] + "." + parts[1]))) {
                return null;
            }
            Map<?, ?> c = json.readValue(B64D.decode(parts[1]), Map.class);
            if (!(c.get("sub") instanceof String uid) || !uid.matches("[A-Za-z0-9_-]{1,128}")
                    || !(c.get("exp") instanceof Number exp) || !(c.get("frt") instanceof String frt)) {
                return null;
            }
            if (exp.longValue() * 1000 <= System.currentTimeMillis()) {
                return null;
            }
            return new Session(uid, c.get("email") instanceof String e ? e : null, decrypt(frt), exp.longValue() * 1000);
        } catch (RuntimeException | GeneralSecurityException e) {
            return null;
        }
    }

    // ---- crypto ----

    private byte[] hmac(String data) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(signKey);
            return mac.doFinal(data.getBytes(StandardCharsets.US_ASCII));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private String encrypt(String plain) {
        try {
            byte[] iv = new byte[12];
            RANDOM.nextBytes(iv);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, encKey, new GCMParameterSpec(128, iv));
            byte[] ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            return B64.encodeToString(ByteBuffer.allocate(iv.length + ct.length).put(iv).put(ct).array());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    private String decrypt(String sealed) throws GeneralSecurityException {
        byte[] all = B64D.decode(sealed);
        if (all.length < 12 + 16) {
            throw new GeneralSecurityException("too short");
        }
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE, encKey, new GCMParameterSpec(128, all, 0, 12));
        return new String(c.doFinal(all, 12, all.length - 12), StandardCharsets.UTF_8);
    }

    private static byte[] sha256(String label, byte[] master) {
        try {
            MessageDigest d = MessageDigest.getInstance("SHA-256");
            d.update(label.getBytes(StandardCharsets.UTF_8));
            d.update((byte) 0);
            return d.digest(master);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }
}
