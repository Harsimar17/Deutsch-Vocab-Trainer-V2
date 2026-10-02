package com.vocabtrainer;

import org.springframework.boot.SpringApplication;

/**
 * The real app with Firebase Auth and Firestore replaced by in-memory fakes
 * (see {@link FakeBackends}) — click through the whole UI locally without
 * touching the Firebase project. Test users: anna@test.local / anna-test-pw,
 * ben@test.local / ben-test-pw. Progress is lost on restart.
 *
 *   ./mvnw spring-boot:test-run -Dspring-boot.run.main-class=com.vocabtrainer.LocalDemoApplication
 */
public class LocalDemoApplication {

    public static void main(String[] args) {
        SpringApplication.from(VocabBackendApplication::main).with(FakeBackends.class).run(args);
    }
}
