package com.vocabtrainer.vocab;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

import com.vocabtrainer.config.AppProperties;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * "+ Add word": reads german_vocab.json from GitHub (with its blob sha), inserts
 * the new entry, and PUTs it back through the GitHub Contents API — that PUT is
 * one commit on the configured branch. The file is re-read on every add, so the
 * commit always builds on the latest version; a concurrent edit makes the PUT
 * fail (409) instead of silently overwriting it.
 *
 * The GitHub token comes from the caller with each request and is never stored:
 * the API is reachable by any anonymous Firebase user, so a server-side token
 * would let anyone commit to the repo.
 */
@Service
public class GitHubVocabCommitter {

    static final Set<String> LEVELS = Set.of("A1", "A2", "B1");
    static final Set<String> NOUN_CATS = Set.of("der", "die", "das");
    static final Map<String, String> CAT_TO_KEY = Map.of(
            "adj", "adjectives", "verb", "verbs", "sep", "separable_verbs", "func", "function_words", "phrase", "phrases");
    private static final Map<String, String> CAT_LABEL = Map.of(
            "der", "der", "die", "die", "das", "das", "adj", "adj.", "verb", "verb", "sep", "trenn.", "func", "func.",
            "phrase", "phrase");

    public record NewWord(String lvl, String cat, String de, String en, String example, String prefix) {
    }

    public record CommitResult(Map<String, Object> entry, String lvl, String cat, String commitUrl) {
    }

    private final RestClient http;
    private final AppProperties.Github gh;
    private final JsonMapper json;
    private final VocabService vocab;

    @Autowired
    public GitHubVocabCommitter(AppProperties props, JsonMapper json, VocabService vocab) {
        this(RestClient.builder().baseUrl(props.github().apiUrl()).build(), props, json, vocab);
    }

    GitHubVocabCommitter(RestClient http, AppProperties props, JsonMapper json, VocabService vocab) {
        this.http = http;
        this.gh = props.github();
        this.json = json;
        this.vocab = vocab;
    }

    public CommitResult add(String githubToken, NewWord w) {
        if (githubToken == null || githubToken.isBlank() || githubToken.length() > 500) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Save your GitHub token first — it's needed to commit.");
        }
        Map<String, Object> entry = buildEntry(w);
        String contentsPath = "/repos/" + gh.owner() + "/" + gh.repo() + "/contents/" + gh.path();

        // 1) current file + sha. Files over 1 MB come back without inline content —
        //    then fetch the raw bytes (the JSON response still carries the sha).
        Map<?, ?> file = call(() -> http.get()
                .uri(contentsPath + "?ref={branch}", gh.branch())
                .headers(h -> headers(h, githubToken))
                .retrieve().body(Map.class));
        String sha = (String) file.get("sha");
        String content = file.get("content") instanceof String c ? c : "";
        String text;
        if (!content.isEmpty()) {
            text = new String(Base64.getMimeDecoder().decode(content), StandardCharsets.UTF_8);
        } else {
            byte[] raw = call(() -> http.get()
                    .uri(contentsPath + "?ref={branch}", gh.branch())
                    .headers(h -> {
                        headers(h, githubToken);
                        h.setAccept(List.of(MediaType.parseMediaType("application/vnd.github.raw")));
                    })
                    .retrieve().body(byte[].class));
            text = new String(raw, StandardCharsets.UTF_8);
        }

