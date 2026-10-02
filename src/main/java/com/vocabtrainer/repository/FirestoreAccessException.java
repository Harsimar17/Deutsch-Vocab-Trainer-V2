package com.vocabtrainer.repository;

public class FirestoreAccessException extends RuntimeException {

    public FirestoreAccessException(String message, Throwable cause) {
        super(message, cause);
    }
}
