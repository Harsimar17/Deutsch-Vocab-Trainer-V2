package com.vocabtrainer.vocab;

import java.nio.charset.StandardCharsets;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;

/**
 * The vocabulary + stories the page renders (read from GitHub by VocabService),
 * and "+ Add word", which commits to that file on GitHub.
 */
@RestController
public class VocabController {

    public static final String GITHUB_TOKEN_HEADER = "X-GitHub-Token";

    private final VocabService vocab;
    private final GitHubVocabCommitter committer;

    public VocabController(VocabService vocab, GitHubVocabCommitter committer) {
        this.vocab = vocab;
        this.committer = committer;
    }

    /** Public — the same data as the public repo. ETag lets the browser revalidate cheaply. */
    @GetMapping(value = "/api/vocab", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<byte[]> vocab(WebRequest request) {
        VocabService.Snapshot s = vocab.current();
        if (request.checkNotModified(s.etag())) {
            return null; // 304
        }
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noCache())
                .eTag(s.etag())
                .header("X-Vocab-Source", s.source())
                .contentType(new MediaType(MediaType.APPLICATION_JSON, StandardCharsets.UTF_8))
                .body(s.json());
    }

    /**
     * Adds one word and commits german_vocab.json on GitHub. Needs the page's
     * Firebase token (like every non-public call) and the GitHub token in
     * X-GitHub-Token, used for this one commit and never stored.
     */
    @PostMapping("/api/vocab/words")
    public GitHubVocabCommitter.CommitResult addWord(
            @RequestHeader(name = GITHUB_TOKEN_HEADER, required = false) String githubToken,
            @RequestBody GitHubVocabCommitter.NewWord word) {
        return committer.add(githubToken, word);
    }
}
