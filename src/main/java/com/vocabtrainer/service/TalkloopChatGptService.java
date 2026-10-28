package com.vocabtrainer.service;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import java.util.stream.Stream;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.util.Rand;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * Talkloop inside ChatGPT (see {@link McpService}): ChatGPT itself is the conversation
 * partner, on the learner's own ChatGPT plan, and this class gives it what Talkloop's
 * page gives Groq or Gemini: the partner's instructions for a mode and level, today's
 * words from the speaking schedule, the recurring mistakes and the subjects already
 * talked about. Each turn ChatGPT reports back what the learner said, so the speaking
 * schedule and the mistake log stay the same ones Talkloop's page uses.
 *
 * The modes, scenes, topics, level guide and mistake kinds are copied from
 * static/talkloop/app.js (turnSystemPrompt and around it): change them in both places.
 * The instructions are written for a plain chat instead of Talkloop's JSON turns.
 */
@Service
public class TalkloopChatGptService {

    static final String LANGUAGE = "German"; // the mistake log is kept per language, as Talkloop's page keeps it
    static final int TODAY_WORDS = 5;
    private static final int WAITING_WORDS = 5;
    private static final long DAY_MS = 86_400_000L;
    private static final int[] SPOKEN_DAYS = {1, 3, 7, 21}; // due again this many days after reaching stage 1..4
    private static final int AUTOMATIC_RECHECK_DAYS = 60;
    private static final double MISTAKE_HALF_LIFE_DAYS = 7;
    private static final int MAX_SUBJECT_HINTS = 80;
    private static final int MAX_SAID = 300;
    private static final List<String> LEVELS = List.of("A1", "A2", "B1");

    record Mode(String label, String extra) {
    }

    record Scene(String character, String setting, String goal) {
    }

    record Tense(String form, String ask) {
    }

    static final Map<String, Mode> MODES = new LinkedHashMap<>();
    static final Map<String, Scene> SCENES = new LinkedHashMap<>();
    static final Map<String, Tense> TENSES = new LinkedHashMap<>();
    static final Map<String, String> LEVEL_GUIDE = Map.of(
            "A1", "Use only very common everyday words and short main clauses of about 5–8 words, mostly in the present tense (Perfekt only for very common verbs, e.g. war, hatte, habe gemacht). No subordinate clauses. Ask simple, concrete questions about the learner's life, often yes/no or either-or questions. Where it helps, repeat a key word from the learner's message.",
            "A2", "Use common everyday words and short sentences of about 6–10 words. Präsens, Perfekt and the simple future are fine; at most simple weil/dass/wenn clauses. Ask concrete questions about routines, plans, past weekends and preferences.",
            "B1", "Speak naturally but plainly, in sentences of up to about 15 words. Use all common tenses, subordinate clauses (weil, obwohl, dass, wenn, als) and the occasional everyday idiom. Ask the learner for opinions, reasons and short stories about experiences.");
    static final Map<String, String> MISTAKE_TYPES = new LinkedHashMap<>();
    private static final List<String> EASY_TOPICS = List.of(
            "Lieber Kaffee oder lieber Tee?", "Wohnen in der Stadt oder auf dem Land",
            "Sommer oder Winter: Welche Jahreszeit ist besser?", "Hund oder Katze als Haustier",
            "Mit dem Auto oder mit dem Fahrrad zur Arbeit", "Zu Hause kochen oder im Restaurant essen",
            "Urlaub am Meer oder in den Bergen", "Früh aufstehen oder lange schlafen",
            "Allein wohnen oder in einer WG", "Ein Buch lesen oder einen Film sehen");
    private static final List<String> HARDER_TOPICS = List.of(
            "Homeoffice oder Büro: Was ist besser?", "Sind soziale Medien gut oder schlecht für Freundschaften?",
            "Sollten Kinder schon in der Grundschule ein Handy haben?", "Fleisch essen oder vegetarisch leben",
            "Sollte man Autos in der Innenstadt verbieten?", "Online einkaufen oder im Laden?",
            "Wie lernt man eine Fremdsprache am besten?", "Macht Geld glücklich?",
            "Eine Vier-Tage-Woche: eine gute Idee?", "Reisen mit dem Flugzeug oder mit dem Zug");

