package com.vocabtrainer.service.drill;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.TestVocab;
import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.CardCatalog;
import com.vocabtrainer.service.PhaseTestService;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.service.StoryService;
import org.junit.jupiter.api.Test;

class DrillsTest {

    private final CardCatalog catalog = TestVocab.catalog();
    private final Ctx ctx = TestVocab.ctx();

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> options(Map<String, Object> view) {
        return (List<Map<String, Object>>) view.get("options");
    }

    @SuppressWarnings("unchecked")
    private static String cardKey(Map<String, Object> view) {
        return (String) ((Map<String, Object>) view.get("card")).get("key");
    }

    @Test
    void quizWithoutRepeatsAsksEveryWordOnceThenFinishes() {
        ProgressService p = TestVocab.progress();
        List<Card> pool = catalog.pool(List.of("A1"), List.of("phrase")).subList(0, 6);
        QuizDrill q = new QuizDrill(pool, List.of("phrase"), "de-en", true, p);
        java.util.Set<String> seen = new java.util.HashSet<>();
        for (int i = 0; i < 6; i++) {
            Map<String, Object> v = q.view(ctx);
            assertEquals(4, options(v).size());
            assertNull(v.get("correctKey"), "the answer isn't marked before picking");
            seen.add(cardKey(v));
            q.act(ctx, "answer", Map.of("key", options(v).get(0).get("key")));
            assertNotNull(q.view(ctx).get("correctKey"));
            q.act(ctx, "next", Map.of());
        }
        assertEquals(6, seen.size());
        assertEquals(true, q.view(ctx).get("done"));
        assertEquals(Map.of("right", 0L, "total", 6L), Map.of("right", 0L, "total", p.allTime(ctx)[1]));
    }

    @Test
    void studyBringsAgainCardsBackAndPausesEveryFifthCard() {
        ProgressService p = TestVocab.progress();
        List<Card> pool = catalog.pool(List.of("A1"), List.of("verb"));
        StudyDrill s = new StudyDrill(ctx, pool, "due", "de-en", p);
        Map<String, Object> v = s.view(ctx);
        assertEquals("card", v.get("state"));
        assertEquals(12, v.get("total"), "today's 12 new words");
        assertEquals(true, v.get("isNew"));
        s.act(ctx, "grade", Map.of("grade", "again"));
        assertEquals(13, s.view(ctx).get("total"), "the missed card comes back at the end");
        for (int i = 0; i < 4; i++) {
            s.act(ctx, "grade", Map.of("grade", "good"));
        }
        assertEquals("sentenceBreak", s.view(ctx).get("state"));
        s.act(ctx, "continue", Map.of());
        assertEquals("card", s.view(ctx).get("state"));
        assertEquals(5L, p.daily(ctx).get("reviewed"));
    }

    @Test
    void writeChecksTheTypedGermanAndGrades() {
        ProgressService p = TestVocab.progress();
        Card c = catalog.pool(List.of("A1"), List.of("der")).get(0);
        WriteDrill w = new WriteDrill(ctx, List.of(c), "all", p);
        assertNull(w.view(ctx).get("card"), "the German isn't sent before answering");
        w.act(ctx, "check", Map.of("input", c.de()));
        assertEquals("correct", w.view(ctx).get("verdict"));
        assertEquals(2L, p.srs(ctx).get(c.key()).get("box"));
        w.act(ctx, "next", Map.of());
        assertEquals("roundDone", w.view(ctx).get("state"));
    }

