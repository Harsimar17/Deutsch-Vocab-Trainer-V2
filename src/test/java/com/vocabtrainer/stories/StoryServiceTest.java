package com.vocabtrainer.stories;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.TestVocab;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The reader's word lookup over all 45 real stories — same coverage the page had. */
class StoryServiceTest {

    static StoryService stories;

    @BeforeAll
    static void load() {
        stories = TestVocab.stories();
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> allSegments() {
        List<Map<String, Object>> out = new ArrayList<>();
        for (StoryService.Group g : stories.groups()) {
            for (Map<String, Object> s : g.stories()) {
                Map<String, Object> r = stories.reader(StoryService.id(s.get("id")));
                for (Map<String, Object> p : (List<Map<String, Object>>) r.get("paragraphs")) {
                    out.addAll((List<Map<String, Object>>) p.get("segments"));
                }
            }
        }
        return out;
    }

    @Test
    void everyMarkedTargetWordHasAMeaning() {
        List<Map<String, Object>> targets = allSegments().stream().filter(s -> Boolean.TRUE.equals(s.get("target"))).toList();
        List<Object> missing = targets.stream().filter(s -> s.get("entry") == null).map(s -> s.get("w")).toList();
        assertEquals(1495, targets.size());
        assertEquals(List.of(), missing);
    }

    @Test
    void mostOtherWordsHaveAMeaningToo() {
        List<Map<String, Object>> segs = allSegments();
        long known = segs.stream().filter(s -> s.containsKey("w") && !Boolean.TRUE.equals(s.get("target"))).count();
        assertTrue(known >= 7300, "known words: " + known); // the page resolved 7305
    }

    @Test
    void inflectedAndIrregularFormsResolveToTheirDictionaryForm() {
        WordLookup.Dict d = new WordLookup.Dict();
        d.add("geben", "to give", "verb", "A1", null, true);
        d.add("annehmen", "to accept", "verb", "A2", null, true);
        d.add("kündigen", "to resign", "verb", "B1", null, true);
        d.add("meinen", "to mean", "verb", "A2", null, true);
        d.add("je ... desto", "the ... the", "func", "B1", null, false);
        WordLookup l = new WordLookup(List.of(d));
        assertEquals("geben", l.lookup("gibt").head());
        assertEquals("annehmen", l.lookup("annimmt").head());
        assertEquals("kündigen", l.lookup("gekündigt").head());
        assertEquals("mein", l.lookup("Meine").head()); // a possessive, not "meinen"
        assertEquals("je ... desto", l.lookup("desto").head());
    }

    @Test
    void readerViewHasParagraphsTranslationsAndNeighbours() {
        String first = StoryService.id(stories.groups().get(0).stories().get(0).get("id"));
        Map<String, Object> r = stories.reader(first);
        assertNotNull(r.get("titleDe"));
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> paras = (List<Map<String, Object>>) r.get("paragraphs");
        assertTrue(paras.stream().allMatch(p -> p.get("en") != null), "every paragraph has its translation");
        assertEquals(null, stories.neighbours(first).get("prev"));
        assertNotNull(stories.neighbours(first).get("next"));
    }

    @Test
    void phaseWordsAreDeduplicated() {
        assertEquals(List.of(112, 77, 127, 256, 817), stories.groups().stream()
                .map(g -> stories.phaseWords(g.index()).size()).toList());
    }
}