    static {
        MODES.put("interview", new Mode("Interview me",
                "Interview the learner about their life, day, hobbies, work and opinions. Ask one question at a time, react to the answer, then ask a natural follow-up. Start by greeting them and asking their name or how their day is going."));
        MODES.put("lead", new Mode("Free chat — the partner leads",
                "You lead the whole conversation. Always finish your reply with a question that keeps it going. Follow up on what the learner says, gently change topic when one runs dry, and keep it light and encouraging. Start by greeting the learner warmly and asking one easy opening question."));
        MODES.put("topic", new Mode("Discuss a topic",
                "You and the learner are discussing one topic, like two people with different opinions. Start by naming the topic and giving your own opinion in one or two short sentences, then ask what they think and why: no weather, no greeting chat. Stay on it. Each turn: react to what the learner said, add a short opinion, reason or example of your own, then ask one easy question they can answer from their own life or taste, each time from a new angle (their own experience, an advantage, a disadvantage, which option they would choose, whether they agree with you, advice to a friend, their daily life, what they would change); never ask a question you already asked. If they don't know, offer two options to pick from. Keep the opinion you gave first: you may add to it or soften it, but never switch sides. Where the learner holds the other view, disagree politely, so they have to defend it. Don't change to small talk or another topic until this one is clearly used up (about eight exchanges); then say so in a few words and name a new topic the same way."));
        MODES.put("interpret", new Mode("Dolmetscher — say it in German",
                "This is an interpreter drill. Each turn, give the learner one short everyday sentence to say in German, written in their native language: at their level, a new situation or pattern each time (shopping, work, friends, travel, home, plans, problems), never one already given. Never say the German version of the sentence you give. When they answer, judge whether their German says that sentence correctly, meaning included, react in one very short German line, then give the next sentence. Keep your own replies very short, so they do the talking."));
        MODES.put("rolecard", new Mode("Rollenkarte — play a character",
                "The learner plays the character on their role card (below). Greet them warmly and ask their name, then interview them about the card: one question at a time about one detail, in a natural order, react briefly, and ask small follow-ups; they may invent extra details that fit the card. If an answer contradicts the card, point it out kindly."));
        MODES.put("sentences", new Mode("Sentence drill — my learnt words",
                "This is a sentence drill played out as one realistic everyday situation, like a short story the learner lives through (moving into a new flat, a day at work, planning a trip, a visit to the doctor). Choose a situation in which as many of today's words as possible would naturally come up, and tell the learner in one short line what it is. Then go through it step by step: each turn, describe the next logical moment in one or two short, simple sentences and ask the learner what they do, say or think there, in one full sentence using the word that fits that moment, giving only its meaning in their native language. Every step must follow sensibly from the previous one and from what the learner said. When none of the remaining words fits the situation any more, start a new one and say so (Neue Situation: …); never force a word in. React to the learner's sentence in a few words, no small talk, and leave out the answer suggestions."));
        MODES.put("scene", new Mode("Scene role-play",
                "Play out the scene naturally, one step at a time. Start when the learner walks up: greet them and open the scene. Ask the learner questions so they do most of the talking, and ask follow-ups when an answer is short. Only once every part of the scene goal is done, usually after ten or more exchanges, close the scene and say so."));

        SCENES.put("cafe", new Scene("Inès", "a barista at a busy neighbourhood café who loves recommending pastries", "Take the learner's order: drink, size, milk, something to eat, here or to go, then payment. Chat a little while you prepare it."));
        SCENES.put("market", new Scene("Tomás", "a fruit seller at an outdoor market who haggles playfully", "Sell the learner fruit and vegetables for a dinner they're cooking. Ask what they're making, suggest things, discuss quantities and haggle over the price."));
        SCENES.put("station", new Scene("Yuki", "a helpful ticket clerk at a train station during rush hour", "Help the learner buy a ticket: destination, date and time, one-way or return, class, seat reservation, discount card, and which platform. Then tell them their train is delayed and help them choose an alternative."));
        SCENES.put("doctor", new Scene("Dr. Weber", "a friendly but thorough family doctor", "Find out what's wrong: ask about the symptoms, since when, how bad, fever, medication, allergies, work and sleep. Explain what you think it is, what to take and how often, and whether they need a sick note."));
        SCENES.put("flat", new Scene("Frau Schulz", "a landlady showing a flat to a possible new tenant", "Show the flat room by room and interview the learner: their job, income, why they're moving, pets, smoking, how long they'd stay, when they could move in. Let them ask about rent, deposit, heating and the neighbours."));
        SCENES.put("job", new Scene("Herr Brandt", "a recruiter interviewing the learner for a job at a mid-sized company", "Run a job interview: ask them to introduce themselves, their experience, strengths and weaknesses, a difficult situation they solved, why this job, salary expectations and start date. Then invite their questions."));
        SCENES.put("office", new Scene("Frau Yilmaz", "a clerk at the town hall registration office who is strict about paperwork", "Register the learner's new address: ask for ID, the landlord's confirmation, moving date, previous address, marital status and religion for tax. One document is missing; work out with them how to solve it."));
        SCENES.put("restaurant", new Scene("Luca", "a chatty waiter at a small family restaurant", "Seat the learner, explain the specials, take drinks and food orders with questions about preferences and allergies. Later there's a problem with the dish; handle the complaint, then dessert, the bill and splitting it."));
        SCENES.put("hotel", new Scene("Sophie", "a receptionist at a city hotel", "Check the learner in, but their booking can't be found. Sort it out together: name, dates, room type, how they booked. Then explain breakfast, Wi-Fi and checkout, and give tips for sightseeing."));
        SCENES.put("neighbour", new Scene("Jonas", "a friendly neighbour who has just moved in next door", "Get to know the learner on the stairs: where they're from, how long they've lived here, work, hobbies, tips for the area. Invite them to a small party and agree on day, time and what to bring."));
        SCENES.put("dentist", new Scene("Frau Klein", "a receptionist answering the phone at a busy dental practice", "Take an appointment request by phone: name and spelling, date of birth, insurance, what the problem is, how urgent. Offer times that don't fit at first and negotiate until one works, then confirm."));
        SCENES.put("shop", new Scene("Max", "a shop assistant in a clothing store", "The learner wants to return a jacket. Ask what's wrong, when they bought it, whether they have the receipt. Offer an exchange or a voucher instead of a refund and negotiate, then help them try something else."));

        TENSES.put("present", new Tense("the Präsens (ich spiele, du fährst, er ist)", "what the learner usually does, their routines, likes, family, job and what is happening right now"));
        TENSES.put("perfekt", new Tense("the Perfekt: haben or sein + Partizip II (ich habe gekocht, ich bin gefahren)", "what the learner did yesterday, last weekend, on their last holiday or at work this week"));
        TENSES.put("praeteritum", new Tense("the Präteritum (ich ging, ich machte, ich war, ich hatte, ich konnte)", "stories: their childhood, how something happened, a film or book they remember, an adventure"));
        TENSES.put("future", new Tense("Futur I: werden + infinitive (ich werde reisen)", "the learner's plans for tonight, the weekend, next year, and their dreams"));

        MISTAKE_TYPES.put("case_article", "articles and case (der/den/dem, ein/einen, noun gender)");
        MISTAKE_TYPES.put("verb_position", "verb position (verb second; verb at the end after weil, dass, wenn)");
        MISTAKE_TYPES.put("perfekt_auxiliary", "Perfekt auxiliary (haben or sein)");
        MISTAKE_TYPES.put("participle", "past participle form (gegessen, gegangen, gekauft)");
        MISTAKE_TYPES.put("separable_verb", "separable verbs (aufstehen: ich stehe früh auf)");
        MISTAKE_TYPES.put("verb_ending", "verb endings (ich habe, du hast, er hat)");
        MISTAKE_TYPES.put("adjective_ending", "adjective endings (ein guter Kaffee, mit dem neuen Auto)");
        MISTAKE_TYPES.put("preposition", "prepositions (in, auf, zu, nach, mit …)");
        MISTAKE_TYPES.put("negation", "negation (nicht or kein)");
        MISTAKE_TYPES.put("plural", "plural forms");
        MISTAKE_TYPES.put("word_choice", "word choice");
        MISTAKE_TYPES.put("tense", "tense (another tense where the one being practised was needed)");
        MISTAKE_TYPES.put("other", "other");
    }

