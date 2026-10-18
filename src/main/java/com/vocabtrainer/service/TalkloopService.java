package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.security.JwtService;
import org.springframework.stereotype.Service;

/**
 * The bridge to Talkloop, the speaking-practice app: a link that lets it read
 * this learner's learnt words, and those words (every card with a
 * spaced-repetition record) so its conversation partner can use them.
 */
@Service
public class TalkloopService {

    private final JwtService jwt;
    private final ProgressService progress;
    private final CardCatalog catalog;

    public TalkloopService(JwtService jwt, ProgressService progress, CardCatalog catalog) {
        this.jwt = jwt;
        this.progress = progress;
        this.catalog = catalog;
    }

    /** token: the link Talkloop keeps; expiresAt: when it stops working (ms). */
    public Map<String, Object> link(JwtService.Session session) {
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("token", jwt.issueLink(session));
        v.put("expiresAt", System.currentTimeMillis() + JwtService.LINK_VALIDITY.toMillis());
        return v;
    }

    /**
     * Learnt words, the ones that most need using first: lowest box (least
     * secure), then most often forgotten, then most recently practised.
     */
    public Map<String, Object> learntWords(Ctx ctx) {
        List<Map<String, Object>> words = new ArrayList<>();
        progress.srs(ctx).forEach((key, st) -> {
            Card c = catalog.card(key);
            if (c == null) {
                return;
            }
            Map<String, Object> w = new LinkedHashMap<>();
            w.put("de", c.de());
            w.put("en", c.en());
            w.put("cat", c.cat());
            w.put("lvl", c.lvl());
            w.put("example", c.example());
            w.put("box", Srs.num(st.get("box"), 1));
            w.put("lapses", Srs.num(st.get("lapses"), 0));
            w.put("last", Srs.num(st.get("last"), 0));
            words.add(w);
        });
        words.sort(Comparator.<Map<String, Object>>comparingLong(w -> (long) w.get("box"))
                .thenComparing(w -> (long) w.get("lapses"), Comparator.reverseOrder())
                .thenComparing(w -> (long) w.get("last"), Comparator.reverseOrder()));
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("count", words.size());
        v.put("words", words);
        return v;
    }
}
