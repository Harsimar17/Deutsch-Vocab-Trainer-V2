package com.vocabtrainer.progress;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.LocalDate;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.TestVocab;
import com.vocabtrainer.cards.Card;
import org.junit.jupiter.api.Test;

class ProgressServiceTest {

    private static final Card CARD = new Card("A2|die|die Übung", "die Übung", "exercise", "die", "A2", null, null);

    @Test
    void aMissGoesOnTheReviewListAndAHitOnlyCountsWhenListed() {
        ProgressService p = TestVocab.progress();
        Ctx ctx = TestVocab.ctx();
        p.recordResult(ctx, CARD, true, false);
        assertFalse(p.mistakes(ctx).containsKey(CARD.key()), "a hit alone never adds a word");
        p.recordResult(ctx, CARD, false, false);
        p.recordResult(ctx, CARD, false, false);
        p.recordResult(ctx, CARD, true, false);
        Map<String, Object> m = p.mistakes(ctx).get(CARD.key());
        assertEquals(2L, m.get("wrong"));
        assertEquals(1L, m.get("right"));
        p.removeMistake(ctx, CARD.key());
        assertTrue(p.mistakes(ctx).isEmpty());
    }

    @Test
    void quizAnswersCountTowardTheAllTimeScore() {
        Map<String, Object> doc = new LinkedHashMap<>(Map.of("right", 10L, "total", 20L));
        ProgressService p = TestVocab.progress(doc);
        Ctx ctx = TestVocab.ctx();
        p.recordResult(ctx, CARD, true, true);
        p.recordResult(ctx, CARD, false, true);
        assertEquals(List.of(11L, 22L), List.of(p.allTime(ctx)[0], p.allTime(ctx)[1]));
    }

    @Test
    void gradingSchedulesTheWordAndCountsToday() {
        ProgressService p = TestVocab.progress();
        Ctx ctx = TestVocab.ctx();
        p.grade(ctx, CARD, "good");
        Map<String, Object> st = p.srs(ctx).get(CARD.key());
        assertEquals(2L, st.get("box"));
        Map<String, Object> d = p.daily(ctx);
        assertEquals(ctx.today(), d.get("date"));
        assertEquals(1L, d.get("reviewed"));
        assertEquals(1L, d.get("introduced"));
        assertEquals(1L, d.get("streak"));
        p.grade(ctx, CARD, "again");
        assertEquals(1L, p.srs(ctx).get(CARD.key()).get("box"));
        assertEquals(1L, p.daily(ctx).get("introduced"), "not new the second time");
    }

    @Test
    void streakFollowsTheLearnersLocalCalendar() {
        String today = LocalDate.now(ZoneId.of("Asia/Kolkata")).toString();
        String yesterday = LocalDate.now(ZoneId.of("Asia/Kolkata")).minusDays(1).toString();
        Map<String, Object> d = Srs.advanceDaily(Map.of("date", yesterday, "reviewed", 7L, "streak", 4L, "lastActive", yesterday),
                false, today, yesterday);
        assertEquals(5L, d.get("streak"));
        assertEquals(1L, d.get("reviewed"));
        Map<String, Object> gap = Srs.advanceDaily(Map.of("date", "2020-01-01", "streak", 9L, "lastActive", "2020-01-01"),
                false, today, yesterday);
        assertEquals(1L, gap.get("streak"));
    }

    @Test
    void studyQueueServesDueWordsThenTodaysNewOnes() {
        List<Card> pool = TestVocab.catalog().pool(List.of("A1"), List.of("verb"));
        long now = System.currentTimeMillis();
        Map<String, Map<String, Object>> srs = new LinkedHashMap<>();
        srs.put(pool.get(0).key(), Map.of("due", now - 1000, "box", 2L));
        srs.put(pool.get(1).key(), Map.of("due", now + 86_400_000L, "box", 3L));
        String today = TestVocab.ctx().today();
        List<Card> q = Srs.queue(pool, srs, Map.of("date", today, "introduced", 10L), "due", today, now);
        assertEquals(pool.get(0).key(), q.get(0).key(), "due first");
        assertEquals(1 + 2, q.size(), "1 due + the 2 new words left of today's 12");
    }
}
