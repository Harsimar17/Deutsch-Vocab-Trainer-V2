package com.vocabtrainer.config;

import java.net.http.HttpClient;
import java.time.Duration;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

@Configuration
public class FirestoreConfig {

    /** HTTP client for the Firestore REST API (base URL from app.firebase.firestore-base-url). */
    @Bean
    public RestClient firestoreRestClient(AppProperties props) {
        HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(http);
        factory.setReadTimeout(Duration.ofSeconds(20));
        return RestClient.builder()
                .baseUrl(props.firebase().firestoreBaseUrl())
                .requestFactory(factory)
                .build();
    }
}
