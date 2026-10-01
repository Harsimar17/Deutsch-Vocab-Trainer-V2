package com.harsimar.vocab.progress;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import java.util.Map;

import com.harsimar.vocab.config.AppProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

/** Checks the exact REST calls sent to Firestore, against a mock server. */
class ProgressRepositoryTest {

    private static final String BASE = "https://firestore.test/v1";
    private static final String DOCS = BASE + "/projects/p1/databases/(default)/documents";
    private static final String DOC = DOCS + "/scores/progress-1";
    private static final String TOKEN = "aaa.bbb.ccc";

    private MockRestServiceServer server;
    private ProgressRepository repo;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(BASE);
        server = MockRestServiceServer.bindTo(builder).build();
        AppProperties props = new AppProperties(
                new AppProperties.Firebase("p1", "web-key", BASE), "progress-1", new AppProperties.Cors(List.of()), null, null);
        repo = new ProgressRepository(builder.build(), props);
    }

    @Test
    void loadsAndDecodesTheProgressDocumentWithTheCallersToken() {
        server.expect(requestTo(DOC + "?key=web-key"))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer " + TOKEN))
                .andRespond(withSuccess("""
                        {"name":"x","fields":{"right":{"integerValue":"9957"},"total":{"integerValue":"10747"},
                         "srs":{"mapValue":{"fields":{"B1|der|der Hund":{"mapValue":{"fields":{"box":{"integerValue":"2"}}}}}}}}}
                        """, MediaType.APPLICATION_JSON));
        Map<String, Object> d = repo.load(TOKEN);
        assertEquals(9957L, d.get("right"));
        assertEquals(Map.of("B1|der|der Hund", Map.of("box", 2L)), d.get("srs"));
        server.verify();
    }

    @Test
    void missingDocumentLoadsAsEmpty() {
        server.expect(requestTo(DOC + "?key=web-key")).andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertTrue(repo.load(TOKEN).isEmpty());
    }

    @Test
    void firestoreRefusalIsPassedThroughAsTheSameStatus() {
        server.expect(requestTo(DOC + "?key=web-key")).andRespond(withStatus(HttpStatus.FORBIDDEN));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> repo.load(TOKEN));
        assertEquals(HttpStatus.FORBIDDEN, e.getStatusCode());
    }

    @Test
    void serverErrorBecomesStorageFailure() {
        server.expect(requestTo(DOC + "?key=web-key")).andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));
        assertThrows(FirestoreAccessException.class, () -> repo.load(TOKEN));
    }

    @Test
    void writeOnlyTouchesTheListedPaths() {
        server.expect(requestTo(DOCS + ":commit?key=web-key"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer " + TOKEN))
                .andExpect(content().json("""
                        {"writes":[{"update":{"name":"projects/p1/databases/(default)/documents/scores/progress-1",
                          "fields":{"srs":{"mapValue":{"fields":{"B1|der|der Hund":{"mapValue":{"fields":{"box":{"integerValue":"3"}}}}}}},
                                    "daily":{"mapValue":{"fields":{"reviewed":{"integerValue":"1"}}}}}},
                          "updateMask":{"fieldPaths":["srs.`B1|der|der Hund`","daily"]}}]}
                        """, true))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        repo.write(TOKEN, List.of(
                ProgressRepository.FieldWrite.set(Map.of("box", 3), "srs", "B1|der|der Hund"),
                ProgressRepository.FieldWrite.set(Map.of("reviewed", 1), "daily")), null);
        server.verify();
    }

    @Test
    void deletingAMapEntryMasksItWithoutAValue() {
        server.expect(requestTo(DOCS + ":commit?key=web-key"))
                .andExpect(content().json("""
                        {"writes":[{"update":{"name":"projects/p1/databases/(default)/documents/scores/progress-1","fields":{}},
                          "updateMask":{"fieldPaths":["mistakes.`A2|die|die Etikette`"]}}]}
                        """, true))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        repo.write(TOKEN, List.of(ProgressRepository.FieldWrite.delete("mistakes", "A2|die|die Etikette")), null);
        server.verify();
    }

    @Test
    void answerUsesServerSideIncrements() {
        server.expect(requestTo(DOCS + ":commit?key=web-key"))
                .andExpect(content().json("""
                        {"writes":[{"update":{"name":"projects/p1/databases/(default)/documents/scores/progress-1","fields":{}},
                          "updateMask":{"fieldPaths":[]},
                          "updateTransforms":[{"fieldPath":"right","increment":{"integerValue":"0"}},
                                              {"fieldPath":"total","increment":{"integerValue":"1"}}]}]}
                        """, true))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        Map<String, Long> inc = new java.util.LinkedHashMap<>();
        inc.put("right", 0L);
        inc.put("total", 1L);
        repo.write(TOKEN, List.of(), inc);
        server.verify();
    }

    @Test
    void recentSessionsRunsAnOrderedQuery() {
        server.expect(requestTo(DOC + ":runQuery?key=web-key"))
                .andExpect(content().json("""
                        {"structuredQuery":{"from":[{"collectionId":"sessions"}],
                          "orderBy":[{"field":{"fieldPath":"timestamp"},"direction":"DESCENDING"}],"limit":15}}
                        """, true))
                .andRespond(withSuccess("""
                        [{"document":{"name":"projects/p1/databases/(default)/documents/scores/progress-1/sessions/abc",
                          "fields":{"right":{"integerValue":"3"},"total":{"integerValue":"4"}}}},
                         {"readTime":"2026-10-01T00:00:00Z"}]
                        """, MediaType.APPLICATION_JSON));
        List<Map<String, Object>> list = repo.recentSessions(TOKEN, 15);
        assertEquals(1, list.size());
        assertEquals("abc", list.get(0).get("id"));
        assertEquals(3L, list.get(0).get("right"));
    }

    @Test
    void sentenceDocumentsLiveUnderTheProgressDocument() {
        String id = ProgressRepository.sentenceId("die Beziehung");
        server.expect(requestTo(DOC + "/aiSentences/" + id + "?key=web-key")).andRespond(withStatus(HttpStatus.NOT_FOUND));
        assertNull(repo.sentence(TOKEN, "die Beziehung"));
    }

    @Test
    void sentenceIdsAreStableAndFirestoreSafe() {
        String id = ProgressRepository.sentenceId("der Hund / die Hündin");
        assertEquals(id, ProgressRepository.sentenceId("der Hund / die Hündin"));
        assertTrue(id.matches("[0-9a-f]{64}"));
    }
}
