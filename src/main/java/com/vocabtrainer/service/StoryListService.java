package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import org.springframework.stereotype.Service;

/**
 * Story mode for one learner: their read marks and each phase's test status,
 * and marking a story read. The stories themselves come to the page straight
 * from german_vocab.json.
 */
@Service
public class StoryListService {

    private final StoryService stories;
    private final PhaseTestService tests;
    private final ProgressService progress;
    private final SettingsService settings;

    public StoryListService(StoryService stories, PhaseTestService tests, ProgressService progress, SettingsService settings) {
        this.stories = stories;
        this.tests = tests;
        this.progress = progress;
        this.settings = settings;
    }

    /**
     * The learner's own story data — the page builds the story list and the
     * reader from german_vocab.json itself: {read: [story ids], tests: {phase:
     * {test, verbTest}}} with each phase test's status (see {@link PhaseTestService#status}).
     */
    public Map<String, Object> progress(Ctx ctx) {
        Map<String, Object> tests = new LinkedHashMap<>();
        for (StoryService.Group g : stories.groups()) {
            if (g.index() == null) {
                continue;
            }
            Map<String, Object> t = new LinkedHashMap<>();
            List<StoryService.PhaseWord> words = stories.phaseWords(g.index());
            t.put("test", words.isEmpty() ? null : PhaseTestService.status(words, tests(ctx, g.index())));
            List<StoryService.PhaseWord> verbs = stories.phaseVerbs(g.index());
            t.put("verbTest", verbs.isEmpty() ? null : PhaseTestService.status(verbs,
                    tests(ctx, PhaseTestService.storageKey(g.index(), PhaseTestService.VERBS))));
            tests.put(g.index(), t);
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("read", new ArrayList<>(progress.storiesRead(ctx).keySet()));
        v.put("tests", tests);
        return v;
    }

    private Map<String, Object> tests(Ctx ctx, String key) {
        return this.tests.state(ctx, key);
    }

    /** Marks a story read (or unread again); {read}. 404 for an unknown story. */
    public Map<String, Object> toggleRead(Ctx ctx, String id) {
        stories.story(id);
        return Map.of("read", progress.toggleStoryRead(ctx, id));
    }
}
