package com.vocabtrainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.time.Duration;
import java.util.List;
import java.util.Map;

import com.vocabtrainer.config.AppProperties;
import com.vocabtrainer.repository.FakeFirebaseAuth;
import com.vocabtrainer.repository.InMemoryProgressRepository;
import com.vocabtrainer.security.IdTokenCache;
import com.vocabtrainer.security.JwtService;
import com.vocabtrainer.model.Card;
import com.vocabtrainer.service.CardCatalog;
import com.vocabtrainer.service.German;
import com.vocabtrainer.service.StoryService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.databind.json.JsonMapper;

/**
 * The whole app over HTTP — real controllers, drills, sessions and settings —
 * with Firebase Auth and Firestore replaced by in-memory fakes. Every feature
 * a logged-in learner can use, plus session expiry and user separation.
 * (Creating users and the Gemini / GitHub calls are out of scope here.)
 */
@SpringBootTest(properties = {
        "app.vocab.url=http://127.0.0.1:9/german_vocab.json",
        "app.auth.jwt-secret=end-to-end-secret-end-to-end-secret"})
@AutoConfigureMockMvc
@Import(FakeBackends.class)
@SuppressWarnings("unchecked")
class EndToEndTest {

    private static final String ANNA = "anna@test.local";
    private static final String BEN = "ben@test.local";

    @Autowired
    MockMvc mvc;
    @Autowired
    FakeFirebaseAuth firebase;
    @Autowired
    InMemoryProgressRepository firestore;
    @Autowired
    AppProperties props;
    @Autowired
    CardCatalog catalog;
    @Autowired
    StoryService stories;

    private final JsonMapper json = JsonMapper.builder().build();

    // ---- plumbing ----

