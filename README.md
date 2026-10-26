# Deutsch Vocab Trainer V2( Fully Vibe Coded App)
# https://deutsch-vocab-trainer-v2-1.onrender.com/

Learn German from A1 to B1: learn words, read short stories, and practise speaking
with an AI partner. Free, in your browser, on a laptop or a phone.

## Learn German with it (no tech knowledge needed)

You don't need to install anything or know anything about programming. You need a
browser, an account, and (for speaking practice) a free key, explained below.

### What you get

- **Wortschatz, the vocabulary trainer:** over 4,000 words from A1 to B1. The app
  shows you each word again just before you would forget it (spaced repetition).
- **Stories:** 123 short B1 stories in 16 phases. Tap any word to see what it means.
  Each phase ends with a test (*Phasentest*).
- **Talkloop, the speaking partner:** you talk German out loud, an AI answers with a
  voice like in a phone call, corrects your mistakes and uses the words you learnt.

### Step 1: Get an account

Accounts are created by the app's owner. Ask for one by opening an issue on this
GitHub page (*Issues* → *New issue*), and you'll get an email and a password to log in with.

### Step 2: Open the app and log in

1. Open **https://deutsch-vocab-trainer-v2-1.onrender.com/**
   The app runs on a free server that sleeps when nobody uses it, so the first visit
   of the day can take **up to a minute**. Just wait; after that it is fast.
2. Log in with your email and password.
3. Tip for your phone: save it to your home screen, so it opens like an app
   (Safari on iPhone: Share → *Add to Home Screen*; Chrome on Android: ⋮ → *Add to Home screen*).

You stay logged in as long as you use the app at least once a day.

### Step 3: Learn words (the *Practice* tab)

At the top you choose your levels (A1, A2, B1). The line under the title shows your
streak 🔥 and how many words you did today.

| Mode | What it does | Use it for |
|---|---|---|
| **Study** | New words, one at a time, with an example | learning new words |
| **Write** | You type the German word | really remembering the spelling |
| **Cards** | Flashcards: think of the answer, then flip | fast repetition |
| **Quiz** | Choose the right meaning | a quick check |
| **Articles** | *der, die* or *das*? | the article of each noun |
| **Separable verbs** | *anrufen → ich rufe an* | verbs that split |
| **Fill-in** | Put the missing word into a sentence | words in context |
| **Patterns** | Useful sentence patterns | building sentences |
| **Review** | The words you got wrong | fixing your mistakes |

Start with **Study**, then **Write**. Do **Review** every day; it only takes a few minutes.

### Step 4: Read stories (the *Stories* tab)

The stories are in 16 phases, from everyday life to B1 exam topics. Read a story,
tap the words you don't know, and mark it as read. When you have read all stories of
a phase, do its **Phasentest**. After you pass it, short refreshers come back after
1, 7, 30, 90 and 180 days, so you don't forget the words.

Good order for speaking: **Phase 1** (everyday life) → **Phase 16** (connectors like
*weil, obwohl, deshalb*) → **Phase 2** (work and studies) → **Phases 12 and 13** (verbs) →
then the rest. If you have a B1 exam soon, do **Phases 5, 6 and 15** earlier.

### Step 5: Speak with Talkloop

1. In the trainer, tap the round letter at the top right (your account) → **practise in Talkloop**.
   Talkloop uses your login and your learnt words on its own; there is nothing to connect.
2. **The first time only:** Talkloop needs a free AI key.
   - Go to **https://console.groq.com/keys**, sign up for free, and click **Create API Key**.
   - Copy the key (it starts with `gsk_`), paste it into Talkloop under **Groq API key**, and click **Save**.
   - The key stays in your browser only. It is free; if it ever reaches its daily limit,
     just continue the next day (or add a second key as a backup).
3. Choose **Practise: German**, **I speak:** your language, your **Level**, and a **Mode**:
   - **Interview me:** the AI asks about your life: your hometown, your work, your family,
     a big decision… Every chat starts on a different theme. The easiest way to start talking.
   - **Free chat:** the AI leads a relaxed conversation, like a friend on the phone.
   - **Erzähl mal:** you tell real stories from your life (a trip, a funny mistake, your
     first day at work) and the AI asks for the details. Great for the past tense.
   - **Dolmetscher:** the AI gives you everyday sentences to say in German.
   - **Rollenkarte:** you play a character from a role card and get interviewed as them.
   - **Discuss a topic:** you give your opinion and reasons. Good practice for B1.
   - **Scene role-play:** real situations like the doctor, the train station or a café.
   - **Sentence drill:** you make sentences with the words you learnt.
