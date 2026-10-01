# Deutsch Vocab Trainer V2

A German vocabulary trainer (A1–B1) with spaced repetition, quizzes, B1
reading stories and end-of-phase tests — run entirely by a Spring Boot app. **All logic lives
here**; the page (`src/main/resources/static/index.html`, served at `/`) only
renders what the API returns and sends the learner's actions back.

What the page still does on its own is purely presentational: which tab is
open, whether a card is flipped, the text being typed, tooltip position, and
text-to-speech. The browser stores nothing (no localStorage, sessionStorage
or IndexedDB). The Gemini key and GitHub token are kept in memory for one
visit and sent only with the request that needs them.

The vocabulary itself (`german_vocab.json`) is maintained in
[Harsimar17/Deutsch-Vocab-Helper](https://github.com/Harsimar17/Deutsch-Vocab-Helper):
the app reads it from there and "+ Add word" commits to it. A copy is bundled
in `src/main/resources/data/` as the fallback when GitHub can't be reached.

## What runs where

| Concern | Java |
|---|---|
| Vocabulary + stories | read from GitHub (`app.vocab.url`), cached, re-checked every 5 min; bundled copy as fallback — `vocab/VocabService` |
| Cards, filters by level/category | `cards/CardCatalog` |
| Answer checking (lenient spelling, articles, umlauts) | `cards/German` |
| Spaced repetition, daily goal, streak (in the learner's time zone) | `progress/Srs`, `progress/ProgressService` |
| Practice rounds — Study, Write, Cards, Quiz, Articles, Trennbare Verben, Fill-in, Review | `drill/*Drill` (server-side state machines) |
| Settings (levels, categories, direction, focus, theme, story mode, …) | `settings/SettingsService` |
| Story reader: words + meanings for every story | `stories/StoryService`, `stories/WordLookup` |
| Phasentest (successive relearning, refreshers at 1/7/30/90/180 days) | `stories/PhaseTests`, `drill/PhaseDrill` |
| Sentence patterns (Muster) | `patterns/PatternsController` + `patterns.json` |
| Example sentences via Gemini, cached in Firestore | `sentences/SentenceController` |
| "+ Add word" → commit to GitHub | `vocab/GitHubVocabCommitter` |
| Anonymous sign-in, token refresh | `auth/AuthController` |

## API

All `/api` calls except `/api/vocab` and `/api/auth/**` need
`Authorization: Bearer <Firebase ID token>`. Send `X-Time-Zone: <IANA zone>`
so "today" and the streak follow the learner's local midnight.

| Call | |
|---|---|
| `POST /api/auth/anonymous`, `POST /api/auth/refresh` | anonymous session (tokens kept in page memory) |
| `GET /api/summary?ai=` | header numbers, settings, settings label, level title, card count, Review count |
| `POST /api/settings/{action}` `{value}` | `toggleLevel`, `toggleCat`, `toggleDirection`, `toggleNoRepeat`, `setFocus`, `setTheme`, `setStoryMode`, `setStoryShowEn`, `openStory`, `openPhaseTest` |
| `POST /api/drills/{mode}` | start a round: `study`, `write`, `flash`, `quiz`, `articles`, `sep`, `cloze`, `review`, `phase` (`{phase, refresh}`) → `{id, view}` |
| `POST /api/drills/{id}/{action}` `{…}` | e.g. `answer {key}`, `grade {grade}`, `check {input}`, `next`, `hint`, `overrule`, `finish` → `{id, view}` |
| `GET /api/stories`, `GET /api/stories/{id}`, `POST /api/stories/{id}/read` | story list, analysed reader view, read mark |
| `GET /api/phase-tests/{idx}`, `POST /api/phase-tests/{idx}/reset` | Phasentest overview |
| `GET /api/patterns`, `POST /api/patterns/{key}/seen` | Muster |
| `POST /api/sentences/generate` (+ `X-Gemini-Key`) | saved sentence, or generate + save; `{needsKey}` without a key |
| `POST /api/vocab/words` (+ `X-GitHub-Token`) | add a word = one commit on GitHub |
| `GET /api/vocab` | the raw file (public) |

Rounds are kept in memory (`drill/DrillStore`, 6 h idle limit); every answer
is saved to Firestore as it happens, so losing a round only means starting a
new one. Progress is cached in memory and written through (`progress/ProgressStore`).

## How it talks to Firebase

No service-account key. The backend uses the project ID and web API key from
the page's old `firebaseConfig` (see `application.properties`):

1. `POST /api/auth/anonymous` → Firebase Auth REST `accounts:signUp` → an anonymous ID token.
2. The page sends that token with every API call.
3. The backend calls the Firestore REST API **with that same token**, so Firestore
   verifies it and applies the project's security rules.

Data lives in `scores/harsimar-progress`: `right`/`total` (quiz score), `srs`,
`daily`, `phaseTests`, `mistakes`, `storiesRead`, `prefs` (all settings), plus
the `sessions/` and `aiSentences/` subcollections. If the Firestore rules only
allow specific subcollections, add `aiSentences` next to `sessions`.

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

The app listens on `$PORT` (default 8080). Overridable with environment
variables: `FIRESTORE_BASE_URL`, `VOCAB_URL`, `CORS_ALLOWED_ORIGINS`.
