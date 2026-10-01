package com.vocabtrainer.cards;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.List;

import com.vocabtrainer.TestVocab;
import com.vocabtrainer.stories.StoryService;
import org.junit.jupiter.api.Test;

class GermanTest {

    private static Card card(String cat, String de) {
        return new Card(Card.key("A2", cat, de), de, "x", cat, "A2", null, null);
    }

    @Test
    void writeModeIsLenientButNotAboutArticles() {
        Card c = card("die", "die Übung");
        assertEquals("correct", German.checkDe(c, "die übung").verdict());
        assertEquals("die Übung", German.checkDe(c, "Die Uebung.").spelled());
        assertEquals("close", German.checkDe(c, "Übung").verdict());
        assertEquals("Wrong article — it's “die”.", German.checkDe(c, "der Übung").hint());
        assertEquals("wrong", German.checkDe(c, "die Ordnung").verdict());
        assertEquals("empty", German.checkDe(c, "  ").verdict());
        assertEquals("correct", German.checkDe(card("verb", "erinnern (sich)"), "erinnern sich").verdict());
    }

    /** Every phase word, typed exactly as listed, is accepted; every noun without its article is "close". */
    @Test
    void everyPhaseTestAnswerIsAcceptedAsListed() {
        StoryService stories = TestVocab.stories();
        int nouns = 0;
        for (StoryService.Group g : stories.groups()) {
            for (StoryService.PhaseWord w : stories.phaseWords(g.index())) {
                String typed = w.card().de().replaceAll("\\s*\\((?:Pl\\.|WG)\\)", "").split(" / ")[0];
                assertTrue(German.ptCheck(w.card(), typed).correct(), w.card().de());
                if (w.card().isNoun()) {
                    nouns++;
                    assertEquals("close", German.ptCheck(w.card(), German.ptBare(w.card())).verdict(), w.card().de());
                }
            }
        }
        assertEquals(687, nouns);
    }

    @Test
    void phaseTestAcceptsReflexiveAndBracketedForms() {
        Card c = new Card("k", "beschränken(sich)", "x", "verb", "B1", null, null);
        assertTrue(German.ptCheck(c, "sich beschränken").correct());
        assertTrue(German.ptCheck(c, "beschränken").correct());
        assertEquals(List.of("der Fachmann", "die Fachkraft"), German.ptForms("der Fachmann / die Fachkraft"));
    }

    @Test
    void separableVerbsAndClozeSentences() {
        Card sep = new Card("k", "aufstehen", "to get up", "sep", "A1", "Ich stehe um sieben Uhr auf.", null);
        assertEquals("auf", German.sepParts(sep).prefix());
        German.Cloze c = German.sepCloze(sep, "auf");
        assertEquals("Ich stehe um sieben Uhr ", c.before());
        assertEquals(".", c.after());

        Card noun = new Card("k", "der Abfall", "waste", "der", "A2", "Der Abfall kommt in den Müll.", null);
        German.Cloze n = German.clozeMatch(noun);
        assertNotNull(n);
        assertEquals("Abfall", n.answer());
        assertEquals("Die _________ ist wichtig.", German.ptCloze(
                new Card("k", "die Beziehung", "relation", "die", "B1", "Die Beziehung ist wichtig.", null), "noun"));
    }

    @Test
    void theRealFileHasEnoughPlayableSeparableVerbs() {
        long playable = TestVocab.catalog().cards().stream()
                .filter(c -> "sep".equals(c.cat()))
                .filter(c -> !German.sepParts(c).prefix().isEmpty() && German.sepCloze(c, German.sepParts(c).prefix()) != null)
                .count();
        assertTrue(playable >= 40, "playable: " + playable);
    }
}
