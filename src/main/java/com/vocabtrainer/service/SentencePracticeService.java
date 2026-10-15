package com.vocabtrainer.service;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.model.Card;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.json.JsonMapper;

/**
 * Sentences for the Phasentest's third tab: easy written sentences (German,
 * English and how the word is used) for every word and verb of a phase.
 * They live in data/sentences_b1.json, keyed by the word's German
 * ("die Regierung", "abhängen von"): {use, sentences: [{de, en, hint?}, …]}.
 * "hint" is the part of the English that stands for the word, where the
 * dictionary meaning isn't in the sentence as such ("applying" for "der Antrag").
 */
@Service
public class SentencePracticeService {

    /** One sentence to build: the word it practises, the German, the English, the English for the word (or null), how the word is used, the words in order. */
    public record Sentence(Card card, String de, String en, String hint, String use, List<String> words) {
    }

    /** One word's entry in data/sentences_b1.json. */
    private record Written(String use, List<Map<String, String>> sentences) {
    }

    private final StoryService stories;
    private final Map<String, Written> written;

    public SentencePracticeService(StoryService stories, JsonMapper json) {
        this.stories = stories;
        this.written = load(json);
    }

    /** Sentences of a phase's target words and its B1 verbs (each word once). */
    public List<Sentence> forPhase(String idx) {
        List<Card> cards = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (StoryService.PhaseWord w : stories.phaseWords(idx)) {
            if (seen.add(w.card().de())) {
                cards.add(w.card());
            }
        }
        for (StoryService.PhaseWord w : stories.phaseVerbs(idx)) {
            if (seen.add(w.card().de())) {
                cards.add(w.card());
            }
        }
        return sentences(cards);
    }

    private List<Sentence> sentences(List<Card> cards) {
        List<Sentence> out = new ArrayList<>();
        for (Card c : cards) {
            Written w = written.get(c.de());
            if (w != null) {
                for (Map<String, String> s : w.sentences()) {
                    out.add(new Sentence(c, s.get("de"), s.get("en"), s.get("hint"), w.use(), words(s.get("de"))));
                }
            }
        }
        return out;
    }

    /** The words of a sentence in order, punctuation dropped — these are the tiles. */
    public static List<String> words(String sentence) {
        String bare = sentence.replaceAll("[.,!?;:…()„“\"]|\\s[–-]\\s", " ").trim();
        return bare.isEmpty() ? List.of() : Arrays.asList(bare.split("\\s+"));
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Written> load(JsonMapper json) {
        ClassPathResource file = new ClassPathResource("data/sentences_b1.json");
        try (InputStream in = file.getInputStream()) {
            Map<String, Written> m = new LinkedHashMap<>();
            json.readValue(in, LinkedHashMap.class).forEach((k, v) -> {
                Map<String, Object> e = (Map<String, Object>) v;
                m.put(String.valueOf(k), new Written((String) e.get("use"), (List<Map<String, String>>) e.get("sentences")));
            });
            return m;
        } catch (IOException e) {
            throw new IllegalStateException("can't read data/sentences_b1.json", e);
        }
    }
}
