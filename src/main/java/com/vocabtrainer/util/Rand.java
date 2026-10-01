package com.vocabtrainer.util;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;

public final class Rand {

    private Rand() {
    }

    /** A shuffled copy (Fisher–Yates). */
    public static <T> List<T> shuffle(Collection<T> items) {
        List<T> a = new ArrayList<>(items);
        Collections.shuffle(a, ThreadLocalRandom.current());
        return a;
    }

    public static <T> T pick(List<T> items) {
        return items.get(ThreadLocalRandom.current().nextInt(items.size()));
    }
}
