package com.vocabtrainer.service.drill;

import java.util.List;
import java.util.Map;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.model.Settings;
import com.vocabtrainer.service.CardCatalog;
import com.vocabtrainer.service.PhaseTestService;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.service.SettingsService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/** Starts a round of the given mode with the learner's saved settings. */
@Component
public class DrillFactory {

    private final CardCatalog catalog;
    private final ProgressService progress;
    private final SettingsService settings;
    private final PhaseTestService phaseTests;

    public DrillFactory(CardCatalog catalog, ProgressService progress, SettingsService settings, PhaseTestService phaseTests) {
        this.catalog = catalog;
        this.progress = progress;
        this.settings = settings;
        this.phaseTests = phaseTests;
    }

    public Drill create(Ctx ctx, String mode, Map<String, Object> params) {
        Settings s = settings.get(ctx);
        List<Card> pool = catalog.pool(s.levels(), s.cats());
        return switch (mode) {
            case "study" -> new StudyDrill(ctx, pool, s.focus(), s.direction(), progress);
            case "write" -> new WriteDrill(ctx, pool, s.focus(), progress);
            case "flash" -> new FlashDrill(pool, s.direction(), s.noRepeat(), progress);
            case "quiz" -> new QuizDrill(pool, s.cats(), s.direction(), s.noRepeat(), progress);
            case "articles" -> new ArticlesDrill(pool, s.noRepeat(), progress);
            case "sep" -> new SepDrill(pool, progress);
            case "cloze" -> new ClozeDrill(pool, s.noRepeat(), progress);
            case "review" -> new ReviewDrill(ctx, catalog, s.direction(), progress);
            case "phase" -> {
                String idx = Drill.str(params, "phase");
                if (idx == null || !idx.matches("\\d{1,3}")) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "phase must be a number");
                }
                yield new PhaseDrill(ctx, idx, Boolean.TRUE.equals(params.get("refresh")), phaseTests);
            }
            default -> throw new ResponseStatusException(HttpStatus.NOT_FOUND, "unknown mode: " + mode);
        };
    }
}
