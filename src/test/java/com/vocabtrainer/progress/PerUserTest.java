package com.vocabtrainer.progress;

import static com.vocabtrainer.progress.ProgressRepository.FieldWrite.set;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.drill.Drill;
import com.vocabtrainer.drill.DrillStore;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Two users never see each other's progress or practice rounds. */
class PerUserTest {

    private static final Ctx ANNA = new Ctx("uid-anna", "t1", ZoneOffset.UTC);
    private static final Ctx BEN = new Ctx("uid-ben", "t2", ZoneOffset.UTC);

    @Test
    void eachUserHasTheirOwnCachedRecord() {
        ProgressRepository repo = mock(ProgressRepository.class);
        when(repo.load(argThat(c -> c != null && c.uid().equals("uid-anna")))).thenAnswer(i -> new LinkedHashMap<>(Map.of("right", 5L)));
        when(repo.load(argThat(c -> c != null && c.uid().equals("uid-ben")))).thenAnswer(i -> new LinkedHashMap<>());
        ProgressStore store = new ProgressStore(repo);

        assertEquals(5L, store.doc(ANNA).get("right"));
        assertTrue(store.doc(BEN).isEmpty());

        store.apply(BEN, List.of(set("dark", "prefs", "theme")), null);
        assertEquals(Map.of("theme", "dark"), store.doc(BEN).get("prefs"));
        assertEquals(null, store.doc(ANNA).get("prefs"));
    }

    @Test
    void aRoundBelongsToTheUserWhoStartedIt() {
        DrillStore rounds = new DrillStore();
        Drill drill = mock(Drill.class);
        String id = rounds.put(ANNA.uid(), drill);
        assertSame(drill, rounds.get(ANNA.uid(), id));
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> rounds.get(BEN.uid(), id));
        assertEquals(HttpStatus.GONE, e.getStatusCode());
    }
}
