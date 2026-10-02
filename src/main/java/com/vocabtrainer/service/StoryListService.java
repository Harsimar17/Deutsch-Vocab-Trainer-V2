package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import org.springframework.stereotype.Service;

/**
 * Story mode for one learner: the story list with their read marks and each
 * phase's test status, the reader with their settings, and marking a story read.
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

    public Map<String, Object> list(Ctx ctx) {
        Map<String, Object> read = progress.storiesRead(ctx);
        List<Map<String, Object>> groups = new ArrayList<>();
        int readCount = 0;
        int total = 0;
        for (StoryService.Group g : stories.groups()) {
            List<Map<String, Object>> list = new ArrayList<>();
            boolean allRead = true;
            for (Map<String, Object> s : g.stories()) {
                String id = StoryService.id(s.get("id"));
                boolean isRead = read.containsKey(id);
                readCount += isRead ? 1 : 0;
                total++;
                allRead &= isRead;
                Object count = s.get("target_count") != null ? s.get("target_count")
                        : (s.get("glossary") instanceof List<?> l ? l.size() : 0);
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("id", id);
                item.put("chapter", s.get("chapter"));
                item.put("titleDe", s.get("title_de"));
                item.put("titleEn", s.get("title_en"));
                item.put("words", count);
                item.put("read", isRead);
                list.add(item);
            }
            Map<String, Object> phase = new LinkedHashMap<>();
            phase.put("index", g.index());
            phase.put("name", g.phase().get("name"));
            phase.put("description", g.phase().get("description"));
            phase.put("note", g.phase().get("note"));
            Map<String, Object> group = new LinkedHashMap<>();
            group.put("phase", phase);
            group.put("stories", list);
            group.put("allRead", allRead);
            if (g.index() != null) {
                List<StoryService.PhaseWord> words = stories.phaseWords(g.index());
                group.put("test", words.isEmpty() ? null : PhaseTestService.status(words, tests.state(ctx, g.index())));
            }
            groups.add(group);
        }
        Map<String, Object> v = new LinkedHashMap<>(stories.level());
        v.put("readCount", readCount);
        v.put("total", total);
        v.put("groups", groups);
        v.put("settings", settings.get(ctx).view());
        return v;
    }

    /** One story, analysed for the reader, with this learner's read mark and translation setting. */
    public Map<String, Object> reader(Ctx ctx, String id) {
        Map<String, Object> v = new LinkedHashMap<>(stories.reader(id));
        v.putAll(stories.neighbours(id));
        v.put("read", progress.storiesRead(ctx).containsKey(id));
        v.put("showEn", settings.get(ctx).storyShowEn());
        return v;
    }

    /** Marks a story read (or unread again); {read}. 404 for an unknown story. */
    public Map<String, Object> toggleRead(Ctx ctx, String id) {
        stories.story(id);
        return Map.of("read", progress.toggleStoryRead(ctx, id));
    }
}
