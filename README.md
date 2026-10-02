# Deutsch Vocab Trainer V2

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
| Users (admin-created), login, session JWT with a 24 h idle timeout | `auth/UserController`, `auth/AuthController`, `auth/JwtService`, `security/SessionInterceptor` |

## API

All `/api` calls except `/api/vocab`, `/api/auth/login` and `/api/users` need
`Authorization: Bearer <session token>`. Every such response carries a renewed
token in `X-Auth-Token`; use it for the next call. A token expires 24 h after
it was issued, so a session ends after 24 h without a request. Send
`X-Time-Zone: <IANA zone>` so "today" and the streak follow the learner's local midnight.

| Call | |
|---|---|
| `POST /api/users` (+ `X-Admin-Key`) `{email, password, importLegacyProgress?}` | create a user (admin only, e.g. from Postman) → `201 {uid, email}` |
| `POST /api/auth/login` `{email, password}` | → `{token, expiresIn, user: {uid, email}}` |
| `GET /api/auth/me` | who the token belongs to |
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

Rounds are kept in memory (`drill/DrillStore`, 6 h idle limit) and belong to
the user who started them; every answer is saved to Firestore as it happens,
so losing a round only means starting a new one. Progress is cached in memory
per user and written through (`progress/ProgressStore`).

## Users

Create a user from Postman (or curl). The admin key is whatever you set as
`ADMIN_API_KEY`; without it, creating users is switched off.

```bash
curl -X POST http://localhost:8080/api/users -H "X-Admin-Key: $ADMIN_API_KEY" -H "Content-Type: application/json" -d '{"email":"anna@example.com","password":"at-least-6-chars"}'
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
- `ADMIN_API_KEY`: the key for `POST /api/users`. Without it, creating users is off.

Also overridable: `FIRESTORE_BASE_URL`, `VOCAB_URL`, `CORS_ALLOWED_ORIGINS`.