    private MvcResult send(MockHttpServletRequestBuilder req, String token, Object body) throws Exception {
        req.header("X-Time-Zone", "Asia/Kolkata");
        if (token != null) {
            req.header("Authorization", "Bearer " + token);
        }
        if (body != null) {
            req.contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));
        }
        return mvc.perform(req).andReturn();
    }

    private Map<String, Object> ok(MockHttpServletRequestBuilder req, String token, Object body) throws Exception {
        MvcResult r = send(req, token, body);
        String content = r.getResponse().getContentAsString();
        assertEquals(200, r.getResponse().getStatus(), req.toString() + " → " + content);
        return json.readValue(content, Map.class);
    }

    private int status(MockHttpServletRequestBuilder req, String token, Object body) throws Exception {
        return send(req, token, body).getResponse().getStatus();
    }

    private String login(String email, String password) throws Exception {
        Map<String, Object> r = ok(post("/api/auth/login"), null, Map.of("email", email, "password", password));
        return (String) r.get("token");
    }

    private String anna() throws Exception {
        return login(ANNA, "anna-test-pw");
    }

    private record Round(String id, Map<String, Object> view) {
    }

    private Round start(String token, String mode, Map<String, Object> params) throws Exception {
        Map<String, Object> r = ok(post("/api/drills/" + mode), token, params);
        assertEquals(mode, r.get("mode"));
        return new Round((String) r.get("id"), (Map<String, Object>) r.get("view"));
    }

    private Map<String, Object> act(String token, Round round, String action, Map<String, Object> payload) throws Exception {
        return (Map<String, Object>) ok(post("/api/drills/" + round.id() + "/" + action), token, payload).get("view");
    }

    private static List<Map<String, Object>> options(Map<String, Object> view) {
        return (List<Map<String, Object>>) view.get("options");
    }

    private Map<String, Object> header(String token) throws Exception {
        return (Map<String, Object>) ok(get("/api/summary"), token, null).get("header");
    }

    // ---- sessions ----

    @Test
    void loginAndTheSessionToken() throws Exception {
        assertEquals(401, status(post("/api/auth/login"), null, Map.of("email", ANNA, "password", "wrong-pw")));
        assertEquals(401, status(post("/api/auth/login"), null, Map.of("email", "nobody@test.local", "password", "whatever")));
        assertEquals(400, status(post("/api/auth/login"), null, Map.of("email", "not-an-email", "password", "whatever")));

        String token = anna();
        MvcResult me = send(get("/api/auth/me"), token, null);
        assertEquals(200, me.getResponse().getStatus());
        assertTrue(me.getResponse().getContentAsString().contains(ANNA));
        String renewed = me.getResponse().getHeader("X-Auth-Token");
        assertNotNull(renewed, "every authenticated response renews the session");
        assertEquals(200, status(get("/api/summary"), renewed, null));

        // everything but the public calls needs a valid session
        assertEquals(401, status(get("/api/summary"), null, null));
        assertEquals(401, status(get("/api/summary"), "aaa.bbb.ccc", null));
        assertEquals(401, status(get("/api/summary"), token.substring(0, token.length() - 2) + "xx", null));
        assertEquals(200, status(get("/api/vocab"), null, null));
        assertEquals(200, status(get("/health"), null, null));
    }

    @Test
    void aTokenPastItsExpiryIsRefused() throws Exception {
        AppProperties.Auth a = props.auth();
        JwtService expiring = new JwtService(new AppProperties(props.firebase(), props.legacyProgressDocId(), props.cors(),
                props.vocab(), props.github(), new AppProperties.Auth(a.jwtSecret(), Duration.ZERO)), json);
        String expired = expiring.issue("uid1", ANNA, "rt-whatever");
        assertEquals(401, status(get("/api/summary"), expired, null));
        assertEquals(Duration.ofHours(24), a.sessionIdleTimeout());
    }

    @Test
    void firebaseIdTokensAreRefreshedFromTheSessionAndCached() {
        FakeFirebaseAuth fb = new FakeFirebaseAuth();
        String uid = fb.addUser("c@test.local", "c-test-pw");
        String rt = fb.signIn("c@test.local", "c-test-pw").refreshToken();
        IdTokenCache cache = new IdTokenCache(fb);
        String id = cache.idToken(uid, rt);
        assertTrue(id.startsWith("id-" + uid));
        assertEquals(id, cache.idToken(uid, rt));
        assertEquals(1, fb.refreshCalls.get(), "exchanged once, then cached");
        fb.revokeAll(); // e.g. the password was changed
        ResponseStatusException e = assertThrows(ResponseStatusException.class, () -> new IdTokenCache(fb).idToken(uid, rt));
        assertEquals(401, e.getStatusCode().value());
    }

    // ---- every feature ----

    @Test
    void summaryAndSettings() throws Exception {
        String t = anna();
        Map<String, Object> s = ok(get("/api/summary?ai=true"), t, null);
        assertTrue(((Number) s.get("cardCount")).intValue() > 100);
        assertTrue(((String) s.get("settingsLabel")).contains("✨ AI"));

        // a settings change answers with the whole new summary
        Map<String, Object> changed = ok(post("/api/settings/setTheme"), t, Map.of("value", "dark"));
        assertNotNull(changed.get("header"));
        Map<String, Object> after = (Map<String, Object>) changed.get("settings");
        assertEquals("dark", after.get("theme"));
        after = (Map<String, Object>) ok(post("/api/settings/toggleLevel"), t, Map.of("value", "B1")).get("settings");
        assertTrue(((List<String>) after.get("levels")).contains("B1"));
        after = (Map<String, Object>) ok(post("/api/settings/toggleDirection"), t, Map.of()).get("settings");
        assertEquals("en-de", after.get("direction"));
        ok(post("/api/settings/toggleDirection"), t, Map.of());
        after = (Map<String, Object>) ok(post("/api/settings/setFocus"), t, Map.of("value", "all")).get("settings");
        assertEquals("all", after.get("focus"));
        ok(post("/api/settings/toggleNoRepeat"), t, Map.of());
        ok(post("/api/settings/toggleCat"), t, Map.of("value", "verb"));
        ok(post("/api/settings/toggleCat"), t, Map.of("value", "verb"));
        ok(post("/api/settings/setStoryShowEn"), t, Map.of("value", true));
        assertEquals(400, status(post("/api/settings/nonsense"), t, Map.of()));
        assertEquals(400, status(post("/api/settings/setTheme"), t, Map.of("value", "purple")));

        Map<String, Object> settings = (Map<String, Object>) ok(get("/api/summary"), t, null).get("settings");
        assertEquals("dark", settings.get("theme"));
        assertEquals("dark", ((Map<String, Object>) firestore.raw("uid1").get("prefs")).get("theme"), "saved to the store");
    }

    @Test
    void everyPracticeMode() throws Exception {
        String t = anna();
        long before = ((Number) header(t).get("reviewed")).longValue();

        Round study = start(t, "study", Map.of());
        assertEquals("card", study.view().get("state"));
        act(t, study, "grade", Map.of("grade", "good"));
        assertEquals(before + 1, ((Number) header(t).get("reviewed")).longValue(), "a graded card counts for today");

        Round write = start(t, "write", Map.of());
        Map<String, Object> w = act(t, write, "check", Map.of("input", "ganz falsch"));
        assertNotNull(w.get("verdict"));
        act(t, write, "next", Map.of());

        // Cards, Quiz, Articles, Separable verbs, Fill-in run in the page; the backend checks and saves answers
        Card noun = catalog.cards().stream().filter(Card::isNoun).findFirst().orElseThrow();
        Card other = catalog.cards().stream().filter(c -> c.isNoun() && !c.key().equals(noun.key())).findFirst().orElseThrow();
        Map<String, Object> r = ok(post("/api/answers"), t, Map.of("mode", "quiz", "key", noun.key(), "pick", noun.key()));
        assertEquals(true, r.get("correct"));
        assertNotNull(((Map<String, Object>) r.get("summary")).get("header"), "the header numbers come with the answer");
        assertEquals(1L, ((Number) ((Map<String, Object>) r.get("allTime")).get("total")).longValue());
        r = ok(post("/api/answers"), t, Map.of("mode", "quiz", "key", other.key(), "pick", noun.key()));
        assertEquals(false, r.get("correct"));
        long mistakes = ((Number) ((Map<String, Object>) r.get("summary")).get("mistakeCount")).longValue();
        assertTrue(mistakes >= 1, "missed word is on the Review list");
        assertEquals(true, ok(post("/api/answers"), t, Map.of("mode", "articles", "key", noun.key(), "pick", noun.cat())).get("correct"));
        String wrongArticle = "der".equals(noun.cat()) ? "das" : "der";
        assertEquals(false, ok(post("/api/answers"), t, Map.of("mode", "articles", "key", noun.key(), "pick", wrongArticle)).get("correct"));
        assertEquals(true, ok(post("/api/answers"), t, Map.of("mode", "cloze", "key", noun.key(), "pick", noun.key())).get("correct"));
        Card sep = catalog.cards().stream().filter(c -> "sep".equals(c.cat()) && !German.sepParts(c).prefix().isEmpty()).findFirst().orElseThrow();
        assertEquals(true, ok(post("/api/answers"), t, Map.of("mode", "sep", "key", sep.key(), "pick", German.sepParts(sep).prefix())).get("correct"));
        assertEquals(400, status(post("/api/answers"), t, Map.of("mode", "nonsense", "key", noun.key(), "pick", "x")));
        assertEquals(404, status(post("/api/answers"), t, Map.of("mode", "quiz", "key", "no|such|card", "pick", "x")));
        Map<String, Object> batch = ok(post("/api/answers/batch"), t, Map.of("results", List.of(
                Map.of("key", noun.key(), "knew", true), Map.of("key", "no|such|card", "knew", true))));
        assertEquals(1, ((Number) batch.get("saved")).intValue());
        Map<String, Object> history = ok(post("/api/quiz-sessions"), t, Map.of("right", 1, "total", 2, "cats", List.of("der")));
        assertEquals(1, ((List<?>) history.get("sessions")).size());
        assertEquals(1, ((List<?>) ok(get("/api/quiz-sessions"), t, null).get("sessions")).size());
        assertEquals(400, status(post("/api/quiz-sessions"), t, Map.of("right", 3, "total", 2)));
        assertEquals(0, ((List<?>) ok(delete("/api/quiz-sessions"), t, null).get("sessions")).size());

        Round review = start(t, "review", Map.of());
        assertFalse(options(review.view()).isEmpty());
        act(t, review, "answer", Map.of("key", options(review.view()).get(0).get("key")));
        act(t, review, "next", Map.of());

        assertEquals(404, status(post("/api/drills/quiz"), t, Map.of()), "the quiz runs in the page");
        assertEquals(404, status(post("/api/drills/nonsense"), t, Map.of()));
        assertEquals(410, status(post("/api/drills/no-such-round/next"), t, Map.of()));
    }

    @Test
    void storiesPatternsSentencesAndThePhasentest() throws Exception {
        String t = anna();
        String storyId = StoryService.id(stories.groups().get(0).stories().get(0).get("id"));
        Map<String, Object> progress = ok(get("/api/stories/progress"), t, null);
        assertFalse(((List<?>) progress.get("read")).contains(storyId));
        assertEquals(true, ok(post("/api/stories/" + storyId + "/read"), t, null).get("read"));
        assertTrue(((List<?>) ok(get("/api/stories/progress"), t, null).get("read")).contains(storyId));
        assertEquals(404, status(post("/api/stories/no-such-story/read"), t, null));

        // Muster: the patterns are static JSON; looking at one counts toward today once
        List<Map<String, Object>> patterns = json.readValue(
                mvc.perform(get("/data/patterns.json")).andReturn().getResponse().getContentAsString(), List.class);
        String key = (String) patterns.get(0).get("key");
        assertEquals(true, ok(post("/api/patterns/" + key + "/seen"), t, null).get("counted"));
        assertEquals(false, ok(post("/api/patterns/" + key + "/seen"), t, null).get("counted"));

        // saved sentences: nothing yet, and without a Gemini key nothing is generated
        assertEquals(404, status(get("/api/sentences?word=der%20Hund"), t, null));
        assertEquals(true, ok(post("/api/sentences/generate"), t, Map.of("de", "der Hund", "en", "dog", "cat", "der")).get("needsKey"));

        // Phasentest: overview, a round with both directions as multiple choice, reset
        String phase = stories.groups().get(0).index();
        Map<String, Object> overview = ok(get("/api/phase-tests/" + phase), t, null);
        assertEquals("notStarted", ((Map<String, Object>) overview.get("status")).get("kind"));

        Round round = start(t, "phase", Map.of("phase", phase, "refresh", false));
        Map<String, Object> v = round.view();
        boolean sawEnDe = false;
        for (int i = 0; i < 80 && !"finished".equals(v.get("state")); i++) {
            List<Map<String, Object>> opts = options(v);
            assertEquals(4, opts.size());
            String pick;
            if ("de-en".equals(v.get("dir"))) {
                pick = (String) v.get("prompt"); // the right answer's key is the German word itself
            } else {
                sawEnDe = true;
                opts.forEach(o -> assertEquals(o.get("key"), o.get("text"), "EN→DE choices are German words"));
                pick = (String) opts.get(0).get("key");
            }
            Map<String, Object> answered = act(t, round, "choose", Map.of("key", pick));
            assertNotNull(answered.get("answer"));
            assertEquals(pick, ((Map<String, Object>) answered.get("answer")).get("pick"));
            v = act(t, round, "next", Map.of());
        }
        assertTrue(sawEnDe, "the round reached the EN→DE part");
        assertEquals("finished", v.get("state"));
        overview = ok(get("/api/phase-tests/" + phase), t, null);
        assertEquals("inProgress", ((Map<String, Object>) overview.get("status")).get("kind"));
        overview = ok(post("/api/phase-tests/" + phase + "/reset"), t, null);
        assertEquals("notStarted", ((Map<String, Object>) overview.get("status")).get("kind"));
        assertEquals(400, status(post("/api/drills/phase"), t, Map.of("phase", "abc")));
    }

    @Test
    void theVerbTestOfAPhase() throws Exception {
        String t = anna();
        Map<String, Object> tests = (Map<String, Object>) ok(get("/api/stories/progress"), t, null).get("tests");
        Map<String, Object> verbCard = (Map<String, Object>) ((Map<String, Object>) tests.get("1")).get("verbTest");
        assertNotNull(verbCard, "the story list shows each phase's verb test");
        assertEquals("notStarted", verbCard.get("kind"));

        Map<String, Object> overview = ok(get("/api/phase-tests/1?set=verbs"), t, null);
        assertEquals("verbs", overview.get("set"));
        assertEquals("notStarted", ((Map<String, Object>) overview.get("status")).get("kind"));
        long verbCount = ((Number) ((Map<String, Object>) overview.get("status")).get("total")).longValue();
        assertTrue(verbCount >= 4);

        Round round = start(t, "phase", Map.of("phase", "1", "set", "verbs", "refresh", false));
        Map<String, Object> v = round.view();
        assertEquals("verbs", v.get("set"));
        for (int i = 0; i < 60 && !"finished".equals(v.get("state")); i++) {
            assertTrue(List.of("Verb", "trennbares Verb").contains(v.get("typeLabel")), "only verbs: " + v.get("typeLabel"));
            String pick = "de-en".equals(v.get("dir")) ? (String) v.get("prompt") : (String) options(v).get(0).get("key");
            act(t, round, "choose", Map.of("key", pick));
            v = act(t, round, "next", Map.of());
        }
        assertEquals("finished", v.get("state"));
        assertEquals("inProgress", ((Map<String, Object>) ok(get("/api/phase-tests/1?set=verbs"), t, null).get("status")).get("kind"));
        assertEquals("notStarted", ((Map<String, Object>) ok(get("/api/phase-tests/1"), t, null).get("status")).get("kind"),
                "the word test keeps its own progress");
        assertEquals("inProgress", ((Map<String, Object>) ((Map<String, Object>) ((Map<String, Object>)
                ok(get("/api/stories/progress"), t, null).get("tests")).get("1")).get("verbTest")).get("kind"));

        // a retake at any time: only its score is kept, progress stays as it was
        Map<String, Object> statusBefore = (Map<String, Object>) ok(get("/api/phase-tests/1?set=verbs"), t, null).get("status");
        Round retake = start(t, "phase", Map.of("phase", "1", "set", "verbs", "retake", "short"));
        assertEquals("short", retake.view().get("retake"));
        v = retake.view();
        for (int i = 0; i < 40 && !"finished".equals(v.get("state")); i++) {
            act(t, retake, "choose", Map.of("key", options(v).get(0).get("key")));
            v = act(t, retake, "next", Map.of());
        }
        assertEquals("finished", v.get("state"));
        overview = ok(get("/api/phase-tests/1?set=verbs"), t, null);
        assertEquals(statusBefore, overview.get("status"), "a retake changes no progress");
        List<Map<String, Object>> attempts = (List<Map<String, Object>>) overview.get("attempts");
        assertEquals(1, attempts.size());
        assertEquals("short", attempts.get(0).get("size"));
        assertEquals(400, status(post("/api/drills/phase"), t, Map.of("phase", "1", "retake", "huge")));

        overview = ok(post("/api/phase-tests/1/reset?set=verbs"), t, null);
        assertEquals("notStarted", ((Map<String, Object>) overview.get("status")).get("kind"));
        assertEquals(400, status(get("/api/phase-tests/1?set=nouns"), t, null));
        assertEquals(400, status(post("/api/drills/phase"), t, Map.of("phase", "1", "set", "nouns")));
    }

    // ---- Talkloop ----

    @Test
    void talkloopReadsTheLearntWordsWithItsLink() throws Exception {
        String t = login(BEN, "ben-test-pw");
        assertEquals(401, status(post("/api/talkloop/link"), null, null));
        String link = (String) ok(post("/api/talkloop/link"), t, null).get("token");
        int before = ((Number) ok(get("/api/talkloop/words"), link, null).get("count")).intValue();

        Round study = start(t, "study", Map.of());
        String de = (String) ((Map<String, Object>) study.view().get("card")).get("de");
        act(t, study, "grade", Map.of("grade", "again"));

        MvcResult r = send(get("/api/talkloop/words"), link, null);
        assertEquals(200, r.getResponse().getStatus());
        assertNull(r.getResponse().getHeader("X-Auth-Token"), "a link is never renewed");
        Map<String, Object> words = json.readValue(r.getResponse().getContentAsString(), Map.class);
        assertTrue(((Number) words.get("count")).intValue() >= Math.max(1, before));
        Map<String, Object> w = ((List<Map<String, Object>>) words.get("words")).stream()
                .filter(x -> de.equals(x.get("de"))).findFirst().orElseThrow();
        assertNotNull(w.get("en"));
        assertEquals(1, ((Number) w.get("box")).intValue());

        // the link only reads words; a session doesn't read them
        assertEquals(401, status(get("/api/summary"), link, null));
        assertEquals(401, status(post("/api/talkloop/link"), link, null));
        assertEquals(401, status(get("/api/talkloop/words"), t, null));
        assertEquals(401, status(get("/api/talkloop/words"), null, null));
    }

    private Map<String, Object> mcp(String link, String method, Map<String, Object> params) throws Exception {
        Map<String, Object> answer = ok(post("/mcp/" + link + "?tz=Asia/Kolkata"), null,
                Map.of("jsonrpc", "2.0", "id", 7, "method", method, "params", params));
        assertEquals(7, ((Number) answer.get("id")).intValue());
        return answer;
    }

    private Map<String, Object> mcpCall(String link, String name, Map<String, Object> args) throws Exception {
        Map<String, Object> result = (Map<String, Object>) mcp(link, "tools/call", Map.of("name", name, "arguments", args)).get("result");
        assertNull(result.get("isError"), String.valueOf(result));
        return result;
    }

    private String mcpTool(String link, String name, Map<String, Object> args) throws Exception {
        return (String) ((List<Map<String, Object>>) mcpCall(link, name, args).get("content")).get(0).get("text");
    }

    @Test
    void chatGptRunsTalkloopOverMcp() throws Exception {
        firebase.addUser("gpt@test.local", "gpt-test-pw"); // a learner of its own: this writes to the mistake log and schedule
        String t = login("gpt@test.local", "gpt-test-pw");
        String link = (String) ok(post("/api/talkloop/link"), t, null).get("token");

        Map<String, Object> init = (Map<String, Object>) mcp(link, "initialize",
                Map.of("protocolVersion", "2025-06-18", "capabilities", Map.of(), "clientInfo", Map.of("name", "test", "version", "1"))).get("result");
        assertEquals("2025-06-18", init.get("protocolVersion"));
        assertEquals(202, status(post("/mcp/" + link), null, Map.of("jsonrpc", "2.0", "method", "notifications/initialized")));
        List<Map<String, Object>> tools = (List<Map<String, Object>>) ((Map<String, Object>) mcp(link, "tools/list", Map.of()).get("result")).get("tools");
        assertEquals(List.of("start_talkloop", "talkloop_turn", "talkloop_peek", "talkloop_check", "talkloop_lookup"), tools.stream().map(x -> x.get("name")).toList());
        // only the start shows the screen: a reply updates it instead of showing another one
        assertEquals("ui://talkloop/screen.html", ((Map<String, Object>) ((Map<String, Object>) tools.get(0).get("_meta")).get("ui")).get("resourceUri"));
        assertNull(tools.get(1).get("_meta"));
        assertEquals(-32601, ((Number) ((Map<String, Object>) mcp(link, "nope", Map.of()).get("error")).get("code")).intValue());

        // the Talkloop screen: an MCP App resource, told where to ask for its state
        Map<String, Object> resource = ((List<Map<String, Object>>) ((Map<String, Object>) mcp(link, "resources/read",
                Map.of("uri", "ui://talkloop/screen.html")).get("result")).get("contents")).get(0);
        assertEquals("text/html;profile=mcp-app", resource.get("mimeType"));
        assertTrue(((String) resource.get("text")).contains("const ORIGIN = \"http://localhost"));
        assertEquals(Map.of("microphone", Map.of()), ((Map<String, Object>) ((Map<String, Object>) resource.get("_meta")).get("ui")).get("permissions"));

        // a learnt word comes up as one of today's words, in English only on the screen
        Round study = start(t, "study", Map.of());
        Map<String, Object> card = (Map<String, Object>) study.view().get("card");
        String de = (String) card.get("de");
        act(t, study, "grade", Map.of("grade", "again"));
        Map<String, Object> started = mcpCall(link, "start_talkloop", Map.of("mode", "topic", "level", "B1"));
        String instructions = (String) ((List<Map<String, Object>>) started.get("content")).get(0).get("text");
        assertTrue(instructions.contains("Today's words") && instructions.contains(de), instructions);
        assertTrue(instructions.contains("Today's topic"));
        Map<String, Object> screen = (Map<String, Object>) started.get("structuredContent");
        String screenId = (String) screen.get("id");
        assertEquals(screenId, ((Map<String, Object>) started.get("_meta")).get("openai/widgetSessionId"));
        Map<String, Object> chip = ((List<Map<String, Object>>) screen.get("words")).stream()
                .filter(w -> card.get("en").equals(w.get("en"))).findFirst().orElseThrow();
        assertNull(chip.get("de"), "the German stays hidden until it is said");
        String noVocab = mcpTool(link, "start_talkloop", Map.of("mode", "interview", "level", "B1", "use_vocab", false));
        assertFalse(noVocab.contains("Today's words") || noVocab.contains(de), noVocab);

        // ChatGPT's opening line, then a turn: shown on the screen, the word moves along the
        // speaking schedule and the mistake is saved where Talkloop's page reads it
        mcpCall(link, "talkloop_turn", Map.of("screen_id", screenId, "said", "", "reply", "Hallo! Was meinst du?"));
        Map<String, Object> turn = (Map<String, Object>) mcpCall(link, "talkloop_turn", Map.of("screen_id", screenId,
                "said", "Ich habe gegeht", "correction", "Ich bin gegangen.", "mistakes", List.of("perfekt_auxiliary", "participle"),
                "used_words", List.of(Map.of("word", de, "correct", true)), "reply", "Super!", "suggestions", List.of("Ja.", "Nein."))).get("structuredContent");
        List<Map<String, Object>> messages = (List<Map<String, Object>>) turn.get("messages");
        assertEquals(List.of("partner", "learner", "partner"), messages.stream().map(m -> m.get("who")).toList());
        assertEquals("Ich bin gegangen.", messages.get(1).get("correction"));
        assertEquals(de, ((List<Map<String, Object>>) turn.get("words")).stream()
                .filter(w -> card.get("en").equals(w.get("en"))).findFirst().orElseThrow().get("de"));
        Map<String, Object> spoken = (Map<String, Object>) ((Map<String, Object>) ok(post("/api/talkloop/spoken"), link,
                Map.of("words", Map.of())).get("words")).get(de);
        assertEquals(1, ((Number) spoken.get("stage")).intValue());
        List<Map<String, Object>> mistakes = (List<Map<String, Object>>) ((Map<String, Object>) ((Map<String, Object>) ok(post("/api/talkloop/mistakes"), link,
                Map.of("languages", Map.of())).get("languages")).get("German")).get("entries");
        assertEquals(2, mistakes.size());
        assertEquals("Ich bin gegangen.", mistakes.get(0).get("fix"));

        // LanguageTool's correction of an uncorrected message becomes the correction, and is logged
        Map<String, Object> checked = (Map<String, Object>) mcpCall(link, "talkloop_turn", Map.of("screen_id", screenId,
                "said", "Ich gehe morgen in die Kino", "reply", "Schön!")).get("structuredContent");
        checked = (Map<String, Object>) mcpCall(link, "talkloop_check", Map.of("screen_id", screenId, "said", "Ich gehe morgen in die Kino",
                "correction", "Ich gehe morgen ins Kino", "mistakes", List.of("case_article"), "tip", "Grammar check: ins")).get("structuredContent");
        List<Map<String, Object>> after = (List<Map<String, Object>>) checked.get("messages");
        assertEquals("Ich gehe morgen ins Kino", after.get(after.size() - 2).get("correction"));
        assertEquals(3, ((List<?>) ((Map<String, Object>) ((Map<String, Object>) ok(post("/api/talkloop/mistakes"), link,
                Map.of("languages", Map.of())).get("languages")).get("German")).get("entries")).size());

        // a tapped word's meaning comes from the vocabulary
        String tapped = de.replaceFirst("^(der|die|das) ", "").split(" ")[0]; // one word of a reply, as tapped
        Map<String, Object> gloss = (Map<String, Object>) mcpCall(link, "talkloop_lookup", Map.of("word", tapped)).get("structuredContent");
        assertEquals(true, gloss.get("found"), String.valueOf(gloss));

        // the screen reads the same state with nothing but its id, from any origin
        MvcResult state = mvc.perform(get("/talkloop-screen/" + screenId).header("Origin", "null")).andReturn();
        assertEquals(200, state.getResponse().getStatus());
        assertEquals("*", state.getResponse().getHeader("Access-Control-Allow-Origin"));
        assertEquals(checked.get("version"), json.readValue(state.getResponse().getContentAsString(), Map.class).get("version"));
        assertEquals(410, mvc.perform(get("/talkloop-screen/nope")).andReturn().getResponse().getStatus());

        // Mein Leben starts from themes; a subject talked about is left alone by later chats, here and on Talkloop's page
        Map<String, Object> life = mcpCall(link, "start_talkloop", Map.of("mode", "life", "level", "A2"));
        assertTrue(((String) ((List<Map<String, Object>>) life.get("content")).get(0).get("text")).contains("Set subject to exactly the theme's name"));
        String lifeId = (String) ((Map<String, Object>) life.get("structuredContent")).get("id");
        mcpCall(link, "talkloop_turn", Map.of("screen_id", lifeId, "said", "", "reply", "Hallo! Erzähl mal von deiner Heimatstadt.", "subject", "your hometown"));
        assertTrue(((List<?>) ok(get("/api/talkloop/chats"), link, null).get("subjects")).contains("your hometown"));

        // Dolmetscher: the sentence to say is shown; a wrong try goes into the deck Talkloop's page uses
        String interpId = (String) ((Map<String, Object>) mcpCall(link, "start_talkloop", Map.of("mode", "interpret", "level", "A2"))
                .get("structuredContent")).get("id");
        Map<String, Object> first = (Map<String, Object>) mcpCall(link, "talkloop_turn", Map.of("screen_id", interpId, "said", "",
                "reply", "Los geht's!", "task", "I am tired.")).get("structuredContent");
        assertEquals("I am tired.", ((List<Map<String, Object>>) first.get("messages")).get(0).get("task"));
        Map<String, Object> second = mcpCall(link, "talkloop_turn", Map.of("screen_id", interpId, "said", "Ich habe müde",
                "correction", "Ich bin müde.", "reply", "Fast!", "task", "The bus is late."));
        assertTrue(((String) ((List<Map<String, Object>>) second.get("content")).get(0).get("text")).contains("The bus is late."));
        Map<String, Object> deck = (Map<String, Object>) ok(post("/api/talkloop/sentences"), link, Map.of("sentences", Map.of())).get("sentences");
        Map<String, Object> tired = (Map<String, Object>) deck.get("i am tired");
        assertEquals("Ich bin müde.", tired.get("de"));
        assertEquals(0, ((Number) tired.get("stage")).intValue());

        // Konnektoren: one connector with its rule, or a mix up to the level; no words, no answer suggestions
        Map<String, Object> weil = mcpCall(link, "start_talkloop", Map.of("mode", "connectors", "level", "A2", "connector", "weil"));
        String weilText = (String) ((List<Map<String, Object>>) weil.get("content")).get(0).get("text");
        assertTrue(weilText.contains("„weil“ (because). Rule:") && !weilText.contains("Today's words"), weilText);
        String weilId = (String) ((Map<String, Object>) weil.get("structuredContent")).get("id");
        Map<String, Object> joined = (Map<String, Object>) mcpCall(link, "talkloop_turn", Map.of("screen_id", weilId, "said", "",
                "reply", "Los geht's!", "task", "Verbinde mit „weil“: Ich bleibe zu Hause. + Ich bin krank.", "suggestions", List.of("Ich bleibe zu Hause, weil ich krank bin."))).get("structuredContent");
        Map<String, Object> pair = ((List<Map<String, Object>>) joined.get("messages")).get(0);
        assertEquals("Verbinde mit „weil“: Ich bleibe zu Hause. + Ich bin krank.", pair.get("task"));
        assertEquals(List.of(), pair.get("suggestions"));
        Map<String, Object> noTask = (Map<String, Object>) mcp(link, "tools/call", Map.of("name", "talkloop_turn",
                "arguments", Map.of("screen_id", weilId, "said", "Ich bleibe zu Hause, weil ich krank bin.", "reply", "Super!"))).get("result");
        assertEquals(true, noTask.get("isError")); // the drill goes on: every turn gives the next pair
        String mix = mcpTool(link, "start_talkloop", Map.of("mode", "connectors", "level", "A1"));
        assertTrue(mix.contains("„denn“") && !mix.contains("„weil“"), mix); // A1 only
        assertTrue(mcpTool(link, "start_talkloop", Map.of("mode", "connectors", "level", "B1", "connector", "um … zu")).contains("„um … zu“ (in order to). Rule:"));
        Map<String, Object> noSuch = (Map<String, Object>) mcp(link, "tools/call", Map.of("name", "start_talkloop",
                "arguments", Map.of("mode", "connectors", "level", "B1", "connector", "xyz"))).get("result");
        assertEquals(true, noSuch.get("isError"));

        // Talkloop's Piper voice code can be loaded by the screen
        assertEquals("*", mvc.perform(get("/talkloop/piper.js").header("Origin", "null")).andReturn().getResponse().getHeader("Access-Control-Allow-Origin"));

        // a bad call is a tool error ChatGPT can read; without a valid link there is no connection
        Map<String, Object> bad = (Map<String, Object>) mcp(link, "tools/call", Map.of("name", "start_talkloop", "arguments", Map.of("mode", "x", "level", "B1"))).get("result");
        assertEquals(true, bad.get("isError"));
        assertEquals(401, status(post("/mcp/not-a-link"), null, Map.of("jsonrpc", "2.0", "id", 1, "method", "ping")));
        assertEquals(401, status(post("/mcp/" + t), null, Map.of("jsonrpc", "2.0", "id", 1, "method", "ping")));
    }

    @Test
    void talkloopSyncsItsMistakeLogAcrossDevices() throws Exception {
        String t = login(BEN, "ben-test-pw");
        String link = (String) ok(post("/api/talkloop/link"), t, null).get("token");
        long now = System.currentTimeMillis();
        Map<String, Object> laptopMistake = Map.of("type", "perfekt_auxiliary", "at", now - 5000,
                "said", "Ich habe gefahren.", "fix", "Ich bin gefahren.");
        Map<String, Object> phoneMistake = Map.of("type", "case_article", "at", now - 3000,
                "said", "Ich sehe der Mann.", "fix", "Ich sehe den Mann.");

        // The laptop sends its new mistake (twice: a retried sync must not duplicate it).
        Map<String, Object> laptop = Map.of("languages", Map.of("German", Map.of("resetAt", 0, "entries", List.of(laptopMistake))));
        ok(post("/api/talkloop/mistakes"), link, laptop);
        assertEquals(1, germanEntries(ok(post("/api/talkloop/mistakes"), link, laptop)).size());

        // The phone sends its own and gets both back, oldest first.
        List<Map<String, Object>> both = germanEntries(ok(post("/api/talkloop/mistakes"), link,
                Map.of("languages", Map.of("German", Map.of("resetAt", 0, "entries", List.of(phoneMistake))))));
        assertEquals(List.of("perfekt_auxiliary", "case_article"), both.stream().map(m -> m.get("type")).toList());

        // A device that only pulls gets everything and costs no write.
        int writes = firestore.talkloopMistakeWrites();
        Map<String, Object> pulled = ok(post("/api/talkloop/mistakes"), link, Map.of("languages", Map.of()));
        assertEquals(2, germanEntries(pulled).size());
        assertEquals(writes, firestore.talkloopMistakeWrites());

        // Malformed entries are skipped, long texts cut, unknown shapes refused.
        List<Map<String, Object>> after = germanEntries(ok(post("/api/talkloop/mistakes"), link, Map.of("languages", Map.of(
                "German", Map.of("entries", List.of(
                        Map.of("type", "Bad Type!", "at", now, "said", "x", "fix", "y"),
                        Map.of("type", "plural", "at", now + 7 * 86_400_000L, "said", "x", "fix", "y"),
                        Map.of("type", "plural", "at", now - 1000, "said", "x".repeat(1000), "fix", "y"))),
                "<script>", Map.of("entries", List.of(phoneMistake))))));
        assertEquals(3, after.size());
        assertEquals(300, ((String) after.get(2).get("said")).length());
        assertEquals(400, status(post("/api/talkloop/mistakes"), link, Map.of("languages", "German")));

        // A reset on one device clears the log for all, and an old entry sent afterwards stays out.
        assertEquals(0, germanEntries(ok(post("/api/talkloop/mistakes"), link,
                Map.of("languages", Map.of("German", Map.of("resetAt", now, "entries", List.of()))))).size());
        assertEquals(0, germanEntries(ok(post("/api/talkloop/mistakes"), link, laptop)).size());

        // Only the newest are kept.
        List<Map<String, Object>> many = new java.util.ArrayList<>();
        for (int i = 1; i <= 350; i++) {
            many.add(Map.of("type", "plural", "at", now + i, "said", "Satz " + i, "fix", "Satz " + i + "."));
        }
        List<Map<String, Object>> kept = germanEntries(ok(post("/api/talkloop/mistakes"), link,
                Map.of("languages", Map.of("German", Map.of("entries", many)))));
        assertEquals(300, kept.size());
        assertEquals("Satz 51", kept.get(0).get("said"));

        // Like the learnt words: the link only, never renewed; a session can't use it.
        MvcResult r = send(post("/api/talkloop/mistakes"), link, Map.of("languages", Map.of()));
        assertEquals(200, r.getResponse().getStatus());
        assertNull(r.getResponse().getHeader("X-Auth-Token"));
        assertEquals(401, status(post("/api/talkloop/mistakes"), t, Map.of("languages", Map.of())));
        assertEquals(401, status(post("/api/talkloop/mistakes"), null, Map.of("languages", Map.of())));
    }

    @Test
    @SuppressWarnings("unchecked")
    void talkloopSyncsItsSpeakingScheduleAcrossDevices() throws Exception {
        String t = login(BEN, "ben-test-pw");
        String link = (String) ok(post("/api/talkloop/link"), t, null).get("token");
        long now = System.currentTimeMillis();

        // The laptop records two words; the phone then sends an older and a newer version.
        ok(post("/api/talkloop/spoken"), link, Map.of("words", Map.of(
                "die Haltestelle", Map.of("stage", 2, "due", now + 86_400_000L, "uses", 3, "lastDay", "2026-10-20", "updatedAt", now - 5000),
                "warum", Map.of("stage", 4, "due", now, "uses", 9, "lastDay", "2026-10-19", "updatedAt", now - 5000))));
        Map<String, Object> words = (Map<String, Object>) ok(post("/api/talkloop/spoken"), link, Map.of("words", Map.of(
                "die Haltestelle", Map.of("stage", 1, "updatedAt", now - 9000),
                "warum", Map.of("stage", 1, "uses", 10, "updatedAt", now - 1000),
                "bad", Map.of("stage", 7, "updatedAt", now),
                "der Juni", Map.of("stage", 1, "lastDay", "<script>", "updatedAt", now)))).get("words");
        assertEquals(2, ((Number) ((Map<String, Object>) words.get("die Haltestelle")).get("stage")).intValue());
        assertEquals(1, ((Number) ((Map<String, Object>) words.get("warum")).get("stage")).intValue());
        assertEquals("", ((Map<String, Object>) words.get("der Juni")).get("lastDay"));
        assertNull(words.get("bad"));

        // A pull alone costs no write; a session can't use it; a wrong shape is refused.
        int writes = firestore.talkloopSpokenWrites();
        assertEquals(3, ((Map<String, Object>) ok(post("/api/talkloop/spoken"), link, Map.of("words", Map.of())).get("words")).size());
        assertEquals(writes, firestore.talkloopSpokenWrites());
        assertEquals(401, status(post("/api/talkloop/spoken"), t, Map.of("words", Map.of())));
        // The Cloudflare route is Talkloop's too: a session or nobody can't use it, and the link
        // is checked before anything is forwarded (a malformed request stops at 400).
        Map<String, Object> chat = Map.of("messages", List.of(Map.of("role", "user", "content", "Hallo")));
        assertEquals(401, status(post("/api/talkloop/cloudflare"), t, chat));
        assertEquals(401, status(post("/api/talkloop/cloudflare"), null, chat));
        assertEquals(400, status(post("/api/talkloop/cloudflare"), link, chat));
        assertEquals(400, status(post("/api/talkloop/spoken"), link, Map.of("words", List.of())));
    }

    @Test
    @SuppressWarnings("unchecked")
    void talkloopSyncsItsSentenceDeckAcrossDevices() throws Exception {
        String t = login(BEN, "ben-test-pw");
        String link = (String) ok(post("/api/talkloop/link"), t, null).get("token");
        long now = System.currentTimeMillis();

        // The laptop records two sentences; the phone then sends an older and a newer version.
        ok(post("/api/talkloop/sentences"), link, Map.of("sentences", Map.of(
                "i am looking for the station", Map.of("say", "I am looking for the station.", "de", "Ich suche den Bahnhof.",
                        "stage", 2, "due", now + 86_400_000L, "misses", 1, "updatedAt", now - 5000),
                "can i pay by card", Map.of("say", "Can I pay by card?", "de", "Kann ich mit Karte zahlen?",
                        "stage", 1, "due", now, "updatedAt", now - 5000))));
        Map<String, Object> deck = (Map<String, Object>) ok(post("/api/talkloop/sentences"), link, Map.of("sentences", Map.of(
                "i am looking for the station", Map.of("say", "I am looking for the station.", "stage", 0, "updatedAt", now - 9000),
                "can i pay by card", Map.of("say", "Can I pay by card?", "de", "Kann ich mit Karte bezahlen?", "stage", 0, "misses", 1, "updatedAt", now - 1000),
                "no text", Map.of("stage", 1, "updatedAt", now),
                "bad stage", Map.of("say", "Bad.", "stage", 9, "updatedAt", now)))).get("sentences");
        Map<String, Object> station = (Map<String, Object>) deck.get("i am looking for the station");
        Map<String, Object> card = (Map<String, Object>) deck.get("can i pay by card");
        assertEquals(2, ((Number) station.get("stage")).intValue());
        assertEquals("Ich suche den Bahnhof.", station.get("de"));
        assertEquals(0, ((Number) card.get("stage")).intValue());
        assertEquals("Kann ich mit Karte bezahlen?", card.get("de"));
        assertNull(deck.get("no text"));
        assertNull(deck.get("bad stage"));

        // A pull alone costs no write; a session can't use it; a wrong shape is refused.
        int writes = firestore.talkloopSentenceWrites();
        assertEquals(2, ((Map<String, Object>) ok(post("/api/talkloop/sentences"), link, Map.of("sentences", Map.of())).get("sentences")).size());
        assertEquals(writes, firestore.talkloopSentenceWrites());
        assertEquals(401, status(post("/api/talkloop/sentences"), t, Map.of("sentences", Map.of())));
        assertEquals(400, status(post("/api/talkloop/sentences"), link, Map.of("sentences", List.of())));
    }

    @Test
    @SuppressWarnings("unchecked")
    void talkloopKeepsTopicChatsAndTheTopicsDiscussed() throws Exception {
        String t = login(BEN, "ben-test-pw");
        String link = (String) ok(post("/api/talkloop/link"), t, null).get("token");
        assertEquals(List.of(), ok(get("/api/talkloop/chats"), link, null).get("chats"));

        ok(post("/api/talkloop/chats/100"), link, Map.of("topic", "Homeoffice oder Büro?", "at", 1000, "data", "{\"log\":[]}"));
        ok(post("/api/talkloop/chats/200"), link, Map.of("topic", "Stadt oder Land?", "at", 2000, "data", "{}"));
        // The same chat saved again (it went on) replaces itself.
        ok(post("/api/talkloop/chats/100"), link, Map.of("topic", "Homeoffice oder Büro?", "at", 3000, "data", "{\"log\":[1]}"));
        Map<String, Object> all = ok(get("/api/talkloop/chats"), link, null);
        List<Map<String, Object>> chats = (List<Map<String, Object>>) all.get("chats");
        assertEquals(List.of("100", "200"), chats.stream().map(c -> c.get("id")).toList());
        assertEquals("{\"log\":[1]}", chats.get(0).get("data"));
        assertEquals(List.of("Stadt oder Land?", "Homeoffice oder Büro?"), all.get("topics"));

        // A free chat or interview adds its subjects, not its title: newest first, without repeats,
        // one talked about again moved to the front.
        ok(post("/api/talkloop/chats/250"), link, Map.of("topic", "Interview: work", "at", 2500, "data", "{}",
                "mode", "interview", "subjects", List.of("Work", "weekend plans")));
        ok(post("/api/talkloop/chats/260"), link, Map.of("topic", "Free chat: food", "at", 2600, "data", "{}",
                "mode", "lead", "subjects", List.of("favourite food", "work")));
        all = ok(get("/api/talkloop/chats"), link, null);
        assertEquals(List.of("work", "favourite food", "weekend plans"), all.get("subjects"));
        assertEquals(List.of("Stadt oder Land?", "Homeoffice oder Büro?"), all.get("topics"));
        ok(delete("/api/talkloop/chats/250"), link, null);
        ok(delete("/api/talkloop/chats/260"), link, null);

        // A deleted chat's topic still counts as discussed.
        ok(delete("/api/talkloop/chats/100"), link, null);
        all = ok(get("/api/talkloop/chats"), link, null);
        assertEquals(1, ((List<?>) all.get("chats")).size());
        assertEquals(2, ((List<?>) all.get("topics")).size());

        // Only the newest chats are kept.
        for (int i = 0; i < 25; i++) {
            ok(post("/api/talkloop/chats/c" + i), link, Map.of("topic", "Thema " + i, "at", 10_000 + i, "data", "{}"));
        }
        chats = (List<Map<String, Object>>) ok(get("/api/talkloop/chats"), link, null).get("chats");
        assertEquals(20, chats.size());
        assertEquals("c24", chats.get(0).get("id"));

        assertEquals(400, status(post("/api/talkloop/chats/bad.id"), link, Map.of("topic", "x", "at", 1, "data", "{}")));
        assertEquals(400, status(post("/api/talkloop/chats/300"), link, Map.of("topic", "x", "at", 1)));
        assertEquals(401, status(get("/api/talkloop/chats"), t, null));
        assertEquals(401, status(get("/api/talkloop/chats"), null, null));
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> germanEntries(Map<String, Object> answer) {
        Map<String, Object> german = (Map<String, Object>) ((Map<String, Object>) answer.get("languages")).get("German");
        return german == null ? List.of() : (List<Map<String, Object>>) german.get("entries");
    }

    @Test
    void talkloopIsServedByThisApp() throws Exception {
        assertEquals(302, mvc.perform(get("/talkloop")).andReturn().getResponse().getStatus());
        MvcResult page = mvc.perform(get("/talkloop/")).andReturn();
        assertEquals(200, page.getResponse().getStatus());
        assertEquals("/talkloop/index.html", page.getResponse().getForwardedUrl());
        assertEquals(200, mvc.perform(get("/talkloop/app.js")).andReturn().getResponse().getStatus());
    }

    // ---- separate users ----

    @Test
    void usersNeverSeeEachOthersData() throws Exception {
        String a = anna();
        String b = login(BEN, "ben-test-pw");

        ok(post("/api/settings/setTheme"), a, Map.of("value", "dark"));
        ok(post("/api/settings/setTheme"), b, Map.of("value", "light"));
        Round annas = start(a, "study", Map.of());
        act(a, annas, "grade", Map.of("grade", "good"));
        String pattern = (String) ((Map<String, Object>) json.readValue(
                mvc.perform(get("/data/patterns.json")).andReturn().getResponse().getContentAsString(), List.class).get(1)).get("key");
        assertEquals(true, ok(post("/api/patterns/" + pattern + "/seen"), a, null).get("counted"));

        assertEquals("dark", ((Map<String, Object>) ok(get("/api/summary"), a, null).get("settings")).get("theme"));
        assertEquals("light", ((Map<String, Object>) ok(get("/api/summary"), b, null).get("settings")).get("theme"));
        assertNotEquals(firestore.raw("uid1").get("srs"), firestore.raw("uid2").get("srs"));
        assertNull(firestore.raw("uid2").get("srs"), "Ben has graded nothing");

        // Ben can't continue Anna's round, and Anna's pattern view doesn't use up Ben's
        assertEquals(410, status(post("/api/drills/" + annas.id() + "/grade"), b, Map.of("grade", "good")));
        assertEquals(true, ok(post("/api/patterns/" + pattern + "/seen"), b, null).get("counted"));
    }
}
