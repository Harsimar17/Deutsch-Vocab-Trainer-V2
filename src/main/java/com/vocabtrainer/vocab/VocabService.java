package com.vocabtrainer.vocab;

import java.io.IOException;
import java.io.InputStream;
import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.util.HexFormat;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;

import com.vocabtrainer.config.AppProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * german_vocab.json, read from GitHub — the same published URL the page used
 * to fetch — and kept in memory. Re-checked in the background every
 * refresh-interval (a cheap conditional request), so edits pushed to GitHub
 * show up without restarting. If GitHub can't be reached at start-up, the
 * copy bundled into the jar is served until it can.
 */
@Service
public class VocabService {

    private static final Logger log = LoggerFactory.getLogger(VocabService.class);
    /** After a commit from this app, GitHub Pages needs a minute or so to republish the file. */
    private static final Duration AFTER_COMMIT_HOLD = Duration.ofMinutes(10);

    /** The bytes served by GET /api/vocab, plus where they came from. */
    public record Snapshot(byte[] json, String etag, String source) {
    }

    private final RestClient http;
    private final AppProperties.Vocab cfg;
    private final AtomicBoolean refreshing = new AtomicBoolean();
    private volatile Snapshot current;
    private volatile String remoteEtag;
    private volatile long nextCheck;

    @Autowired
    public VocabService(AppProperties props) {
        this(defaultClient(), props);
    }

    VocabService(RestClient http, AppProperties props) {
        this.http = http;
        this.cfg = props.vocab();
        try {
            refreshNow();
        } catch (RuntimeException e) {
            log.warn("Couldn't fetch {} ({}); serving the bundled copy until it can be reached", cfg.url(), e.getMessage());
        }
        if (current == null) {
            this.current = snapshot(readFallback(), "bundled copy");
            this.nextCheck = 0; // try GitHub again on the next request
        }
    }

    /** Current vocabulary; kicks off a background re-check when it's due. */
    public Snapshot current() {
        if (System.currentTimeMillis() >= nextCheck && refreshing.compareAndSet(false, true)) {
            CompletableFuture.runAsync(() -> {
                try {
                    refreshNow();
                } catch (RuntimeException e) {
                    log.warn("Vocab refresh from {} failed: {}", cfg.url(), e.getMessage());
                } finally {
                    refreshing.set(false);
                }
            });
        }
        return current;
    }

    /** One conditional GET of the published file; replaces the cache only if it changed. */
    void refreshNow() {
        nextCheck = System.currentTimeMillis() + cfg.refreshInterval().toMillis();
        String sentEtag = remoteEtag;
        ResponseEntity<byte[]> res = http.get()
                .uri(cfg.url())
                .headers(h -> {
                    if (sentEtag != null && current != null) {
                        h.setIfNoneMatch(sentEtag);
                    }
                })
                .retrieve()
                .toEntity(byte[].class);
        if (res.getStatusCode().isSameCodeAs(HttpStatus.NOT_MODIFIED)) {
            return;
        }
        byte[] body = res.getBody();
        if (body == null || body.length == 0) {
            throw new IllegalStateException("empty response");
        }
        this.remoteEtag = res.getHeaders().getFirst(HttpHeaders.ETAG);
        this.current = snapshot(body, cfg.url());
        log.info("Loaded vocabulary from {} ({} bytes)", cfg.url(), body.length);
    }

    /**
     * After "+ Add word" commits, serve the committed file at once — and don't
     * let a re-check pull the not-yet-republished old copy back in for a while.
     */
    public void replace(String committedJson) {
        this.current = snapshot(committedJson.getBytes(StandardCharsets.UTF_8), "latest commit");
        this.remoteEtag = null;
        this.nextCheck = System.currentTimeMillis()
                + Math.max(cfg.refreshInterval().toMillis(), AFTER_COMMIT_HOLD.toMillis());
    }

    private byte[] readFallback() {
        try (InputStream in = cfg.fallback().getInputStream()) {
            return in.readAllBytes();
        } catch (IOException e) {
            throw new IllegalStateException("No vocabulary: " + cfg.url() + " unreachable and no bundled copy", e);
        }
    }

    private static Snapshot snapshot(byte[] json, String source) {
        return new Snapshot(json, "\"" + sha256(json).substring(0, 16) + "\"", source);
    }

    private static String sha256(byte[] data) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static RestClient defaultClient() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NORMAL)
                .build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(client);
        factory.setReadTimeout(Duration.ofSeconds(30));
        return RestClient.builder().requestFactory(factory).build();
    }
}
