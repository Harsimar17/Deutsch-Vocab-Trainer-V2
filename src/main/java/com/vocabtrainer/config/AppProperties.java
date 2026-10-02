package com.vocabtrainer.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;

@ConfigurationProperties(prefix = "app")
public record AppProperties(Firebase firebase, String legacyProgressDocId, Cors cors, Vocab vocab, Github github, Auth auth) {

    /** Values from firebaseConfig in index.html, plus the Firestore REST endpoint. */
    public record Firebase(String projectId, String webApiKey, String firestoreBaseUrl) {
    }

    public record Cors(List<String> allowedOrigins) {
    }

    /**
     * Where german_vocab.json is read from: the published URL (as the page used
     * to fetch it), re-checked every refreshInterval, with a bundled copy as the
     * fallback when GitHub can't be reached.
     */
    public record Vocab(String url, Duration refreshInterval, Resource fallback) {
    }

    /** The repo/file "+ Add word" commits to. */
    public record Github(String apiUrl, String owner, String repo, String branch, String path) {
    }

    /**
     * User sessions: the HS256 key for the app's JWT (blank → random per start),
     * how long a session survives without a request, and the key POST /api/users needs.
     */
    public record Auth(String jwtSecret, Duration sessionIdleTimeout, String adminKey) {
    }
}
