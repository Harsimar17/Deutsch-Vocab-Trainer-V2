package com.vocabtrainer.vocab;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.time.Duration;

import com.vocabtrainer.config.AppProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class VocabServiceTest {

    private static final String URL = "https://pages.test/german_vocab.json";

    private RestClient.Builder builder;
    private MockRestServiceServer server;
    private AppProperties props;

    @BeforeEach
    void setUp() {
        builder = RestClient.builder();
        server = MockRestServiceServer.bindTo(builder).build();
        props = new AppProperties(null, null, null,
                new AppProperties.Vocab(URL, Duration.ofMinutes(5), new ByteArrayResource("{\"bundled\":true}".getBytes())),
                null);
    }

    private static String text(VocabService s) {
        return new String(s.current().json(), StandardCharsets.UTF_8);
    }

    @Test
    void readsTheVocabularyFromGitHub() {
        HttpHeaders h = new HttpHeaders();
        h.setETag("\"v1\"");
        server.expect(requestTo(URL)).andRespond(withSuccess("{\"from\":\"github\"}", MediaType.APPLICATION_JSON).headers(h));
        VocabService s = new VocabService(builder.build(), props);
        assertEquals("{\"from\":\"github\"}", text(s));
        assertEquals(URL, s.current().source());
    }

    @Test
    void reChecksWithTheETagAndKeepsTheCopyWhenUnchanged() {
        HttpHeaders h = new HttpHeaders();
        h.setETag("\"v1\"");
        server.expect(requestTo(URL)).andRespond(withSuccess("{\"v\":1}", MediaType.APPLICATION_JSON).headers(h));
        server.expect(requestTo(URL)).andExpect(header("If-None-Match", "\"v1\"")).andRespond(withStatus(HttpStatus.NOT_MODIFIED));
        VocabService s = new VocabService(builder.build(), props);
        s.refreshNow();
        server.verify();
        assertEquals("{\"v\":1}", text(s));
    }

    @Test
    void fallsBackToTheBundledCopyWhenGitHubIsDown() {
        server.expect(requestTo(URL)).andRespond(withServerError());
        VocabService s = new VocabService(builder.build(), props);
        assertEquals("{\"bundled\":true}", text(s));
        assertEquals("bundled copy", s.current().source());
    }

    @Test
    void aCommittedFileIsServedImmediately() {
        server.expect(requestTo(URL)).andRespond(withSuccess("{\"v\":1}", MediaType.APPLICATION_JSON));
        VocabService s = new VocabService(builder.build(), props);
        s.replace("{\"v\":2}\n");
        assertEquals("{\"v\":2}\n", text(s)); // and no re-check is due, so no further request
        server.verify();
    }
}
