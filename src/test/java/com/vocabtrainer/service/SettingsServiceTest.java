package com.vocabtrainer.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.util.List;

import com.vocabtrainer.TestVocab;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.model.Settings;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class SettingsServiceTest {

    private final Ctx ctx = TestVocab.ctx();

    @Test
    void aFreshRecordGetsTheDefaults() {
        Settings s = new SettingsService(TestVocab.progress()).get(ctx);
        assertEquals(List.of("A2"), s.levels());
        assertEquals(8, s.cats().size());
        assertEquals("de-en", s.direction());
        assertEquals("due", s.focus());
        assertEquals(null, s.theme());
        assertEquals("A2 · all categories · DE→EN", SettingsService.label(s, false));
    }

    @Test
    void actionsApplyTheRulesAndAreRemembered() {
        SettingsService svc = new SettingsService(TestVocab.progress());
        svc.apply(ctx, "toggleLevel", "A2"); // the last level can't be turned off
        assertEquals(List.of("A2"), svc.get(ctx).levels());
        svc.apply(ctx, "toggleLevel", "B1");
        svc.apply(ctx, "toggleLevel", "A1");
        assertEquals(List.of("A1", "A2", "B1"), svc.get(ctx).levels(), "kept in level order");
        svc.apply(ctx, "toggleCat", "phrase");
        svc.apply(ctx, "toggleDirection", null);
        svc.apply(ctx, "setFocus", "trouble");
        svc.apply(ctx, "toggleNoRepeat", null);
        assertEquals("A1+A2+B1 · 7/8 categories · EN→DE · no repeats · focus: trouble · ✨ AI",
                SettingsService.label(svc.get(ctx), true));
        svc.apply(ctx, "openStory", "16");
        svc.apply(ctx, "openPhaseTest", "2");
        svc.apply(ctx, "openStory", null);
        assertEquals(null, svc.get(ctx).storyOpen());
        assertEquals(null, svc.get(ctx).storyTest(), "opening/closing a story leaves the test");
        assertThrows(ResponseStatusException.class, () -> svc.apply(ctx, "setFocus", "everything"));
        assertThrows(ResponseStatusException.class, () -> svc.apply(ctx, "deleteAll", null));
    }
}
