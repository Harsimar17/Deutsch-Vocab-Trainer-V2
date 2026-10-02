package com.vocabtrainer;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.InMemoryProgressRepository;
import com.vocabtrainer.service.CardCatalog;
import com.vocabtrainer.service.ProgressService;
import com.vocabtrainer.service.StoryService;
import com.vocabtrainer.service.VocabService;
import tools.jackson.databind.json.JsonMapper;

/** Test fixtures built on the real german_vocab.json (cards + stories) and a fake Firestore. */
public final class TestVocab {

    private static byte[] bytes;

    private TestVocab() {
    }

    public static synchronized byte[] bytes() {
        if (bytes == null) {
            try {
                bytes = Files.readAllBytes(Path.of("src/main/resources/data/german_vocab.json"));
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
        }
        return bytes;
    }

    public static CardCatalog catalog() {
        VocabService vocab = mock(VocabService.class);
        when(vocab.current()).thenReturn(new VocabService.Snapshot(bytes(), "\"test\"", "test"));
        return new CardCatalog(vocab, JsonMapper.builder().build());
    }

    public static StoryService stories() {
        return new StoryService(catalog());
    }

    public static Ctx ctx() {
        return new Ctx("user-1", "id-user-1-test", ZoneId.of("Asia/Kolkata"));
    }

    /** A progress service whose repository keeps everything in memory, starting from {@code doc}. */
    public static ProgressService progress(Map<String, Object> doc) {
        InMemoryProgressRepository repo = new InMemoryProgressRepository();
        repo.seed(ctx().uid(), doc);
        return new ProgressService(repo);
    }

    public static ProgressService progress() {
        return progress(new LinkedHashMap<>());
    }
}
