package com.vocabtrainer;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.vocabtrainer.vocab.VocabService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;

/**
 * Starts the whole application (all beans wired for real). GitHub is pointed at
 * an address that refuses connections, so this runs offline and also checks
 * the fallback to the bundled vocabulary.
 */
@SpringBootTest(properties = "app.vocab.url=http://127.0.0.1:9/german_vocab.json")
class ApplicationContextTest {

    @Autowired
    VocabService vocab;

    @Test
    void contextStartsAndServesTheBundledCopyWhenGitHubIsUnreachable() {
        assertEquals("bundled copy", vocab.current().source());
    }
}
