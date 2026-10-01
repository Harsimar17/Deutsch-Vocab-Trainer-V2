package com.harsimar.vocab.progress;

import static com.harsimar.vocab.progress.FirestoreValues.decodeFields;
import static com.harsimar.vocab.progress.FirestoreValues.encode;
import static com.harsimar.vocab.progress.FirestoreValues.encodeFields;
import static com.harsimar.vocab.progress.FirestoreValues.fieldPath;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.harsimar.vocab.config.AppProperties;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Repository;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

/**
 * All persistence for the trainer, through the Firestore REST API. Every call
 * is made with the caller's Firebase ID token, so Firestore verifies it and
 * applies the project's security rules — no service-account key involved.
 *
 * One shared document, scores/{progressDocId}, holds the learner's state (the
 * same document the page wrote to directly before). Quiz rounds live in its
 * "sessions" subcollection and generated example sentences in its
 * "aiSentences" subcollection — under the same document, so the same rules
 * that let the page write "sessions" cover them.
 */
@Repository
public class ProgressRepository {

    private static final ParameterizedTypeReference<Map<String, Object>> MAP = new ParameterizedTypeReference<>() {
    };
    private static final ParameterizedTypeReference<List<Map<String, Object>>> LIST_OF_MAPS =
            new ParameterizedTypeReference<>() {
            };

    private final RestClient http;
    private final String apiKey;
    private final String documentsRoot; // projects/{p}/databases/(default)/documents
    private final String progressName;  // …/documents/scores/{doc}

    public ProgressRepository(RestClient firestoreRestClient, AppProperties props) {
        this.http = firestoreRestClient;
        this.apiKey = props.firebase().webApiKey();
        this.documentsRoot = "projects/" + props.firebase().projectId() + "/databases/(default)/documents";
        this.progressName = documentsRoot + "/scores/" + props.progressDocId();
    }

    // ---- the progress document ----

    public Map<String, Object> load(String token) {
        Map<String, Object> doc = getDocument(token, progressName);
        return doc == null ? new HashMap<>() : fieldsOf(doc);
    }

    /** One field change: set path = value, or delete path. */
    public record FieldWrite(List<String> path, Object value, boolean delete) {

        public static FieldWrite set(Object value, String... path) {
            return new FieldWrite(List.of(path), value, false);
        }

        public static FieldWrite delete(String... path) {
            return new FieldWrite(List.of(path), null, true);
        }
    }

    /**
     * Applies field changes (and server-side increments) to the progress document
     * in one commit. Only the listed paths are touched; a path that is listed but
     * absent from the data is deleted — that's how the Firestore update mask works.
     */
    public void write(String token, List<FieldWrite> writes, Map<String, Long> increments) {
        Map<String, Object> data = new LinkedHashMap<>();
        List<String> mask = new ArrayList<>();
        for (FieldWrite w : writes) {
            mask.add(fieldPath(w.path().toArray(String[]::new)));
            if (!w.delete()) {
                putPath(data, w.path(), w.value());
            }
        }
        Map<String, Object> write = update(progressName, data, mask);
        if (increments != null && !increments.isEmpty()) {
            List<Map<String, Object>> transforms = new ArrayList<>();
            increments.forEach((field, by) -> transforms.add(
                    Map.of("fieldPath", fieldPath(field), "increment", Map.of("integerValue", String.valueOf(by)))));
            write.put("updateTransforms", transforms);
        }
        commit(token, List.of(write));
    }

    @SuppressWarnings("unchecked")
    static void putPath(Map<String, Object> root, List<String> path, Object value) {
        Map<String, Object> m = root;
        for (int i = 0; i < path.size() - 1; i++) {
            m = (Map<String, Object>) m.computeIfAbsent(path.get(i), k -> new LinkedHashMap<>());
        }
        m.put(path.get(path.size() - 1), value);
    }

    // ---- quiz rounds ----

