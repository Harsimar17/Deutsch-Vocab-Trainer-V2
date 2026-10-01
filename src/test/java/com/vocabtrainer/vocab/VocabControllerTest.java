package com.vocabtrainer.vocab;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@WebMvcTest(VocabController.class)
class VocabControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    VocabService vocab;

    @MockitoBean
    GitHubVocabCommitter committer;

    @BeforeEach
    void data() {
        byte[] json = "{\"levels\":{\"B1\":{\"nouns\":{\"die\":[{\"de\":\"die Beziehung\"}]}}},\"stories\":{\"items\":[{\"title_de\":\"Familie\"}]}}"
                .getBytes(StandardCharsets.UTF_8);
        when(vocab.current()).thenReturn(new VocabService.Snapshot(json, "\"e1\"", "https://pages.test/v.json"));
    }

    @Test
    void servesTheVocabularyWithoutAToken() throws Exception {
        mvc.perform(get("/api/vocab"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Vocab-Source", "https://pages.test/v.json"))
                .andExpect(jsonPath("$.levels.B1.nouns.die[0].de").value("die Beziehung"))
                .andExpect(jsonPath("$.stories.items[0].title_de").value("Familie"));
    }

    @Test
    void revalidatesWithETag() throws Exception {
        MvcResult first = mvc.perform(get("/api/vocab")).andExpect(status().isOk()).andReturn();
        String etag = first.getResponse().getHeader("ETag");
        mvc.perform(get("/api/vocab").header("If-None-Match", etag)).andExpect(status().isNotModified());
    }

    @Test
    void addingAWordNeedsTheFirebaseToken() throws Exception {
        mvc.perform(post("/api/vocab/words").header("X-GitHub-Token", "gh")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"lvl\":\"A2\",\"cat\":\"verb\",\"de\":\"a\",\"en\":\"b\"}"))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(committer);
    }

    @Test
    void addingAWordPassesTheGitHubTokenThrough() throws Exception {
        when(committer.add(eq("gh"), any())).thenReturn(new GitHubVocabCommitter.CommitResult(
                Map.of("de", "abholen", "en", "to pick up"), "A2", "verb", "https://github.com/c/1"));
        mvc.perform(post("/api/vocab/words")
                        .header("Authorization", "Bearer aaa.bbb.ccc")
                        .header("X-GitHub-Token", "gh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"lvl\":\"A2\",\"cat\":\"verb\",\"de\":\"abholen\",\"en\":\"to pick up\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.commitUrl").value("https://github.com/c/1"))
                .andExpect(jsonPath("$.entry.de").value("abholen"));
        verify(committer).add(eq("gh"), eq(new GitHubVocabCommitter.NewWord("A2", "verb", "abholen", "to pick up", null, null)));
    }
}
