package com.vocabtrainer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
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
import com.vocabtrainer.service.German;
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
                props.vocab(), props.github(), new AppProperties.Auth(a.jwtSecret(), Duration.ZERO, a.adminKey())), json);
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

        Map<String, Object> after = ok(post("/api/settings/setTheme"), t, Map.of("value", "dark"));
        assertEquals("dark", after.get("theme"));
        after = ok(post("/api/settings/toggleLevel"), t, Map.of("value", "B1"));
        assertTrue(((List<String>) after.get("levels")).contains("B1"));
        after = ok(post("/api/settings/toggleDirection"), t, Map.of());
        assertEquals("en-de", after.get("direction"));
        ok(post("/api/settings/toggleDirection"), t, Map.of());
        after = ok(post("/api/settings/setFocus"), t, Map.of("value", "all"));
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

        Round flash = start(t, "flash", Map.of());
        assertNotNull(flash.view().get("front"));
        act(t, flash, "knew", Map.of());
        act(t, flash, "next", Map.of());
        act(t, flash, "prev", Map.of());

        // a few quiz questions, at least one answered wrong → the word lands on the Review list
        Round quiz = start(t, "quiz", Map.of());
        boolean missed = false;
        Map<String, Object> q = quiz.view();
        for (int i = 0; i < 12 && !missed; i++) {
            Object pick = options(q).get(0).get("key");
            Map<String, Object> answered = act(t, quiz, "answer", Map.of("key", pick));
            assertEquals(pick, answered.get("picked"));
            missed = !pick.equals(answered.get("correctKey"));
            q = act(t, quiz, "next", Map.of());
        }
        assertTrue(missed, "got a wrong answer in");
        act(t, quiz, "finish", Map.of());
        long mistakes = ((Number) ok(get("/api/summary"), t, null).get("mistakeCount")).longValue();
        assertTrue(mistakes >= 1, "missed word is on the Review list");

        Round review = start(t, "review", Map.of());
        assertFalse(options(review.view()).isEmpty());
        act(t, review, "answer", Map.of("key", options(review.view()).get(0).get("key")));
        act(t, review, "next", Map.of());

        Round articles = start(t, "articles", Map.of());
        act(t, articles, "answer", Map.of("article", "der"));
        act(t, articles, "next", Map.of());

        Round sep = start(t, "sep", Map.of());
        List<Object> prefixes = (List<Object>) sep.view().get("options");
        act(t, sep, "answer", Map.of("prefix", prefixes.get(0)));
        act(t, sep, "next", Map.of());

        Round cloze = start(t, "cloze", Map.of());
        act(t, cloze, "answer", Map.of("key", options(cloze.view()).get(0).get("key")));
        act(t, cloze, "next", Map.of());

        assertEquals(404, status(post("/api/drills/nonsense"), t, Map.of()));
        assertEquals(410, status(post("/api/drills/no-such-round/next"), t, Map.of()));
    }

    @Test
    void storiesPatternsSentencesAndThePhasentest() throws Exception {
        String t = anna();
        Map<String, Object> list = ok(get("/api/stories"), t, null);
        List<Map<String, Object>> groups = (List<Map<String, Object>>) list.get("groups");
        Map<String, Object> firstStory = ((List<Map<String, Object>>) groups.get(0).get("stories")).get(0);
        String storyId = (String) firstStory.get("id");
        Map<String, Object> reader = ok(get("/api/stories/" + storyId), t, null);
        assertEquals(false, reader.get("read"));
        assertEquals(true, ok(post("/api/stories/" + storyId + "/read"), t, null).get("read"));
        assertEquals(true, ok(get("/api/stories/" + storyId), t, null).get("read"));
        assertEquals(404, status(get("/api/stories/no-such-story"), t, null));

        // Muster: counts toward today once per pattern
        List<Map<String, Object>> patterns = json.readValue(
                send(get("/api/patterns"), t, null).getResponse().getContentAsString(), List.class);
        String key = (String) patterns.get(0).get("key");
        assertEquals(true, ok(post("/api/patterns/" + key + "/seen"), t, null).get("counted"));
        assertEquals(false, ok(post("/api/patterns/" + key + "/seen"), t, null).get("counted"));

        // saved sentences: nothing yet, and without a Gemini key nothing is generated
        assertEquals(404, status(get("/api/sentences?word=der%20Hund"), t, null));
        assertEquals(true, ok(post("/api/sentences/generate"), t, Map.of("de", "der Hund", "en", "dog", "cat", "der")).get("needsKey"));

        // Phasentest: overview, a round with both directions as multiple choice, reset
        String phase = (String) ((Map<String, Object>) groups.get(0).get("phase")).get("index");
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
                send(get("/api/patterns"), a, null).getResponse().getContentAsString(), List.class).get(1)).get("key");
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
