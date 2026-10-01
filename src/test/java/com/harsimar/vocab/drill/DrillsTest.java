package com.harsimar.vocab.drill;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.harsimar.vocab.TestVocab;
import com.harsimar.vocab.cards.Card;
import com.harsimar.vocab.cards.CardCatalog;
import com.harsimar.vocab.progress.Ctx;
import com.harsimar.vocab.progress.ProgressService;
import com.harsimar.vocab.stories.PhaseTests;
import com.harsimar.vocab.stories.StoryService;
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
        PhaseTests tests = new PhaseTests(p, stories);
        String idx = stories.groups().get(1).index(); // phase 2: 77 words
        List<StoryService.PhaseWord> words = stories.phaseWords(idx);
        Map<String, Card> byDe = new LinkedHashMap<>();
        words.forEach(w -> byDe.put(w.card().de(), w.card()));
        Map<String, List<Card>> byEn = new LinkedHashMap<>();
        words.forEach(w -> byEn.computeIfAbsent(w.card().en(), k -> new java.util.ArrayList<>()).add(w.card()));

        // first round: miss the first question on purpose
        PhaseDrill d = new PhaseDrill(ctx, idx, false, tests);
        Map<String, Object> v = d.view(ctx);
        int total = (int) v.get("total");
        d.act(ctx, "choose", Map.of("key", options(v).stream()
                .map(o -> (String) o.get("key")).filter(k -> !k.equals(v.get("prompt"))).findFirst().orElseThrow()));
        assertEquals(total + 1, d.view(ctx).get("total"), "the miss is re-asked later in the round");
        assertEquals(1L, ((Map<String, Object>) PhaseTests.words(tests.state(ctx, idx)).get(v.get("prompt"))).get("miss"));

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
            d = new PhaseDrill(ctx, idx, false, tests);
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

    /** Answers like a learner who knows the word: for shared meanings, the "starts with" cue picks the one asked for. */
    private void answerCorrectly(PhaseDrill d, Map<String, Object> v, Map<String, List<Card>> byEn) {
        if ("de-en".equals(v.get("dir"))) {
            d.act(ctx, "choose", Map.of("key", v.get("prompt")));
        } else {
            String de = byEn.get((String) v.get("prompt")).stream()
                    .filter(c -> com.harsimar.vocab.cards.German.ptBare(c).startsWith((String) v.get("startsWith")))
                    .findFirst().orElseThrow().de();
            d.act(ctx, "check", Map.of("input", de.replaceAll("\\s*\\((?:Pl\\.|WG)\\)", "").split(" / ")[0]));
            @SuppressWarnings("unchecked")
            Map<String, Object> a = (Map<String, Object>) d.view(ctx).get("answer");
            assertTrue((Boolean) a.get("correct"), "accepted: " + de);
        }
    }

    @Test
    void phaseTestTypoCanBeOverruled() {
        ProgressService p = TestVocab.progress();
        StoryService stories = TestVocab.stories();
        PhaseTests tests = new PhaseTests(p, stories);
        String idx = stories.groups().get(0).index();
        PhaseDrill d = new PhaseDrill(ctx, idx, false, tests);
        Map<String, Object> v = d.view(ctx);
        while ("de-en".equals(v.get("dir"))) { // skip to the typing part
            d.act(ctx, "choose", Map.of("key", v.get("prompt")));
            d.act(ctx, "next", Map.of());
            v = d.view(ctx);
        }
        int total = (int) v.get("total");
        d.act(ctx, "check", Map.of("input", "völlig falsch"));
        Map<String, Object> after = d.view(ctx);
        assertEquals(true, after.get("canOverrule"));
        assertEquals(total + 1, after.get("total"));
        d.act(ctx, "overrule", Map.of());
        Map<String, Object> over = d.view(ctx);
        assertEquals(total, over.get("total"), "the re-ask is dropped again");
        assertFalse((Boolean) over.get("canOverrule"));
    }
}
