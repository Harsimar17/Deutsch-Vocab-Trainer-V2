package com.vocabtrainer;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling // for KeepAliveJob
public class VocabBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(VocabBackendApplication.class, args);
    }
}