    private final TalkloopService talkloop;

    public TalkloopChatGptService(TalkloopService talkloop) {
        this.talkloop = talkloop;
    }

    /** The tools ChatGPT is offered, in MCP's tools/list shape. */
    public List<Map<String, Object>> tools() {
        Map<String, Object> start = new LinkedHashMap<>();
        start.put("name", "start_talkloop");
        start.put("title", "Start a Talkloop practice");
        start.put("description", "Use this when the user wants to practise speaking German with Talkloop (their German speaking partner), "
                + "or asks for an interview, free chat, topic discussion, Dolmetscher, Rollenkarte, sentence drill or scene role-play in German. "
                + "Returns how to act as their partner for the whole conversation, the learner's words to practise today and their recurring mistakes. "
                + "Call it once at the start of a practice, then follow what it returns.");
        start.put("inputSchema", schema(Map.of(
                "mode", Map.of("type", "string", "enum", List.copyOf(MODES.keySet()),
                        "description", "interview = Interview me (easiest start); lead = free chat; topic = discuss a topic with opinions; "
                                + "interpret = Dolmetscher, say given sentences in German; rolecard = play a character; "
                                + "sentences = sentence drill with the learnt words; scene = role-play in a real situation. Default interview."),
                "level", Map.of("type", "string", "enum", LEVELS, "description", "The learner's CEFR level. Ask if unknown."),
                "native_language", Map.of("type", "string", "description", "The language the learner speaks, for translations and tips. Default English."),
                "scenario", Map.of("type", "string", "enum", List.copyOf(SCENES.keySet()), "description", "Only for mode scene; a random one if left out."),
                "tense", Map.of("type", "string", "enum", Stream.concat(Stream.of("any"), TENSES.keySet().stream()).toList(),
                        "description", "A tense to practise, or any (the default).")),
                List.of("mode", "level")));
        start.put("annotations", Map.of("readOnlyHint", true, "openWorldHint", false));

        Map<String, Object> usedWord = schema(Map.of(
                "word", Map.of("type", "string", "description", "The word as written in today's list."),
                "correct", Map.of("type", "boolean", "description", "True only if its meaning, form and article were right.")),
                List.of("word", "correct"));
        Map<String, Object> turn = new LinkedHashMap<>();
        turn.put("name", "record_turn");
        turn.put("title", "Save a Talkloop turn");
        turn.put("description", "During a Talkloop practice (after start_talkloop), call this for a learner message that you corrected "
                + "or that contains one of today's words, before you reply. It saves the mistake to the learner's mistake log "
                + "and moves today's words along their speaking schedule. Don't mention the call to the learner.");
        turn.put("inputSchema", schema(Map.of(
                "said", Map.of("type", "string", "description", "The learner's message, as they said it."),
                "correction", Map.of("type", "string", "description", "The faulty sentence(s) rewritten correctly, or empty if there was no mistake."),
                "mistakes", Map.of("type", "array", "items", Map.of("type", "string", "enum", List.copyOf(MISTAKE_TYPES.keySet())),
                        "description", "Each kind of mistake the correction fixes; empty without a correction."),
                "used_words", Map.of("type", "array", "items", usedWord,
                        "description", "Every one of today's words that appears in the learner's message, in any form."),
                "peeked_words", Map.of("type", "array", "items", Map.of("type", "string"),
                        "description", "Today's words whose German you had to tell the learner because they asked or were stuck.")),
                List.of("said")));
        turn.put("annotations", Map.of("readOnlyHint", false, "destructiveHint", false, "idempotentHint", false, "openWorldHint", false));
        return List.of(start, turn);
    }