    public List<Map<String, Object>> recentSessions(String token, int limit) {
        Map<String, Object> query = Map.of("structuredQuery", Map.of(
                "from", List.of(Map.of("collectionId", "sessions")),
                "orderBy", List.of(Map.of("field", Map.of("fieldPath", "timestamp"), "direction", "DESCENDING")),
                "limit", limit));
        List<Map<String, Object>> rows = call(() -> http.post()
                .uri("/" + progressName + ":runQuery?key={key}", apiKey)
                .headers(h -> h.setBearerAuth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .body(query)
                .retrieve()
                .body(LIST_OF_MAPS));
        List<Map<String, Object>> out = new ArrayList<>();
        if (rows != null) {
            for (Map<String, Object> row : rows) {
                if (row.get("document") instanceof Map<?, ?> d) {
                    @SuppressWarnings("unchecked")
                    Map<String, Object> doc = (Map<String, Object>) d;
                    Map<String, Object> m = fieldsOf(doc);
                    m.put("id", lastSegment((String) doc.get("name")));
                    out.add(m);
                }
            }
        }
        return out;
    }

    public void addSession(String token, Map<String, Object> session) {
        call(() -> http.post()
                .uri("/" + progressName + "/sessions?key={key}", apiKey)
                .headers(h -> h.setBearerAuth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("fields", encodeFields(session)))
                .retrieve()
                .toBodilessEntity());
    }

    public void clearSessions(String token) {
        List<String> names = new ArrayList<>();
        String pageToken = "";
        do {
            String pt = pageToken;
            Map<String, Object> page = call(() -> http.get()
                    .uri("/" + progressName + "/sessions?pageSize=300&mask.fieldPaths=timestamp&pageToken={pt}&key={key}",
                            pt, apiKey)
                    .headers(h -> h.setBearerAuth(token))
                    .retrieve()
                    .body(MAP));
            if (page != null && page.get("documents") instanceof List<?> docs) {
                docs.forEach(d -> names.add((String) ((Map<?, ?>) d).get("name")));
            }
            pageToken = page != null && page.get("nextPageToken") != null ? (String) page.get("nextPageToken") : "";
        } while (!pageToken.isEmpty());
        // A commit takes at most 500 writes.
        for (int i = 0; i < names.size(); i += 450) {
            commit(token, names.subList(i, Math.min(i + 450, names.size())).stream()
                    .<Map<String, Object>>map(n -> Map.of("delete", n)).toList());
        }
    }

    // ---- cached example sentences ----

    public Map<String, Object> sentence(String token, String word) {
        Map<String, Object> doc = getDocument(token, progressName + "/aiSentences/" + sentenceId(word));
        return doc == null ? null : fieldsOf(doc);
    }

    public void saveSentence(String token, String word, String de, String en) {
        Map<String, Object> data = Map.of("word", word, "de", de, "en", en, "createdAt", System.currentTimeMillis());
        // No update mask: the whole document is written (created or replaced).
        commit(token, List.of(update(progressName + "/aiSentences/" + sentenceId(word), data, null)));
    }

    /** Words can contain "/" and other characters Firestore ids can't — hash them. */
    static String sentenceId(String word) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(word.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- REST plumbing ----
    // Document names go into the URL literally: as URI *variables* their "/"
    // would be percent-encoded and Firestore would see a different path.

    private Map<String, Object> getDocument(String token, String name) {
        try {
            return call(() -> http.get()
                    .uri("/" + name + "?key={key}", apiKey)
                    .headers(h -> h.setBearerAuth(token))
                    .retrieve()
                    .body(MAP));
        } catch (NotFound e) {
            return null;
        }
    }

    private Map<String, Object> update(String name, Map<String, ?> data, List<String> mask) {
        Map<String, Object> write = new LinkedHashMap<>();
        write.put("update", Map.of("name", name, "fields", encodeFields(data)));
        if (mask != null) {
            write.put("updateMask", Map.of("fieldPaths", mask));
        }
        return write;
    }

    private void commit(String token, List<Map<String, Object>> writes) {
        call(() -> http.post()
                .uri("/" + documentsRoot + ":commit?key={key}", apiKey)
                .headers(h -> h.setBearerAuth(token))
                .contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("writes", writes))
                .retrieve()
                .toBodilessEntity());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> fieldsOf(Map<String, Object> doc) {
        return decodeFields((Map<String, Object>) doc.get("fields"));
    }

    private static String lastSegment(String name) {
        return name == null ? null : name.substring(name.lastIndexOf('/') + 1);
    }

    /** Marker for a 404 on a document read (an absent document is not an error). */
    private static final class NotFound extends RuntimeException {
        NotFound() {
            super(null, null, false, false);
        }
    }

    private interface Call<T> {
        T run();
    }

    /**
     * Firestore's verdict on the token / rules is passed through (401, 403);
     * anything else is reported as a storage failure (502).
     */
    private static <T> T call(Call<T> c) {
        try {
            return c.run();
        } catch (RestClientResponseException e) {
            int status = e.getStatusCode().value();
            if (status == 404) {
                throw new NotFound();
            }
            if (status == 401 || status == 403) {
                throw new ResponseStatusException(HttpStatus.valueOf(status),
                        "Firestore refused the request (" + status + ") — token expired or security rules deny it");
            }
            throw new FirestoreAccessException("Firestore returned " + status + ": " + e.getResponseBodyAsString(), e);
        } catch (ResourceAccessException e) {
            throw new FirestoreAccessException("Firestore unreachable: " + e.getMessage(), e);
        }
    }
}