4. Tap **Start** and allow the microphone. Then just talk; after a short pause your
   answer is sent by itself.

While you talk:
- If you made a mistake, the correction appears with **Say it again**. Say the correct sentence out loud.
- Stuck? Tap one of the **suggestions** above the text box.
- Tap any word in the AI's answer to see what it means.
- Don't know a word? Tap **🔍** next to *Send* and type it in English or German.
- Say **"zwei Minuten"** to pause the call, and **"zurück"** to go on.
- Your chats are saved under **Chat history**; you can open them again later, and the AI
  doesn't repeat subjects you already talked about.

Use **Chrome** on a laptop or Android phone, or **Safari** on an iPhone. If the microphone
doesn't work, check that the browser is allowed to use it.

### A good daily plan (20–30 minutes)

1. **Review** in the trainer (5 min).
2. **Study** and **Write** with new words, about 10 a day (10 min).
3. One **story** every one or two days.
4. **Talkloop** (10 min): *Interview me* or *Free chat*. Speak in full sentences and try
   to give a reason (*…, weil …*).

Every day for 20 minutes helps more than two hours once a week.

---

## For developers

A German vocabulary trainer (A1–B1) with spaced repetition, quizzes, B1
reading stories and end-of-phase tests — run entirely by a Spring Boot app. **All logic lives
here**; the page (`src/main/resources/static/index.html`, served at `/`) only
renders what the API returns and sends the learner's actions back.

Every learner has their own account and their own progress: users are created
by an admin call (`POST /api/users`), log in with email + password, and stay
logged in until 24 hours pass without a request.

What the page still does on its own is purely presentational: which tab is
open, whether a card is flipped, the text being typed, tooltip position, and
text-to-speech. The only thing the browser stores is the login token
(localStorage `wortschatz.session`). The Gemini key and GitHub token are kept
in memory for one visit and sent only with the request that needs them.

