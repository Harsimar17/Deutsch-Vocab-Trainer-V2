package com.vocabtrainer;

import com.vocabtrainer.repository.FakeFirebaseAuth;
import com.vocabtrainer.repository.InMemoryProgressRepository;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces Firebase Auth and Firestore with in-memory fakes (tests and the local demo server). */
@TestConfiguration(proxyBeanMethods = false)
public class FakeBackends {

    @Bean
    @Primary
    public FakeFirebaseAuth fakeFirebaseAuth() {
        FakeFirebaseAuth auth = new FakeFirebaseAuth();
        auth.addUser("anna@test.local", "anna-test-pw"); // uid1
        auth.addUser("ben@test.local", "ben-test-pw");   // uid2
        return auth;
    }

    @Bean
    @Primary
    public InMemoryProgressRepository inMemoryProgressRepository() {
        return new InMemoryProgressRepository();
    }
}
