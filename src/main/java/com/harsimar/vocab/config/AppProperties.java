package com.harsimar.vocab.config;

import java.time.Duration;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.core.io.Resource;

@ConfigurationProperties(prefix = "app")
public record AppProperties(Firebase firebase, String progressDocId, Cors cors, Vocab vocab, Github github) {

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
}
