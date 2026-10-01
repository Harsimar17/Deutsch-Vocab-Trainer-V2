package com.vocabtrainer.progress;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class FirestoreValuesTest {

    @Test
    void encodesScalarsAndNesting() {
        assertEquals(Map.of("integerValue", "5"), FirestoreValues.encode(5));
        assertEquals(Map.of("integerValue", "1790802246844"), FirestoreValues.encode(1790802246844L));
        assertEquals(Map.of("doubleValue", 2.5), FirestoreValues.encode(2.5));
        assertEquals(Map.of("integerValue", "3"), FirestoreValues.encode(3.0));
        assertEquals(Map.of("stringValue", "die Beziehung"), FirestoreValues.encode("die Beziehung"));
        assertEquals(Map.of("booleanValue", true), FirestoreValues.encode(true));
        assertEquals(Map.of("mapValue", Map.of("fields", Map.of("r", Map.of("integerValue", "2")))),
                FirestoreValues.encode(Map.of("r", 2)));
        assertEquals(Map.of("arrayValue", Map.of("values", List.of(Map.of("stringValue", "der")))),
                FirestoreValues.encode(List.of("der")));
    }

    @Test
    void roundTripsAPhaseTestState() {
        Map<String, Object> words = new LinkedHashMap<>();
        words.put("der Kollegenkreis", Map.of("r", 0L, "p", 1L, "miss", 1L));
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("words", words);
        state.put("passed", null);
        state.put("updated", 1790802246844L);
        Object encoded = FirestoreValues.encode(state);
        assertEquals(state, FirestoreValues.decode(encoded));
    }

    @Test
    void decodesEmptyMapsAndArrays() {
        assertEquals(Map.of(), FirestoreValues.decode(Map.of("mapValue", Map.of())));
        assertEquals(List.of(), FirestoreValues.decode(Map.of("arrayValue", Map.of())));
    }

    @Test
    void quotesFieldPathSegmentsThatAreNotPlainIdentifiers() {
        assertEquals("srs", FirestoreValues.fieldPath("srs"));
        assertEquals("phaseTests.`2`", FirestoreValues.fieldPath("phaseTests", "2"));
        assertEquals("srs.`B1|der|der Hund / die Hündin`", FirestoreValues.fieldPath("srs", "B1|der|der Hund / die Hündin"));
        assertEquals("mistakes.`a\\`b`", FirestoreValues.fieldPath("mistakes", "a`b"));
        assertEquals("srs.`A2|phrase|Ich finde, dass ...`", FirestoreValues.fieldPath("srs", "A2|phrase|Ich finde, dass ..."));
    }
}
