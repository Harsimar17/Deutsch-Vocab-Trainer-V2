package com.vocabtrainer.service;

import java.util.LinkedHashMap;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.DrillRepository;
import com.vocabtrainer.service.drill.Drill;
import com.vocabtrainer.service.drill.DrillFactory;
import org.springframework.stereotype.Service;

/**
 * Practice rounds: starts one (built by {@link DrillFactory}) and applies the
 * learner's actions to it. Rounds are saved and found through
 * {@link DrillRepository}; every answer inside a round is saved by the round
 * itself through the progress service.
 */
@Service
public class DrillService {

    private final DrillFactory factory;
    private final DrillRepository rounds;

    public DrillService(DrillFactory factory, DrillRepository rounds) {
        this.factory = factory;
        this.rounds = rounds;
    }

    /** {id, mode, view} of a new round. */
    public Map<String, Object> start(Ctx ctx, String mode, Map<String, Object> params) {
        Drill drill = factory.create(ctx, mode, params == null ? Map.of() : params);
        return response(rounds.save(ctx.uid(), drill), mode, drill.view(ctx));
    }

    /** {id, view} after applying one action ("answer", "next", …) to the learner's round. */
    public Map<String, Object> act(Ctx ctx, String id, String action, Map<String, Object> payload) {
        Drill drill = rounds.find(ctx.uid(), id);
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