The vocabulary itself (`german_vocab.json`) is maintained in
[Harsimar17/Deutsch-Vocab-Helper](https://github.com/Harsimar17/Deutsch-Vocab-Helper):
the app reads it from there and "+ Add word" commits to it. A copy is bundled
in `src/main/resources/data/` as the fallback when GitHub can't be reached.

## How the code is organised

All Java code is in `src/main/java/com/vocabtrainer`, one package per layer.
Every request goes **controller → service → repository**, and each layer only
calls the one below it:

```
com.vocabtrainer
├── controller/    HTTP only: read the request, call one service, return its answer — no logic
├── service/       all business logic (the rules of the app)
│   └── drill/     the practice rounds, one class per mode
├── repository/    saving and finding data, nothing else (Firestore, Firebase Auth, rounds in memory)
├── model/         plain data passed between the layers (Card, Ctx, Settings, Gloss)
├── security/      login sessions: the JWT, checking it on every request
├── config/        Spring setup and app.* settings
├── job/           the keep-alive ping
└── util/          small helpers
```

Repository methods are named after what they do: `find…`, `save…`, `delete…`.
`ProgressRepository.find` keeps each user's progress document for 30 s, since
almost every request reads it; `save` writes to Firestore and then updates that copy.
Tests mirror the same packages under `src/test/java`.

### Where each feature lives

| Feature | Controller | Service (the logic) | Repository |
|---|---|---|---|
| Header numbers, settings | `AppController` | `SummaryService`, `SettingsService` | `ProgressRepository` |
| Spaced repetition, daily goal, streak (in the learner's time zone) | — | `ProgressService`, `Srs` | `ProgressRepository` |
| Practice rounds — Study, Write, Cards, Quiz, Articles, Trennbare Verben, Fill-in, Review, Phasentest | `DrillController` | `DrillService`, `drill/*Drill`, `drill/DrillFactory` | `DrillRepository` (in memory) |
| Cards, filters, answer checking (lenient spelling, articles, umlauts) | — | `CardCatalog`, `German` | — |
| Stories: list, reader with word meanings, read marks | `StoriesController` | `StoryListService`, `StoryService`, `WordLookup` | `ProgressRepository` |
| Phasentest overview (successive relearning, refreshers at 1/7/30/90/180 days) | `StoriesController` | `PhaseTestService` | `ProgressRepository` |
| Sentence patterns (Muster) | `PatternsController` | `PatternService` + `patterns.json` | `ProgressRepository` |
| Example sentences via Gemini | `SentenceController` | `SentenceService` | `ProgressRepository` |
| Vocabulary file: read from GitHub (cached, re-checked every 5 min, bundled fallback), "+ Add word" commits | `VocabController` | `VocabService`, `GitHubVocabCommitter` | — (GitHub) |
| Login, creating users | `AuthController`, `UserController` | `AuthService`, `UserService` | `FirebaseAuthClient` |
| Session JWT with a 24 h idle timeout | — | — | `security/JwtService`, `security/SessionInterceptor` |
| Talkloop (speaking practice, at `/talkloop/`, opened from the user menu): reads the learnt words and keeps its mistake log here, so it follows the learner across devices | `TalkloopController` | `TalkloopService` | `ProgressRepository`, `security/TalkloopLinkInterceptor` |

## API

All `/api` calls except `/api/vocab`, `/api/auth/login` and `/api/users` need
`Authorization: Bearer <session token>`. Every such response carries a renewed
token in `X-Auth-Token`; use it for the next call. A token expires 24 h after
it was issued, so a session ends after 24 h without a request. Send
`X-Time-Zone: <IANA zone>` so "today" and the streak follow the learner's local midnight.

| Call | |
|---|---|
| `POST /api/users` `{email, password, importLegacyProgress?}` | create a user (from Postman or curl; open to any caller) → `201 {uid, email}` |
| `POST /api/auth/login` `{email, password}` | → `{token, expiresIn, user: {uid, email}}` |
| `GET /api/auth/me` | who the token belongs to |
| `GET /api/summary?ai=` | header numbers, settings, settings label, level title, card count, Review count |
| `POST /api/settings/{action}` `{value}` | `toggleLevel`, `toggleCat`, `toggleDirection`, `toggleNoRepeat`, `setFocus`, `setTheme`, `setStoryMode`, `setStoryShowEn`, `openStory`, `openPhaseTest` |
| `POST /api/drills/{mode}` | start a round: `study`, `write`, `flash`, `quiz`, `articles`, `sep`, `cloze`, `review`, `phase` (`{phase, refresh}`) → `{id, view}` |
| `POST /api/drills/{id}/{action}` `{…}` | e.g. `answer {key}`, `choose {key}`, `grade {grade}`, `check {input}`, `next`, `finish` → `{id, view}` |
| `GET /api/stories`, `GET /api/stories/{id}`, `POST /api/stories/{id}/read` | story list, analysed reader view, read mark |
| `GET /api/phase-tests/{idx}`, `POST /api/phase-tests/{idx}/reset` | Phasentest overview |
| `GET /api/patterns`, `POST /api/patterns/{key}/seen` | Muster |
| `POST /api/sentences/generate` (+ `X-Gemini-Key`) | saved sentence, or generate + save; `{needsKey}` without a key |
| `POST /api/vocab/words` (+ `X-GitHub-Token`) | add a word = one commit on GitHub |
| `GET /api/vocab` | the raw file (public) |
| `POST /api/talkloop/link` | → `{token, expiresAt}`: a link for Talkloop (learnt words and its mistake log only), valid 180 days, never renewed |
| `GET /api/talkloop/words` (with the link as `Bearer`, not a session) | learnt words (every card with a schedule), least secure first → `{count, words: [{de, en, cat, lvl, example, box, lapses, last}]}` |
| `POST /api/talkloop/mistakes` (with the link) `{languages: {German: {resetAt, entries: [{type, at, said, fix}]}}}` | Talkloop's mistake log: merges what a device recorded since its last sync (newest `resetAt` wins and drops older entries; duplicates removed; newest 300 per language kept) → the whole log in the same shape. Stored in `scores/{uid}/talkloop/mistakes` |
| `POST /api/talkloop/spoken` (with the link) `{words: {"die Haltestelle": {stage, due, uses, lastDay, updatedAt}}}` | Talkloop's speaking schedule: merges what a device changed since its last sync (per word the newest `updatedAt` wins) → the whole schedule. Stored in `scores/{uid}/talkloop/spoken` |
| `POST /api/talkloop/cloudflare` (with the link, + `X-Cloudflare-Account`, `X-Cloudflare-Token`) `{messages, response_format?, temperature?, max_tokens?, reasoning_effort?}` | Talkloop's Cloudflare Workers AI backup: forwards the chat request to `@cf/openai/gpt-oss-120b` with the learner's own account and token (never stored), as Cloudflare refuses calls from web pages; Cloudflare's answer and status come back as they are |

Rounds are kept in memory (`repository/DrillRepository`, 6 h idle limit) and belong
to the user who started them; every answer is saved to Firestore as it happens,
so losing a round only means starting a new one.

## Talkloop (speaking practice)

Talkloop, the voice-conversation partner (formerly its own site,
[Harsimar17/talkloop](https://github.com/Harsimar17/talkloop)), is part of this
app: its files are in `src/main/resources/static/talkloop/` and it is served at
`/talkloop/`. It still runs in the browser and talks to Mistral / Gemini / Groq
with the learner's own keys (kept in that browser only, never sent here). Groq
(`openai/gpt-oss-120b`, about a second per reply) is the fastest; Mistral and Groq back
each other up when one is busy. Cloudflare Workers AI (the same model, several seconds per reply) is a
choice of its own, and with Groq it can be the backup when Groq reaches its limit; it
goes through `POST /api/talkloop/cloudflare`.

**Discuss a topic.** The app picks a topic with two sides (everyday choices at A1/A2,
bigger questions from B1, never the one used last time) when the call starts and shows it
under the partner's name. The partner states its own opinion on it, keeps that opinion, and
keeps asking the learner for reasons and examples instead of drifting into small talk.

To keep a topic chat from circling, every turn the partner is told the topic again, shown the
questions it already asked (never to be asked again) and given a new angle on the topic to ask
about (own experience, an advantage, a disadvantage, how it was years ago or elsewhere, the
opposite view, advice to a friend, daily life, what to change). A word of today's words that
was asked about without the learner saying it rests for five turns and is asked about once more
at most in that chat, instead of coming back in every question.

Each topic call is also kept as a **chat** (kept in the browser, the newest 20): a list
*Topic chats* under the Start button shows them, and opening one brings back its messages
so it can be read or carried on. A new chat avoids every topic a saved chat already had,
and once all are used, any but the last three. The words come from the speaking schedule
as in any linked call (due words first, then new ones): the partner asks for one only where
it is the natural thing to say about the topic, never names it first (a reply that does is
written again), and a chat reopened on a later day gets a fresh batch of the words that
are due then.

**A compact call screen on phones** (screens up to 560 px wide; larger screens are unchanged):
smaller call buttons without their text labels, a one-line header (tap the topic to read all
of it), smaller word chips, correction box and message buttons, the coach's explanation
collapsed to its first lines (tap for the rest), the umlaut keys shown only while typing
and the auto-send switch only while not typing, and the "Browser voice…" note shown once
instead of under every reply. At 375 × 812 the conversation went from 33% to 48% of the
screen while a correction is shown, and 62% without one.

**Typing umlauts.** For a keyboard without them, the reply box has three ways: a row of
keys above it (**ä ö ü ß** and a **⇧** for capitals; a letter at the start of a sentence is
a capital anyway), a quote mark before a vowel (`"a` gives ä, `"o` ö, `"u` ü, `"s` ß, capitals
too; Backspace straight after gives the quote and the letter back), and **Alt+A / O / U / S**
on a physical keyboard (Shift for a capital; AltGr combinations are left alone).

**Second grammar check.** With *Double-check my grammar with LanguageTool* on (the
default), each sentence the learner says is also checked by LanguageTool's free public API
(no key; it runs while the AI answers, so there is no extra wait). When the AI's coach gave
no correction but LanguageTool finds a grammar mistake or a misspelt word, that becomes the
correction, with *Say it again* as usual. Its style, comma and capital-letter hints and its
"did you mean…" guesses are ignored. It doesn't catch word order; that stays the AI's job.

Its voice input is the browser's speech recognition as in talkloop's early
version (`bfa9006`), except that the turn ends 1.5 s after the last words heard, final
or not (stopping makes the browser finalise them). What it hears shows with Edit and Delete.

Open it from the user menu (**practise in Talkloop**) or at `/talkloop/`. Being
the same site, it finds the trainer's login in the browser and swaps it for its
link (`POST /api/talkloop/link`) on its own, so there is nothing to connect: its
partner uses every A1/A2 word plus the learnt B1 words, and its mistake log is
kept here (`POST /api/talkloop/mistakes`), so it follows the learner to every device.

**Today's words.** To make learnt words come without thinking, each linked call picks
5 of them to *say*: due ones first, then words never said, least secure first. They show
in English; the learner recalls the German (a tap shows it, but then it counts as a miss).
The partner asks questions whose answer needs them and never says one first, and the
coach reports which ones the learner used and whether correctly. Said correctly on a new
day, a word moves up a stage and comes back after 1, 3, 7 and 21 days; at stage 4 it is
automatic. A wrong use or a peek sends it back to stage 1. After the call a short recap
shows what was said. The schedule is kept here (`POST /api/talkloop/spoken`).

**Sentence drill** (mode *Sentence drill — my learnt words*): sentence making instead
of a chat, played out as one realistic everyday situation (moving flat, a day at work…)
that fits today's words, step by step like a short story. Each step asks for the word
that fits that moment (its chip is highlighted, showing only the English) and the
learner says one full sentence with it; the coach checks it (with *Say it again* on a
mistake). When the words left don't fit, a new situation starts; its title is shown in
the call header and sent back each turn so the story stays coherent. A word comes back
once more at a later step needing another form, then on its 1/3/7/21-day schedule. The drill never runs dry: after the due and
new words it goes on with the ones due soonest. Without the trainer linked it uses the
imported words of the chosen level.

## Users

Create a user from Postman (or curl). The call needs no key, so anyone who
can reach the backend can create an account (each only ever sees its own data).

```bash
curl -X POST http://localhost:8080/api/users -H "Content-Type: application/json" -d '{"email":"anna@example.com","password":"at-least-6-chars"}'
```

Add `"importLegacyProgress": true` to copy the old shared record
(`scores/harsimar-progress`, from before accounts) into the new user. Only the
main record is copied, not quiz-round history or saved sentences.

The user then logs in on the page with that email and password. In Postman:
`POST /api/auth/login`, then send `Authorization: Bearer <token>` on other
calls. The page has a **log out** button. A token is not revoked on the server;
logging out just forgets it, and it stops working 24 h after its last use.

Passwords live in Firebase Auth (email/password accounts), never in this app.
Change or delete users in the Firebase console. Once a password changes, that
user's sessions stop working within the hour.

## How it talks to Firebase

No service-account key. The backend uses the project ID and web API key from
the page's old `firebaseConfig` (see `application.properties`):

1. `POST /api/users` → Firebase Auth REST `accounts:signUp` creates an email/password user.
2. `POST /api/auth/login` → `accounts:signInWithPassword`. The backend returns its own
   JWT (HS256, signed with `JWT_SECRET`), which carries the user's uid and their
   Firebase refresh token, encrypted.
3. On each call the backend swaps that refresh token for a Firebase ID token
   (cached for about an hour) and calls the Firestore REST API **as that user**,
   so Firestore applies the project's security rules.

Each user's data lives in `scores/{uid}`: `right`/`total` (quiz score), `srs`,
`daily`, `phaseTests`, `mistakes`, `storiesRead`, `prefs` (all settings), plus
the `sessions/` and `aiSentences/` subcollections.

### Firebase setup (one-time)

1. Firebase console → Authentication → Sign-in method → enable **Email/Password**.
2. Firestore → Rules, so that each user can reach only their own record:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /scores/{uid}/{rest=**} {
         allow read, write: if request.auth != null && request.auth.uid == uid;
       }
       // the old shared record: readable by any logged-in user, only for importLegacyProgress
       match /scores/harsimar-progress {
         allow read: if request.auth != null;
       }
     }
   }
   ```

The web API key is public, so someone who has it could create a Firebase account
without going through `POST /api/users`. That account could only reach its own,
empty `scores/{uid}`. To rule this out completely, a service account is needed,
which this app deliberately avoids.

## Run locally

Needs Java 21+:

```bash
./mvnw spring-boot:run
```

Open http://localhost:8080. Tests: `./mvnw test`.

### Against the Firestore emulator (no real data touched)

```bash
npx firebase-tools emulators:start --only firestore --project a2-vocab-trainer   # port 8081 via firebase.json
FIRESTORE_BASE_URL=http://127.0.0.1:8081/v1 ./mvnw spring-boot:run
```

## Deploy

Any host that runs a container or a jar (Cloud Run, Render, Railway, …):

```bash
docker build -t deutsch-vocab-trainer .
```

The app listens on `$PORT` (default 8080). Set these environment variables in production:

- `JWT_SECRET`: 32+ random characters. Without it, a random key is made at
  each start and everyone is logged out on restart.

Also overridable: `FIRESTORE_BASE_URL`, `VOCAB_URL`, `CORS_ALLOWED_ORIGINS`.
