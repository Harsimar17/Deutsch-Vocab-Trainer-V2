package com.vocabtrainer.progress;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.cards.Card;
import com.vocabtrainer.util.Rand;

/**
 * Spaced repetition (Leitner boxes 1–5) and the daily counters. "good"
 * promotes a word and pushes its next review further out; "again" drops it to
 * box 1 and brings it back within the session. Study/Write serve whatever is
 * due plus a small daily trickle of new words.
 */
public final class Srs {

    public static final long[] BOX_DAYS = {0, 1, 3, 8, 21}; // interval after reaching box 1..5
    public static final int NEW_PER_DAY = 12;
    public static final int DAILY_GOAL = 20;
    public static final int TROUBLE_LAPSES = 3;
    public static final long DAY_MS = 86_400_000L;
    public static final long AGAIN_MS = 8 * 60 * 1000L;

    private Srs() {
    }

    /** Next state for a word after a grade ("again" | "good" | "easy"). */
    public static Map<String, Object> advance(Map<String, Object> prev, String grade, long now) {
        long box = prev == null ? 1 : num(prev.get("box"), 1);
        long reps = prev == null ? 0 : num(prev.get("reps"), 0);
        long lapses = prev == null ? 0 : num(prev.get("lapses"), 0);
        long due;
        reps += 1;
        if ("again".equals(grade)) {
            if (box > 1) {
                lapses += 1;
            }
            box = 1;
            due = now + AGAIN_MS;
        } else {
            box = Math.min(5, box + ("easy".equals(grade) ? 2 : 1));
            due = now + BOX_DAYS[(int) box - 1] * DAY_MS;
        }
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("box", box);
        s.put("due", due);
        s.put("reps", reps);
        s.put("lapses", lapses);
        s.put("last", now);
        return s;
    }

    /**
     * Ordered study list: everything due (soonest first), then up to the daily
     * cap of brand-new words. Focus "all" ignores the schedule; "trouble" is the
     * words missed a lot.
     */
    public static List<Card> queue(List<Card> pool, Map<String, Map<String, Object>> srs, Map<String, Object> daily,
                                   String focus, String today, long now) {
        if ("trouble".equals(focus)) {
            return Rand.shuffle(pool.stream()
                    .filter(c -> srs.get(c.key()) != null && num(srs.get(c.key()).get("lapses"), 0) >= TROUBLE_LAPSES)
                    .toList());
        }
        if ("all".equals(focus)) {
            return Rand.shuffle(pool);
        }
        List<Card> due = new ArrayList<>();
        List<Card> fresh = new ArrayList<>();
        for (Card c : pool) {
            Map<String, Object> st = srs.get(c.key());
            if (st != null) {
                if (num(st.get("due"), 0) <= now) {
                    due.add(c);
                }
            } else {
                fresh.add(c);
            }
        }
        due.sort(Comparator.comparingLong(c -> num(srs.get(c.key()).get("due"), 0)));
        long introduced = daily != null && today.equals(daily.get("date")) ? num(daily.get("introduced"), 0) : 0;
        int room = (int) Math.max(0, NEW_PER_DAY - introduced);
        List<Card> out = new ArrayList<>(due);
        List<Card> shuffled = Rand.shuffle(fresh);
        out.addAll(shuffled.subList(0, Math.min(room, shuffled.size())));
        return out;
    }

    /** Today's counters after one more activity; starts a new day / extends or resets the streak. */
    public static Map<String, Object> advanceDaily(Map<String, Object> d, boolean isNew, String today, String yesterday) {
        Map<String, Object> nd = new LinkedHashMap<>();
        if (d != null) {
            nd.putAll(d);
        }
        if (!today.equals(nd.get("date"))) {
            nd.put("date", today);
            nd.put("reviewed", 0L);
            nd.put("introduced", 0L);
        }
        if (!today.equals(nd.get("lastActive"))) {
            nd.put("streak", yesterday.equals(nd.get("lastActive")) ? num(nd.get("streak"), 0) + 1 : 1L);
            nd.put("lastActive", today);
        }
        nd.put("reviewed", num(nd.get("reviewed"), 0) + 1);
        if (isNew) {
            nd.put("introduced", num(nd.get("introduced"), 0) + 1);
        }
        return nd;
    }

    public static long num(Object o, long dflt) {
        return o instanceof Number n ? n.longValue() : dflt;
    }
}
