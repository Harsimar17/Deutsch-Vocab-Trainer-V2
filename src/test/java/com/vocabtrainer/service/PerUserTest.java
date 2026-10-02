package com.vocabtrainer.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;

import java.time.ZoneOffset;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.DrillRepository;
import com.vocabtrainer.repository.InMemoryProgressRepository;
import com.vocabtrainer.service.drill.Drill;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Two users never see each other's progress or practice rounds. */
class PerUserTest {

    private static final Ctx ANNA = new Ctx("uid-anna", "id-uid-anna-1", ZoneOffset.UTC);
    private static final Ctx BEN = new Ctx("uid-ben", "id-uid-ben-1", ZoneOffset.UTC);

    @Test
    void eachUserHasTheirOwnRecord() {
        InMemoryProgressRepository repo = new InMemoryProgressRepository();
        repo.seed("uid-anna", Map.of("right", 5L));
        ProgressService progress = new ProgressService(repo);

        assertEquals(5L, progress.allTime(ANNA)[0]);
        assertEquals(0L, progress.allTime(BEN)[0]);
        progress.savePrefs(BEN, Map.of("theme", "dark"));
        assertEquals("dark", progress.prefs(BEN).get("theme"));
        assertNull(progress.prefs(ANNA).get("theme"));
    }

    @Test
    void aRoundBelongsToTheUserWhoStartedIt() {
        DrillRepository rounds = new DrillRepository();
        Drill drill = mock(Drill.class);
        String id = rounds.save(ANNA.uid(), drill);
        assertSame(drill, rounds.find(ANNA.uid(), id));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> rounds.find(BEN.uid(), id));
        assertEquals(HttpStatus.GONE, e.getStatusCode());
    }
}