    @Test
    @SuppressWarnings("unchecked")
    void phaseTestRelearnsMissesAndPassesAfterTwoCleanRounds() {
        Map<String, Object> doc = new LinkedHashMap<>();
        ProgressService p = TestVocab.progress(doc);
        StoryService stories = TestVocab.stories();
        PhaseTestService tests = new PhaseTestService(p, stories);
        String idx = stories.groups().get(1).index(); // phase 2: 77 words
        List<StoryService.PhaseWord> words = stories.phaseWords(idx);
        Map<String, Card> byDe = new LinkedHashMap<>();
        words.forEach(w -> byDe.put(w.card().de(), w.card()));
        Map<String, List<Card>> byEn = new LinkedHashMap<>();
        words.forEach(w -> byEn.computeIfAbsent(w.card().en(), k -> new java.util.ArrayList<>()).add(w.card()));

        // first round: miss the first question on purpose
        PhaseDrill d = new PhaseDrill(ctx, idx, PhaseTestService.WORDS, false, tests);
        Map<String, Object> v = d.view(ctx);
        int total = (int) v.get("total");
        d.act(ctx, "choose", Map.of("key", options(v).stream()
                .map(o -> (String) o.get("key")).filter(k -> !k.equals(v.get("prompt"))).findFirst().orElseThrow()));
        assertEquals(total + 1, d.view(ctx).get("total"), "the miss is re-asked later in the round");
        assertEquals(1L, ((Map<String, Object>) PhaseTestService.words(tests.state(ctx, idx)).get(v.get("prompt"))).get("miss"));

        int guard = 0;
        Map<String, Object> cur = d.view(ctx);
        while (!"finished".equals(cur.get("state")) && guard++ < 200) {
            if (cur.get("answer") == null) {
                answerCorrectly(d, cur, byEn);
            }
            d.act(ctx, "next", Map.of());
            cur = d.view(ctx);
        }
        assertEquals("finished", cur.get("state"));
        assertEquals(false, cur.get("passedNow"));

        // keep playing clean rounds until every word is mastered in both directions
        int rounds = 1;
        while (!Boolean.TRUE.equals(cur.get("passedNow")) && rounds++ < 30) {
            d = new PhaseDrill(ctx, idx, PhaseTestService.WORDS, false, tests);
            cur = d.view(ctx);
            while (!"finished".equals(cur.get("state"))) {
                answerCorrectly(d, cur, byEn);
                d.act(ctx, "next", Map.of());
                cur = d.view(ctx);
            }
        }
        assertTrue((Boolean) cur.get("passedNow"), "passed after " + rounds + " rounds");
        Map<String, Object> status = (Map<String, Object>) cur.get("status");
        assertEquals(77L, status.get("mastered"));
        assertEquals("passed", status.get("kind"));
        assertNotNull(tests.state(ctx, idx).get("due"), "first refresher scheduled");
    }

    /** Answers like a learner who knows the word: the one option that means / is the asked word. */
    private void answerCorrectly(PhaseDrill d, Map<String, Object> v, Map<String, List<Card>> byEn) {
        if ("de-en".equals(v.get("dir"))) {
            d.act(ctx, "choose", Map.of("key", v.get("prompt")));
        } else {
            List<String> meant = byEn.get((String) v.get("prompt")).stream().map(Card::de).toList();
            List<String> right = options(v).stream().map(o -> (String) o.get("key")).filter(meant::contains).toList();
            assertEquals(1, right.size(), "exactly one option means " + v.get("prompt"));
            d.act(ctx, "choose", Map.of("key", right.get(0)));
            @SuppressWarnings("unchecked")
            Map<String, Object> a = (Map<String, Object>) d.view(ctx).get("answer");
            assertTrue((Boolean) a.get("correct"), "accepted: " + right.get(0));
        }
    }