        // 2) insert the entry
        @SuppressWarnings("unchecked")
        Map<String, Object> doc = json.readValue(text, LinkedHashMap.class);
        List<Map<String, Object>> list = vocabList(doc, w.lvl(), w.cat());
        String de = (String) entry.get("de");
        if (list.stream().anyMatch(x -> normDe(String.valueOf(x.get("de"))).equals(normDe(de)))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "“" + de + "” is already in " + w.lvl() + " on GitHub");
        }
        list.add(entry);
        Map<String, Object> counts = child(doc, "counts");
        Map<String, Object> lvlCounts = child(counts, w.lvl());
        Object n = lvlCounts.get(w.cat());
        lvlCounts.put(w.cat(), (n instanceof Number num ? num.longValue() : 0L) + 1);
        String updated = JsJson.stringify(doc) + "\n";

        // 3) commit
        Map<String, Object> put = Map.of(
                "message", "Add word: " + de + " (" + w.lvl() + " " + CAT_LABEL.get(w.cat()) + ")",
                "content", Base64.getEncoder().encodeToString(updated.getBytes(StandardCharsets.UTF_8)),
                "sha", sha,
                "branch", gh.branch());
        Map<?, ?> res = call(() -> http.put()
                .uri(contentsPath)
                .headers(h -> headers(h, githubToken))
                .contentType(MediaType.APPLICATION_JSON)
                .body(put)
                .retrieve().body(Map.class));
        String url = res != null && res.get("commit") instanceof Map<?, ?> c ? (String) c.get("html_url") : null;

        vocab.replace(updated);
        return new CommitResult(entry, w.lvl(), w.cat(), url);
    }

    /** Same shape and field order the existing entries use, so the diff is just the new block. */
    static Map<String, Object> buildEntry(NewWord w) {
        String lvl = trim(w.lvl());
        String cat = trim(w.cat());
        String de = trim(w.de());
        String en = trim(w.en());
        String example = trim(w.example());
        if (!LEVELS.contains(lvl)) {
            throw bad("level must be A1, A2 or B1");
        }
        if (!NOUN_CATS.contains(cat) && !CAT_TO_KEY.containsKey(cat)) {
            throw bad("unknown category");
        }
        if (de.length() > 300 || en.length() > 300 || example.length() > 500) {
            throw bad("text too long");
        }
        Map<String, Object> e = new LinkedHashMap<>();
        if (NOUN_CATS.contains(cat)) {
            // "der" on its own is just an article, not a word
            String word = de.replaceFirst("(?i)^(der|die|das)(\\s+|$)", "").trim();
            if (word.isEmpty() || en.isEmpty()) {
                throw bad("German and English are both required.");
            }
            e.put("de", cat + " " + word);
            e.put("article", cat);
            e.put("word", word);
            e.put("en", en);
        } else {
            if (de.isEmpty() || en.isEmpty()) {
                throw bad("German and English are both required.");
            }
            e.put("de", de);
            e.put("en", en);
            String prefix = "sep".equals(cat) ? trim(w.prefix()).toLowerCase(Locale.ROOT) : "";
            if (prefix.length() > 20) {
                throw bad("prefix too long");
            }
            if (!prefix.isEmpty()) {
                e.put("prefix", prefix);
            }
        }
        if (!example.isEmpty()) {
            e.put("example", example);
        }
        return e;
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> vocabList(Map<String, Object> doc, String lvl, String cat) {
        Map<String, Object> level = child(child(doc, "levels"), lvl);
        if (NOUN_CATS.contains(cat)) {
            Map<String, Object> nouns = child(level, "nouns");
            return (List<Map<String, Object>>) nouns.computeIfAbsent(cat, k -> new ArrayList<>());
        }
        return (List<Map<String, Object>>) level.computeIfAbsent(CAT_TO_KEY.get(cat), k -> new ArrayList<>());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> child(Map<String, Object> parent, String key) {
        return (Map<String, Object>) parent.computeIfAbsent(key, k -> new LinkedHashMap<>());
    }

    /** Same comparison the page uses: case, ae/oe/ue/ss and trailing punctuation don't matter. */
    static String normDe(String s) {
        String t = s.toLowerCase(Locale.ROOT).trim()
                .replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss");
        return t.replaceAll("[.!?,;:]+$", "").replaceAll("\\s+", " ");
    }

    private static void headers(HttpHeaders h, String token) {
        h.setAccept(List.of(MediaType.parseMediaType("application/vnd.github+json")));
        h.setBearerAuth(token);
        h.set("X-GitHub-Api-Version", "2022-11-28");
    }

    private static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    private static ResponseStatusException bad(String msg) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
    }

    private interface Call<T> {
        T run();
    }

    /** GitHub's errors, translated into messages the page can show as-is. */
    private <T> T call(Call<T> c) {
        try {
            T r = c.run();
            if (r == null) {
                throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "GitHub returned an empty response");
            }
            return r;
        } catch (RestClientResponseException e) {
            int s = e.getStatusCode().value();
            String repo = gh.owner() + "/" + gh.repo();
            if (s == 401) {
                throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "GitHub rejected the token (401) — check it in settings ▸");
            }
            if (s == 403 || s == 404) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                        "GitHub " + s + ": token can't read/write " + repo + " — it needs “Contents: Read and write”");
            }
            if (s == 409 || s == 422) {
                throw new ResponseStatusException(HttpStatus.CONFLICT, gh.path() + " changed on GitHub while saving — press add again");
            }
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "GitHub HTTP " + s);
        } catch (ResourceAccessException e) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "GitHub unreachable");
        }
    }
}
