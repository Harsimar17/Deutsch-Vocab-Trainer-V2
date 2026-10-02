package com.vocabtrainer.drill;

import java.util.LinkedHashMap;
import java.util.Map;

import com.vocabtrainer.progress.Ctx;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Practice rounds. The page starts a round, shows the returned view, and sends
 * each action back; every response is the next view to show.
 */
@RestController
@RequestMapping("/api/drills")
public class DrillController {

    private final DrillFactory factory;
    private final DrillStore store;

    public DrillController(DrillFactory factory, DrillStore store) {
        this.factory = factory;
        this.store = store;
    }

    /** Starts a round: study, write, flash, quiz, articles, sep, cloze, review, phase. */
    @PostMapping("/{mode}")
    public Map<String, Object> start(Ctx ctx, @PathVariable String mode, @RequestBody(required = false) Map<String, Object> params) {
        Drill drill = factory.create(ctx, mode, params == null ? Map.of() : params);
        return response(store.put(ctx.uid(), drill), mode, drill.view(ctx));
    }

    @PostMapping("/{id}/{action}")
    public Map<String, Object> act(Ctx ctx, @PathVariable String id, @PathVariable String action,
                                   @RequestBody(required = false) Map<String, Object> payload) {
        Drill drill = store.get(ctx.uid(), id);
        synchronized (drill) {
            drill.act(ctx, action, payload == null ? Map.of() : payload);
            return response(id, null, drill.view(ctx));
        }
    }

    private static Map<String, Object> response(String id, String mode, Map<String, Object> view) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", id);
        if (mode != null) {
            r.put("mode", mode);
        }
        r.put("view", view);
        return r;
    }
}