    /** Runs one tool; a ResponseStatusException is a bad call that ChatGPT can correct. */
    public String call(Ctx ctx, String name, Map<String, Object> args) {
        return switch (name) {
            case "start_talkloop" -> start(ctx, args);
            case "record_turn" -> recordTurn(ctx, args);
            default -> throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "unknown tool: " + name);
        };
    }

    /** The partner's instructions for the whole practice, with today's words and what to leave alone. */
    String start(Ctx ctx, Map<String, Object> args) {
        String mode = text(args, "mode", "interview");
        Mode m = MODES.get(mode);
        if (m == null) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "mode: one of " + MODES.keySet());
        }
        String level = text(args, "level", "A2").toUpperCase(Locale.ROOT);
        if (!LEVELS.contains(level)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "level: one of " + LEVELS);
        }
        String nativeLanguage = text(args, "native_language", "English");
        Tense tense = TENSES.get(text(args, "tense", "any"));

        String character = "Mika";
        String setting = "a warm, patient native-speaker conversation partner and language buddy";
        Scene scene = null;
        if (mode.equals("scene")) {
            scene = SCENES.getOrDefault(text(args, "scenario", ""), Rand.pick(List.copyOf(SCENES.values())));
            character = scene.character();
            setting = scene.setting();
        }

        List<String> lines = new ArrayList<>();
        lines.add("You are now the learner's Talkloop speaking partner. Keep to these rules for the rest of this conversation, until the learner says they want to stop.");
        lines.add("You are " + character + ", " + setting + ". Stay in character; speak only German, except where these rules say " + nativeLanguage + ".");
        lines.add("Learner: German at CEFR " + level + ", native " + nativeLanguage + ". Reply in one or two short sentences at their level, ending with something they can answer.");
        lines.add("At " + level + ": " + LEVEL_GUIDE.get(level));
        lines.add("Mode: " + m.label() + ". " + m.extra());
        if (scene != null) {
            lines.add("Scene goal: " + scene.goal());
        }
        lines.add("Each turn, write in this order: (1) only if the learner's last message has a real grammar or word-choice mistake: \"✏️ \" and the faulty sentence(s) rewritten correctly, "
                + "then one short tip in " + nativeLanguage + " on what was wrong, then ask them to say the corrected sentence once more before you go on; "
                + "(2) your German reply; (3) its translation in " + nativeLanguage + " in brackets, in italics; "
                + "(4) \"💬\" and 2–3 short German answers the learner could give, separated by \" / \". "
                + "Never correct style or punctuation, only real mistakes. In a voice conversation, say only the correction and your reply.");
        lines.add("The learner may be speaking through speech recognition: ignore missing punctuation and obvious transcription slips. "
                + "Sound like a real person, with short interjections (Oh!, Ach wirklich?, Super!).");
        if (tense != null) {
            lines.add("Tense practice: " + tense.form() + ". Use it yourself and, from your very first question on, ask things whose natural answer needs it (about " + tense.ask()
                    + "); write the suggestions in it too. A message in another tense, or with this tense formed wrongly, always gets a correction in this tense.");
        }

        Map<String, Object> chats = talkloop.chats(ctx);
        if (mode.equals("topic")) {
            String topic = pickTopic(level, strings(chats.get("topics")));
            lines.add("Today's topic: \"" + topic + "\". Every question is about this topic itself, never about something the learner only mentioned in passing.");
        }
        if (mode.equals("rolecard")) {
            lines.add("The learner's role card (they play this person; show it to them in " + nativeLanguage + " before you greet them): " + roleCard() + ".");
        }
        if (mode.equals("interview") || mode.equals("lead")) {
            List<String> covered = strings(chats.get("subjects"));
            if (!covered.isEmpty()) {
                lines.add("Talked about in earlier chats, so never bring these up yourself (follow the learner if they do): "
                        + quoted(covered.subList(0, Math.min(MAX_SUBJECT_HINTS, covered.size()))) + ".");
            }
        }

        List<Map<String, Object>> words = todayWords(ctx, level, mode.equals("sentences"));
        List<Map<String, Object>> active = words.subList(0, Math.min(TODAY_WORDS, words.size()));
        List<Map<String, Object>> waiting = words.subList(active.size(), Math.min(active.size() + WAITING_WORDS, words.size()));
        if (!active.isEmpty()) {
            lines.add("Today's words, which the learner has learnt and now has to say until it is automatic: " + wordList(active) + "."
                    + (waiting.isEmpty() ? "" : " When one has been said correctly twice, it is done: replace it with the next of these: " + wordList(waiting) + "."));
            lines.add("Show the learner today's words at the start, in " + nativeLanguage + " only, as a short list, so they have to recall the German themselves. "
                    + "Get them to say each one: ask a question on the current subject whose natural answer needs it, one word at a time, only where it fits; never quiz or list them. "
                    + "Most important rule: never say, translate or hint at the German of a word the learner hasn't said yet. If you asked for one without success, leave it for about five turns, and ask for it at most twice in this chat. "
                    + "If they ask for the German of one, tell them, report it as peeked_words, and don't report it as correct later in this chat. "
                    + "Once a word was said, bring it back later in another form (tense, person).");
        } else if (mode.equals("sentences")) {
            lines.add("The learner has no learnt words yet: choose everyday words at " + level + " yourself, one per step, giving only their meaning in " + nativeLanguage + ".");
        }

        List<String> weak = recurringMistakes(ctx);
        if (!weak.isEmpty()) {
            lines.add("Recurring mistakes, most frequent first: " + String.join("; ", weak) + ". About every second question, ask something on the current subject whose natural answer needs one of these, in turn; "
                    + "stay natural, never say you're testing, and don't explain grammar unless you correct a mistake.");
        }
        lines.add("Call record_turn for every learner message that you corrected or that contains one of today's words, before you reply, without mentioning it. "
                + "If the learner says \"zwei Minuten\", pause until they say \"zurück\".");
        lines.add("Now start the practice with your first message.");
        return String.join("\n", lines);
    }

    /** Saves a learner message's mistakes and today's words, as Talkloop's page does after a turn. */
    String recordTurn(Ctx ctx, Map<String, Object> args) {
        String said = clip(text(args, "said", ""));
        if (said.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "said: the learner's message");
        }
        List<String> notes = new ArrayList<>();
        long now = System.currentTimeMillis();

        String correction = clip(text(args, "correction", ""));
        List<String> types = strings(args.get("mistakes")).stream().filter(MISTAKE_TYPES::containsKey).distinct().toList();
        if (!correction.isBlank()) {
            List<Map<String, Object>> entries = (types.isEmpty() ? List.of("other") : types).stream()
                    .map(type -> Map.<String, Object>of("type", type, "at", now, "said", said, "fix", correction)).toList();
            talkloop.syncMistakes(ctx, Map.of("languages", Map.of(LANGUAGE, Map.of("resetAt", 0, "entries", entries))));
            notes.add("mistake saved");
        }

        Map<String, Boolean> results = new LinkedHashMap<>(); // card word → said correctly
        for (Object o : args.get("used_words") instanceof List<?> l ? l : List.of()) {
            if (o instanceof Map<?, ?> u && u.get("word") instanceof String w) {
                results.merge(w, Boolean.TRUE.equals(u.get("correct")), Boolean::logicalAnd);
            }
        }
        for (String w : strings(args.get("peeked_words"))) {
            results.put(w, false);
        }
        if (!results.isEmpty()) {
            List<String> learnt = learntWords(ctx).stream().map(w -> (String) w.get("de")).toList();
            Map<String, Object> spoken = spokenWords(ctx);
            Map<String, Object> changed = new LinkedHashMap<>();
            results.forEach((word, correct) -> learnt.stream().filter(de -> sameWord(de, word)).findFirst().ifPresentOrElse(de -> {
                Map<String, Object> prev = spoken.get(de) instanceof Map<?, ?> p ? asMap(p) : null;
                Map<String, Object> next = correct ? spokenCorrect(prev, ctx.today(), now) : spokenMissed(prev, now);
                changed.put(de, next);
                long stage = (long) next.get("stage");
                notes.add(de + ": " + (correct
                        ? (stage >= 4 ? "automatic" : "stage " + stage) + ", back in " + Math.round(((long) next.get("due") - now) / (double) DAY_MS) + " days"
                        : "back tomorrow"));
            }, () -> notes.add(word + ": not one of the learner's words, ignored")));
            if (!changed.isEmpty()) {
                talkloop.syncSpoken(ctx, Map.of("words", changed));
            }
        }
        return notes.isEmpty() ? "Nothing to save." : "Saved: " + String.join("; ", notes) + ".";
    }

    /**
     * The learnt words of these levels to say, as Talkloop's pickTodayWords orders them: due
     * ones first (the least secure first), then words never said, in the trainer's order.
     * A drill goes on with the rest, the soonest due first, so it never runs dry.
     */
    List<Map<String, Object>> todayWords(Ctx ctx, String level, boolean evenIfNotDue) {
        List<String> levels = LEVELS.subList(0, LEVELS.indexOf(level) + 1);
        List<Map<String, Object>> learnt = learntWords(ctx).stream().filter(w -> levels.contains(w.get("lvl"))).toList();
        Map<String, Object> spoken = spokenWords(ctx);
        long now = System.currentTimeMillis();
        Comparator<Map<String, Object>> byStageThenDue = Comparator
                .<Map<String, Object>>comparingLong(w -> num(spoken, w, "stage"))
                .thenComparingLong(w -> num(spoken, w, "due"));
        List<Map<String, Object>> order = new ArrayList<>();
        learnt.stream().filter(w -> spoken.containsKey(w.get("de")) && num(spoken, w, "due") <= now).sorted(byStageThenDue).forEach(order::add);
        learnt.stream().filter(w -> !spoken.containsKey(w.get("de"))).forEach(order::add);
        if (evenIfNotDue) {
            learnt.stream().filter(w -> spoken.containsKey(w.get("de")) && num(spoken, w, "due") > now)
                    .sorted(Comparator.comparingLong(w -> num(spoken, w, "due"))).forEach(order::add);
        }
        return order;
    }

    /** The top 3 mistake kinds that recur (made at least twice), each counting less as it ages. */
    List<String> recurringMistakes(Ctx ctx) {
        Map<String, Object> log = talkloop.syncMistakes(ctx, Map.of("languages", Map.of()));
        Map<String, Object> german = log.get("languages") instanceof Map<?, ?> l && l.get(LANGUAGE) instanceof Map<?, ?> g ? asMap(g) : Map.of();
        long now = System.currentTimeMillis();
        record Kind(String type, int count, double weight, Map<?, ?> example) {
        }
        Map<String, Kind> byType = new LinkedHashMap<>();
        for (Object o : german.get("entries") instanceof List<?> e ? e : List.of()) { // oldest first, so example ends on the newest
            if (o instanceof Map<?, ?> m && m.get("type") instanceof String type && MISTAKE_TYPES.containsKey(type) && !type.equals("other")) {
                double weight = Math.pow(0.5, (now - Srs.num(m.get("at"), 0)) / (double) DAY_MS / MISTAKE_HALF_LIFE_DAYS);
                Kind k = byType.get(type);
                byType.put(type, new Kind(type, k == null ? 1 : k.count() + 1, (k == null ? 0 : k.weight()) + weight, m));
            }
        }
        return byType.values().stream().filter(k -> k.count() >= 2)
                .sorted(Comparator.comparingDouble(Kind::weight).reversed()).limit(3)
                .map(k -> MISTAKE_TYPES.get(k.type()) + " (said \"" + k.example().get("said") + "\"; correct \"" + k.example().get("fix") + "\")")
                .toList();
    }

    // ---- the speaking schedule, as Talkloop's spokenCorrect / spokenMissed keep it ----

    /** Said correctly: up a stage, once per day (a second use the same day only counts). */
    static Map<String, Object> spokenCorrect(Map<String, Object> prev, String today, long now) {
        long prevStage = prev == null ? 0 : Srs.num(prev.get("stage"), 0);
        long uses = prev == null ? 0 : Srs.num(prev.get("uses"), 0);
        if (prev != null && today.equals(prev.get("lastDay"))) {
            return spoken(prevStage, Srs.num(prev.get("due"), now), uses + 1, today, now);
        }
        long stage = Math.min(4, prevStage + 1);
        int days = prev != null && prevStage == 4 ? AUTOMATIC_RECHECK_DAYS : SPOKEN_DAYS[(int) stage - 1];
        return spoken(stage, now + days * DAY_MS, uses + 1, today, now);
    }

    /** Wrong, or the German was needed: back to stage 1 (0 if never said), due tomorrow. */
    static Map<String, Object> spokenMissed(Map<String, Object> prev, long now) {
        long stage = prev == null ? 0 : Math.min(Srs.num(prev.get("stage"), 0), 1);
        return spoken(stage, now + DAY_MS, prev == null ? 0 : Srs.num(prev.get("uses"), 0),
                prev != null && prev.get("lastDay") instanceof String d ? d : "", now);
    }

    private static Map<String, Object> spoken(long stage, long due, long uses, String lastDay, long now) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("stage", stage);
        s.put("due", due);
        s.put("uses", uses);
        s.put("lastDay", lastDay);
        s.put("updatedAt", now);
        return s;
    }

    // ---- which card a word means: ChatGPT may drop or change the article ----

    static boolean sameWord(String cardDe, String word) {
        String bare = bareWord(word);
        return !bare.isEmpty() && wordForms(cardDe).contains(bare);
    }

    /** A card can hold alternatives ("zuerst / dann / danach", "dort / da"): each one counts. */
    private static List<String> wordForms(String de) {
        return Stream.concat(Stream.of(bareWord(de)), Arrays.stream(de.split("\\s*[/;]\\s*")).map(TalkloopChatGptService::bareWord))
                .filter(s -> !s.isEmpty()).toList();
    }

    private static String bareWord(String s) {
        return s.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}\\s]", " ").replaceAll("\\s+", " ").trim()
                .replaceFirst("^(der|die|das) ", "");
    }

    // ---- helpers ----

    private List<Map<String, Object>> learntWords(Ctx ctx) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> words = (List<Map<String, Object>>) talkloop.learntWords(ctx).get("words");
        return words;
    }

    private Map<String, Object> spokenWords(Ctx ctx) {
        return talkloop.syncSpoken(ctx, Map.of("words", Map.of())).get("words") instanceof Map<?, ?> m ? asMap(m) : Map.of();
    }

    /** A random topic for the level not had yet; once all are used, any but the last three. */
    static String pickTopic(String level, List<String> recent) {
        List<String> pool = level.equals("B1")
                ? Stream.concat(HARDER_TOPICS.stream(), EASY_TOPICS.stream().limit(3)).toList()
                : EASY_TOPICS;
        List<String> fresh = pool.stream().filter(t -> !recent.contains(t)).toList();
        if (fresh.isEmpty()) {
            List<String> lastThree = recent.subList(0, Math.min(3, recent.size()));
            fresh = pool.stream().filter(t -> !lastThree.contains(t)).toList();
        }
        return Rand.pick(fresh.isEmpty() ? pool : fresh);
    }

    private static String roleCard() {
        List<String> hobbies = List.of("plays the guitar", "goes running every morning", "cooks for friends at weekends", "plays football in a club",
                "reads crime novels", "takes photos of the city", "goes hiking in the mountains", "plays video games", "is learning Spanish", "goes swimming twice a week");
        List<String> two = Rand.shuffle(hobbies).subList(0, 2);
        return Rand.pick(List.of("Lukas", "Anna", "Jonas", "Lena", "Felix", "Mia", "David", "Sara", "Tim", "Julia")) + ", "
                + (20 + ThreadLocalRandom.current().nextInt(40)) + ", "
                + Rand.pick(List.of("a cook in a restaurant", "a nurse in a hospital", "a bus driver", "a primary school teacher", "IT support at a bank",
                        "a baker", "a hairdresser", "an architecture student", "a police officer", "a salesperson in a bike shop")) + " in "
                + Rand.pick(List.of("Hamburg", "Munich", "Berlin", "Cologne", "Leipzig", "Freiburg", "Dresden", "Bremen")) + "; "
                + Rand.pick(List.of("lives alone in a small flat", "lives in a shared flat with two friends", "lives with their partner and a cat",
                        "still lives with their parents", "has a house with a garden and two children")) + "; "
                + two.get(0) + " and " + two.get(1) + "; "
                + Rand.pick(List.of("was on holiday in Italy last summer", "moved to a new flat last month", "had a big birthday party last weekend",
                        "started a new job two weeks ago", "broke their arm skiing last winter", "won a cooking competition last year", "got a dog in the spring")) + "; "
                + Rand.pick(List.of("wants to visit Japan next year", "dreams of opening their own café", "is saving for a car", "wants to run a marathon",
                        "plans to learn to sail", "wants to move to the countryside"));
    }

    private static Map<String, Object> schema(Map<String, Object> properties, List<String> required) {
        Map<String, Object> s = new LinkedHashMap<>();
        s.put("type", "object");
        s.put("properties", properties);
        s.put("required", required);
        return s;
    }

    private static String wordList(List<Map<String, Object>> words) {
        return String.join("; ", words.stream().map(w -> w.get("de") + " (" + w.get("en") + ")").toList());
    }

    private static String quoted(List<String> items) {
        return String.join(", ", items.stream().map(s -> "\"" + s + "\"").toList());
    }

    private static long num(Map<String, Object> spoken, Map<String, Object> word, String field) {
        return spoken.get(word.get("de")) instanceof Map<?, ?> s ? Srs.num(s.get(field), 0) : 0;
    }

    private static String text(Map<String, Object> args, String key, String fallback) {
        return args.get(key) instanceof String s && !s.isBlank() ? s.strip() : fallback;
    }

    private static List<String> strings(Object o) {
        return o instanceof List<?> l ? l.stream().filter(String.class::isInstance).map(String.class::cast).toList() : List.of();
    }

    private static String clip(String s) {
        return s.length() > MAX_SAID ? s.substring(0, MAX_SAID) : s;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> asMap(Map<?, ?> m) {
        return (Map<String, Object>) m;
    }
}
