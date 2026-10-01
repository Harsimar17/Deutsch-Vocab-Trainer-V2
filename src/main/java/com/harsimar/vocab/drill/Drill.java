package com.harsimar.vocab.drill;

import java.util.Map;

import com.harsimar.vocab.progress.Ctx;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * One practice round, run on the server. The page shows {@link #view} and sends
 * the learner's actions back; the drill decides what happens and what to show next.
 */
public interface Drill {

    /** Everything the page needs to render the round right now. */
    Map<String, Object> view(Ctx ctx);

    /** Applies one action ("answer", "next", …) with its payload. */
    void act(Ctx ctx, String action, Map<String, Object> payload);

    static ResponseStatusException unknown(String action) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown action: " + action);
    }

    static String str(Map<String, Object> payload, String key) {
        Object v = payload == null ? null : payload.get(key);
        return v == null ? null : String.valueOf(v);
    }
}