    @Test
    @SuppressWarnings("unchecked")
    void verbTestIsSeparateAndPassesAfterCleanRounds() {
        ProgressService p = TestVocab.progress();
        StoryService stories = TestVocab.stories();
        PhaseTestService tests = new PhaseTestService(p, stories);
        String idx = "1";
        List<StoryService.PhaseWord> verbs = stories.phaseVerbs(idx);
        Map<String, String> enOf = new LinkedHashMap<>();
        tests.optionPool(idx, PhaseTestService.VERBS).forEach(w -> enOf.put(w.card().de(), w.card().en()));
        List<String> b1Verbs = stories.b1Verbs().stream().map(w -> w.card().de()).toList();

        Map<String, Object> cur = null;
        int rounds = 0;
        while ((cur == null || !Boolean.TRUE.equals(cur.get("passedNow"))) && rounds++ < 10) {
            PhaseDrill d = new PhaseDrill(ctx, idx, PhaseTestService.VERBS, false, tests);
            cur = d.view(ctx);
            assertEquals(PhaseTestService.VERBS, cur.get("set"));
            while (!"finished".equals(cur.get("state"))) {
                List<Map<String, Object>> opts = options(cur);
                assertEquals(4, opts.size());
                assertEquals(4, opts.stream().map(o -> o.get("key")).distinct().count(), "no option twice");
                for (Map<String, Object> o : opts) {
                    String key = (String) o.get("key");
                    assertTrue(b1Verbs.contains(key) || verbs.stream().anyMatch(w -> w.card().de().equals(key)),
                            "only verbs as choices: " + key);
                }
                String pick;
                if ("de-en".equals(cur.get("dir"))) {
                    pick = (String) cur.get("prompt");
                } else {
                    String prompt = (String) cur.get("prompt");
                    List<String> right = opts.stream().map(o -> (String) o.get("key")).filter(k -> prompt.equals(enOf.get(k))).toList();
                    assertEquals(1, right.size(), "exactly one option means " + prompt);
                    pick = right.get(0);
                }
                d.act(ctx, "choose", Map.of("key", pick));
                assertTrue((Boolean) ((Map<String, Object>) d.view(ctx).get("answer")).get("correct"), pick);
                d.act(ctx, "next", Map.of());
                cur = d.view(ctx);
            }
        }
        assertTrue((Boolean) cur.get("passedNow"), "passed after " + rounds + " rounds");
        assertEquals((long) verbs.size(), ((Map<String, Object>) cur.get("status")).get("mastered"));
        assertNotNull(tests.state(ctx, "1-verbs").get("passed"), "saved as the verb test");
        assertTrue(PhaseTestService.words(tests.state(ctx, "1")).isEmpty(), "the word test is untouched");
    }

    @Test
    void phaseTestProductionIsMultipleChoiceInGerman() {
        ProgressService p = TestVocab.progress();
        StoryService stories = TestVocab.stories();
        PhaseTestService tests = new PhaseTestService(p, stories);
        String idx = stories.groups().get(0).index();
        Map<String, String> enOf = new LinkedHashMap<>();
        stories.phaseWords(idx).forEach(w -> enOf.put(w.card().de(), w.card().en()));
        PhaseDrill d = new PhaseDrill(ctx, idx, PhaseTestService.WORDS, false, tests);
        Map<String, Object> v = d.view(ctx);
        while ("de-en".equals(v.get("dir"))) { // skip to the EN→DE part
            d.act(ctx, "choose", Map.of("key", v.get("prompt")));
            d.act(ctx, "next", Map.of());
            v = d.view(ctx);
        }
        List<Map<String, Object>> opts = options(v);
        assertEquals(4, opts.size());
        for (Map<String, Object> o : opts) {
            assertEquals(o.get("key"), o.get("text"), "EN→DE options are shown in German");
        }
        int total = (int) v.get("total");
        String prompt = (String) v.get("prompt");
        String wrong = opts.stream().map(o -> (String) o.get("key")).filter(k -> !prompt.equals(enOf.get(k))).findFirst().orElseThrow();
        d.act(ctx, "choose", Map.of("key", wrong));
        Map<String, Object> after = d.view(ctx);
        assertFalse((Boolean) ((Map<?, ?>) after.get("answer")).get("correct"));
        assertEquals(total + 1, after.get("total"), "the miss is re-asked later in the round");
    }
}
