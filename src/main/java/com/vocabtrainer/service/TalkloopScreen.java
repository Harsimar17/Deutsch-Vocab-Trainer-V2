package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One Talkloop practice in ChatGPT, as its screen shows it: who the partner is,
 * today's words and how far each got in this practice, and the conversation so far.
 * The version goes up with every change, so the screen knows when to redraw.
 * Kept in {@link com.vocabtrainer.repository.TalkloopScreenRepository}.
 */
public final class TalkloopScreen {

    static final int DONE_AFTER = 2; // correct uses in one practice before a word makes room for the next

    record Word(String de, String en) {
    }

    private static final class Status {
        int correct;
        int wrong;
        boolean peeked;
    }

    private final String owner;
    private final String partner;
    private final String mode;
    private final String level;
    private final String subtitle;
    private final List<Word> active;
    private final List<Word> waiting;
    private final Map<String, Status> status = new LinkedHashMap<>();
    private final List<Map<String, Object>> messages = new ArrayList<>();
    private String id;
    private String nextWord = "";
    private int version = 1;

    TalkloopScreen(String owner, String partner, String mode, String level, String subtitle, List<Word> active, List<Word> waiting) {
        this.owner = owner;
        this.partner = partner;
        this.mode = mode;
        this.level = level;
        this.subtitle = subtitle;
        this.active = new ArrayList<>(active);
        this.waiting = new ArrayList<>(waiting);
    }

    public String owner() {
        return owner;
    }

    synchronized void id(String id) {
        this.id = id;
    }

    /** Today's word this text means (ChatGPT may drop or change the article), or null. */
    synchronized Word word(String text) {
        return text == null ? null : active.stream().filter(w -> TalkloopChatGptService.sameWord(w.de(), text)).findFirst()
                .orElse(waiting.stream().filter(w -> TalkloopChatGptService.sameWord(w.de(), text)).findFirst().orElse(null));
    }

    synchronized boolean peeked(Word w) {
        Status s = status.get(w.de());
        return s != null && s.peeked;
    }

    /** Was said correctly or shown already, so peeking costs nothing. */
    synchronized boolean known(Word w) {
        Status s = status.get(w.de());
        return s != null && (s.peeked || s.correct > 0);
    }

    synchronized void peek(Word w) {
        status.computeIfAbsent(w.de(), k -> new Status()).peeked = true;
        version++;
    }

    /** A use of a word in the learner's message; a word said correctly often enough makes room for the next. */
    synchronized void used(Word w, boolean correct) {
        Status s = status.computeIfAbsent(w.de(), k -> new Status());
        if (correct) {
            s.correct++;
        } else {
            s.wrong++;
        }
        if (s.correct >= DONE_AFTER && active.remove(w) && !waiting.isEmpty()) {
            active.add(waiting.remove(0));
        }
    }

    /** One exchange: what the learner said (with its correction, if any), then the partner's reply. */
    synchronized void turn(Map<String, Object> learner, Map<String, Object> reply, String nextWord) {
        if (learner != null) {
            messages.add(learner);
        }
        messages.add(reply);
        this.nextWord = nextWord == null ? "" : nextWord;
        version++;
    }

    synchronized List<String> notYetSaid() {
        return active.stream().filter(w -> !status.containsKey(w.de()) || status.get(w.de()).correct == 0).map(Word::de).toList();
    }

    /** What the screen shows. The German of a word stays hidden until it was said or shown. */
    synchronized Map<String, Object> view() {
        List<Map<String, Object>> words = new ArrayList<>();
        for (Word w : active) {
            Status s = status.get(w.de());
            Map<String, Object> v = new LinkedHashMap<>();
            v.put("en", w.en());
            v.put("state", s == null ? "new" : s.correct > 0 && !s.peeked ? "said" : s.peeked ? "peeked" : "tried");
            if (s != null && (s.peeked || s.correct > 0)) {
                v.put("de", w.de());
            }
            v.put("key", key(w));
            v.put("next", TalkloopChatGptService.sameWord(w.de(), nextWord));
            words.add(v);
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", id);
        v.put("version", version);
        v.put("partner", partner);
        v.put("mode", mode);
        v.put("level", level);
        v.put("subtitle", subtitle);
        v.put("words", words);
        v.put("messages", List.copyOf(messages));
        return v;
    }

    /** The word with this key, as the screen sends it back when the learner taps a chip. */
    synchronized Word byKey(Object key) {
        return active.stream().filter(w -> key(w).equals(key)).findFirst().orElse(null);
    }

    private static String key(Word w) {
        return Integer.toHexString(w.de().hashCode());
    }
}
