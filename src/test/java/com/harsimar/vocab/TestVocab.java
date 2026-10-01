package com.harsimar.vocab;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.Map;

import com.harsimar.vocab.cards.CardCatalog;
import com.harsimar.vocab.progress.Ctx;
import com.harsimar.vocab.progress.ProgressRepository;
import com.harsimar.vocab.progress.ProgressService;
import com.harsimar.vocab.progress.ProgressStore;
import com.harsimar.vocab.stories.StoryService;
import com.harsimar.vocab.vocab.VocabService;
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
        return new Ctx("aaa.bbb.ccc", ZoneId.of("Asia/Kolkata"));
    }

    /** A progress service whose "Firestore" is an in-memory document. */
    public static ProgressService progress(Map<String, Object> doc) {
        return new ProgressService(new ProgressStore(fakeRepo(doc)), fakeRepo(doc));
    }

    public static ProgressService progress() {
        return progress(new LinkedHashMap<>());
    }

    public static ProgressRepository fakeRepo(Map<String, Object> doc) {
        ProgressRepository repo = mock(ProgressRepository.class);
        when(repo.load(anyString())).thenAnswer(i -> new LinkedHashMap<>(doc));
        return repo;
    }
}
