package com.harsimar.vocab.vocab;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.harsimar.vocab.config.AppProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

class GitHubVocabCommitterTest {

    private static final String API = "https://api.github.test";
    private static final String CONTENTS = API + "/repos/o/r/contents/german_vocab.json";
    private static final String FILE = """
            {
              "levels": {
                "A2": {
                  "nouns": {
                    "der": [
                      {
                        "de": "der Abfall",
                        "article": "der",
                        "word": "Abfall",
                        "en": "waste"
                      }
                    ]
                  },
                  "verbs": []
                }
              },
              "counts": {
                "A2": {
                  "der": 1
                }
              }
            }
            """;

    private MockRestServiceServer server;
    private GitHubVocabCommitter committer;
    private VocabService vocab;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(API);
        server = MockRestServiceServer.bindTo(builder).build();
        vocab = mock(VocabService.class);
        AppProperties props = new AppProperties(null, null, null, null,
                new AppProperties.Github(API, "o", "r", "main", "german_vocab.json"));
        committer = new GitHubVocabCommitter(builder.build(), props, JsonMapper.builder().build(), vocab);
    }

    /** The real file is > 1 MB, so the Contents API returns no inline content: raw fetch, then PUT. */
    @Test
    void commitsTheNewWordOnTopOfTheLatestFile() {
        server.expect(requestTo(CONTENTS + "?ref=main"))
                .andExpect(header("Authorization", "Bearer gh-token"))
                .andRespond(withSuccess("{\"sha\":\"abc123\",\"content\":\"\",\"encoding\":\"none\"}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(CONTENTS + "?ref=main"))
                .andExpect(header("Accept", "application/vnd.github.raw"))
                .andRespond(withSuccess(FILE.getBytes(StandardCharsets.UTF_8), MediaType.parseMediaType("application/vnd.github.raw")));
        AtomicReference<String> putBody = new AtomicReference<>();
        server.expect(requestTo(CONTENTS))
                .andExpect(method(HttpMethod.PUT))
                .andExpect(req -> putBody.set(((MockClientHttpRequest) req).getBodyAsString()))
                .andRespond(withSuccess("{\"commit\":{\"html_url\":\"https://github.com/o/r/commit/1\"}}", MediaType.APPLICATION_JSON));

        GitHubVocabCommitter.CommitResult r = committer.add("gh-token",
                new GitHubVocabCommitter.NewWord("A2", "die", "Mülltonne", "bin", "Die Mülltonne ist voll.", null));
        server.verify();

        assertEquals("https://github.com/o/r/commit/1", r.commitUrl());
        assertEquals("die Mülltonne", r.entry().get("de"));

        @SuppressWarnings("unchecked")
        Map<String, Object> put = JsonMapper.builder().build().readValue(putBody.get(), Map.class);
        assertEquals("abc123", put.get("sha"));
        assertEquals("main", put.get("branch"));
        assertEquals("Add word: die Mülltonne (A2 die)", put.get("message"));
        String committed = new String(Base64.getDecoder().decode((String) put.get("content")), StandardCharsets.UTF_8);
        assertTrue(committed.contains(String.join("\n",
                "        \"die\": [",
                "          {",
                "            \"de\": \"die Mülltonne\",",
                "            \"article\": \"die\",",
                "            \"word\": \"Mülltonne\",",
                "            \"en\": \"bin\",",
                "            \"example\": \"Die Mülltonne ist voll.\"",
                "          }",
                "        ]")), committed);
        assertTrue(committed.contains("\"die\": 1"), "counts updated");
        assertTrue(committed.startsWith(FILE.substring(0, 60)), "rest of the file untouched");
        verify(vocab).replace(committed);
    }

    @Test
    void duplicateIsRejectedWithoutCommitting() {
        server.expect(requestTo(CONTENTS + "?ref=main")).andRespond(withSuccess(
                "{\"sha\":\"s\",\"content\":\"" + Base64.getEncoder().encodeToString(FILE.getBytes(StandardCharsets.UTF_8))
                        + "\",\"encoding\":\"base64\"}", MediaType.APPLICATION_JSON));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> committer.add("t",
                new GitHubVocabCommitter.NewWord("A2", "der", "abfall", "waste", null, null)));
        assertEquals(HttpStatus.CONFLICT, e.getStatusCode());
        assertTrue(e.getReason().contains("already in A2"));
        server.verify(); // no PUT
        verify(vocab, never()).replace(anyString());
    }

    @Test
    void rejectedTokenGetsAReadableMessage() {
        server.expect(requestTo(CONTENTS + "?ref=main")).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> committer.add("t",
                new GitHubVocabCommitter.NewWord("A2", "verb", "abholen", "to pick up", null, null)));
        assertEquals(HttpStatus.UNAUTHORIZED, e.getStatusCode());
        assertTrue(e.getReason().contains("GitHub rejected the token"));
    }

    @Test
    void missingTokenOrBadInputNeverReachesGitHub() {
        assertThrows(ResponseStatusException.class, () -> committer.add("",
                new GitHubVocabCommitter.NewWord("A2", "verb", "x", "y", null, null)));
        assertThrows(ResponseStatusException.class, () -> committer.add("t",
                new GitHubVocabCommitter.NewWord("C2", "verb", "x", "y", null, null)));
        assertThrows(ResponseStatusException.class, () -> committer.add("t",
                new GitHubVocabCommitter.NewWord("A2", "der", "der ", "y", null, null)));
        server.verify();
    }

    @Test
    void entriesKeepTheFileFieldOrder() {
        assertEquals(List.of("de", "en", "prefix", "example"), List.copyOf(GitHubVocabCommitter.buildEntry(
                new GitHubVocabCommitter.NewWord("B1", "sep", "vorbereiten", "to prepare", "Ich bereite vor.", " VOR ")).keySet()));
        assertEquals("vor", GitHubVocabCommitter.buildEntry(
                new GitHubVocabCommitter.NewWord("B1", "sep", "vorbereiten", "to prepare", null, " VOR ")).get("prefix"));
        assertEquals("ueben", GitHubVocabCommitter.normDe("Üben."));
    }
}
