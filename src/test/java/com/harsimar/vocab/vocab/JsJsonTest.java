package com.harsimar.vocab.vocab;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class JsJsonTest {

    @Test
    void matchesJsonStringifyWithTwoSpaces() {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("de", "die Übung \"x\"\\");
        m.put("n", 3);
        m.put("empty", List.of());
        m.put("obj", Map.of());
        m.put("list", List.of(1, "a"));
        assertEquals("""
                {
                  "de": "die Übung \\"x\\"\\\\",
                  "n": 3,
                  "empty": [],
                  "obj": {},
                  "list": [
                    1,
                    "a"
                  ]
                }""", JsJson.stringify(m));
    }

    /** Parse + write the real file: it must come back byte-identical, so a commit only adds the new word. */
    @Test
    void roundTripsTheRealVocabularyFileUnchanged() throws IOException {
        String original = Files.readString(Path.of("src/main/resources/data/german_vocab.json"), StandardCharsets.UTF_8)
                .replace("\r\n", "\n"); // the working copy may have CRLF on Windows; the repo has LF
        @SuppressWarnings("unchecked")
        Map<String, Object> doc = JsonMapper.builder().build().readValue(original, LinkedHashMap.class);
        assertEquals(original, JsJson.stringify(doc) + "\n");
    }
}
