package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.vocabtrainer.model.Card;
import com.vocabtrainer.model.Gloss;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * The B1 stories: list grouped by phase, each story analysed into words with
 * their meanings (for the reader's tooltips), and each phase's vocabulary for
 * the Phasentest. Everything is derived from the current german_vocab.json and
 * cached until the file changes.
 */
@Service
public class StoryService {

    private static final Pattern TARGET = Pattern.compile("\\*\\*(.+?)\\*\\*");
    private static final Pattern WORD = Pattern.compile("[A-Za-zÄÖÜäöüß]+(?:-[A-Za-zÄÖÜäöüß]+)*");

    /** One word of a phase's test vocabulary. */
    public record PhaseWord(Card card, String type, Object chapter) {
    }

    /** A phase in file order with its stories. */
    public record Group(Map<String, Object> phase, List<Map<String, Object>> stories) {
        public String index() {
            Object i = phase.get("index");
            return i == null ? null : String.valueOf(((Number) i).longValue());
        }
    }

    private record Model(CardCatalog.Data data, List<Group> groups, Map<String, Map<String, Object>> byId,
                         List<Map<String, Object>> flat, WordLookup.Dict globalDict) {
    }

    private final CardCatalog catalog;
    private volatile Model model;
    private final Map<String, Map<String, Object>> readerCache = new ConcurrentHashMap<>();

    public StoryService(CardCatalog catalog) {
        this.catalog = catalog;
    }

    private Model model() {
        CardCatalog.Data data = catalog.data();
        Model m = model;
        if (m == null || m.data() != data) {
            synchronized (this) {
                if (model == null || model.data() != data) {
                    model = build(data);
                    readerCache.clear();
                }
                m = model;
            }
        }
        return m;
    }

    @SuppressWarnings("unchecked")
    private static Model build(CardCatalog.Data data) {
        Map<String, Object> stories = data.stories();
        List<Map<String, Object>> items = maps(stories.get("items"));
        Map<String, Map<String, Object>> byId = new LinkedHashMap<>();
        items.forEach(s -> byId.put(id(s.get("id")), s));
        Set<String> seen = new HashSet<>();
        List<Group> groups = new ArrayList<>();
        for (Map<String, Object> p : maps(stories.get("phases"))) {
            List<Map<String, Object>> list = new ArrayList<>();
            for (Object cid : p.get("chapter_ids") instanceof List<?> l ? l : List.of()) {
                Map<String, Object> s = byId.get(id(cid));
                if (s != null) {
                    list.add(s);
                    seen.add(id(cid));
                }
            }
            if (!list.isEmpty()) {
                groups.add(new Group(p, list));
            }
        }
        List<Map<String, Object>> rest = items.stream().filter(s -> !seen.contains(id(s.get("id"))))
                .sorted((a, b) -> Long.compare(num(a.get("chapter")), num(b.get("chapter")))).toList();
        if (!rest.isEmpty()) {
            Map<String, Object> other = new LinkedHashMap<>();
            other.put("name", "Weitere Geschichten");
            groups.add(new Group(other, rest));
        }
        List<Map<String, Object>> flat = new ArrayList<>();
        groups.forEach(g -> flat.addAll(g.stories()));

        // every story glossary first, then all vocabulary cards (A1 → B1)
        WordLookup.Dict global = new WordLookup.Dict();
        items.forEach(s -> global.addGlossary(maps(s.get("glossary"))));
        for (Card c : data.cards()) {
            global.add(c.de(), c.en(), c.cat(), c.lvl(), c.example(), "verb".equals(c.cat()) || "sep".equals(c.cat()));
        }
        return new Model(data, groups, byId, flat, global);
    }

    public List<Group> groups() {
        return model().groups();
    }

    public Map<String, Object> level() {
        Map<String, Object> s = model().data().stories();
        return Map.of("level", s.getOrDefault("level", "B1"), "count", model().byId().size());
    }

    public Map<String, Object> story(String id) {
        Map<String, Object> s = model().byId().get(id);
        if (s == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no such story");
        }
        return s;
    }

    public Group group(String phaseIndex) {
        return model().groups().stream().filter(g -> phaseIndex.equals(g.index())).findFirst()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "no such phase"));
    }

    /** Previous / next story in reading order, and the phase this story ends (if it's the phase's last). */
    public Map<String, Object> neighbours(String id) {
        Model m = model();
        List<Map<String, Object>> flat = m.flat();
        int i = -1;
        for (int k = 0; k < flat.size(); k++) {
            if (id.equals(id(flat.get(k).get("id")))) {
                i = k;
            }
        }
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("prev", i > 0 ? brief(flat.get(i - 1)) : null);
        out.put("next", i >= 0 && i < flat.size() - 1 ? brief(flat.get(i + 1)) : null);
        String endsPhase = null;
        for (Group g : m.groups()) {
            Object ids = g.phase().get("chapter_ids");
            if (g.index() != null && ids instanceof List<?> l && !l.isEmpty() && id.equals(id(l.get(l.size() - 1)))) {
                endsPhase = g.index();
            }
        }
        out.put("endsPhase", endsPhase);
        return out;
    }

    private static Map<String, Object> brief(Map<String, Object> s) {
        return Map.of("id", id(s.get("id")), "chapter", s.getOrDefault("chapter", ""));
    }

    /** The reader view of one story: paragraphs as words with meanings, translations, glossary. */
    public Map<String, Object> reader(String id) {
        Model m = model();
        return readerCache.computeIfAbsent(id, k -> analyse(m, story(id)));
    }

    private static Map<String, Object> analyse(Model m, Map<String, Object> story) {
        List<Map<String, Object>> glossary = maps(story.get("glossary"));
        WordLookup.Dict own = new WordLookup.Dict();
        own.addGlossary(glossary);
        WordLookup lookup = new WordLookup(List.of(own, m.globalDict()));
        List<String> de = paragraphs(story.get("story_de"));
        List<String> en = paragraphs(story.get("story_en"));
        List<Map<String, Object>> paras = new ArrayList<>();
        for (int i = 0; i < de.size(); i++) {
            List<Map<String, Object>> segs = segments(de.get(i), lookup, glossary);
            StringBuilder plain = new StringBuilder();
            segs.forEach(sg -> plain.append(sg.containsKey("t") ? sg.get("t") : sg.get("w")));
            Map<String, Object> p = new LinkedHashMap<>();
            p.put("segments", segs);
            p.put("en", i < en.size() ? en.get(i) : null);
            p.put("speech", plain.toString());
            paras.add(p);
        }
        List<Map<String, Object>> gl = new ArrayList<>();
        for (Map<String, Object> g : glossary) {
            gl.add(Map.of("de", WordLookup.str(g.get("de")), "en", WordLookup.str(g.get("en")),
                    "cat", java.util.Objects.toString(WordLookup.glossCat(g), "")));
        }
        Map<String, Object> v = new LinkedHashMap<>();
        v.put("id", id(story.get("id")));
        v.put("chapter", story.get("chapter"));
        v.put("phaseName", story.get("phase_name"));
        v.put("titleDe", story.get("title_de"));
        v.put("titleEn", story.get("title_en"));
        v.put("paragraphs", paras);
        v.put("glossary", gl);
        return v;
    }

    /** Paragraph → segments: {t} plain text, or {w, entry, target} for a word with a meaning. */
    static List<Map<String, Object>> segments(String para, WordLookup lookup, List<Map<String, Object>> glossary) {
        List<Map<String, Object>> segs = new ArrayList<>();
        Matcher t = TARGET.matcher(para);
        int last = 0;
        while (t.find()) {
            plainSegments(para.substring(last, t.start()), lookup, segs);
            Gloss g = lookup.lookupTarget(t.group(1), glossary);
            Map<String, Object> s = new LinkedHashMap<>();
            s.put("w", t.group(1));
            s.put("entry", g == null ? null : g.view());
            s.put("target", true);
            segs.add(s);
            last = t.end();
        }
        plainSegments(para.substring(last), lookup, segs);
        return segs;
    }

    private static void plainSegments(String part, WordLookup lookup, List<Map<String, Object>> segs) {
        if (part.isEmpty()) {
            return;
        }
        Matcher m = WORD.matcher(part);
        int last = 0;
        while (m.find()) {
            if (m.start() > last) {
                segs.add(Map.of("t", part.substring(last, m.start())));
            }
            Gloss g = m.group().length() > 1 ? lookup.lookup(m.group()) : null;
            if (g == null) {
                segs.add(Map.of("t", m.group()));
            } else {
                segs.add(Map.of("w", m.group(), "entry", g.view()));
            }
            last = m.end();
        }
        if (last < part.length()) {
            segs.add(Map.of("t", part.substring(last)));
        }
    }

    static List<String> paragraphs(Object text) {
        List<String> out = new ArrayList<>();
        for (String p : String.valueOf(text == null ? "" : text).split("\\n\\s*\\n")) {
            if (!p.trim().isEmpty()) {
                out.add(p.trim());
            }
        }
        return out;
    }

    /** All glossary words of a phase's stories, de-duplicated, in reading order. */
    public List<PhaseWord> phaseWords(String phaseIndex) {
        Group g = group(phaseIndex);
        Set<String> seen = new HashSet<>();
        List<PhaseWord> out = new ArrayList<>();
        for (Map<String, Object> s : g.stories()) {
            for (Map<String, Object> gl : maps(s.get("glossary"))) {
                String de = WordLookup.str(gl.get("de"));
                if (de.isEmpty() || !seen.add(de)) {
                    continue;
                }
                String cat = WordLookup.glossCat(gl);
                Card c = new Card(Card.key("B1", cat, de), de, WordLookup.str(gl.get("en")), cat, "B1",
                        WordLookup.strOrNull(gl.get("example")), null);
                out.add(new PhaseWord(c, WordLookup.str(gl.get("type")), s.get("chapter")));
            }
        }
        return out;
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> maps(Object v) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (v instanceof List<?> l) {
            l.forEach(x -> {
                if (x instanceof Map<?, ?> m) {
                    out.add((Map<String, Object>) m);
                }
            });
        }
        return out;
    }

    public static String id(Object o) {
        if (o instanceof Number n) {
            return String.valueOf(n.longValue());
        }
        return o == null ? null : String.valueOf(o);
    }

    private static long num(Object o) {
        return o instanceof Number n ? n.longValue() : 0;
    }
}
