package com.vocabtrainer.progress;

import java.util.LinkedHashMap;
import java.util.Map;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/** Error bodies the page can show as-is: { status, error, message }. */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    @ExceptionHandler(FirestoreAccessException.class)
    public ResponseEntity<Map<String, Object>> firestore(FirestoreAccessException e) {
        log.error("Firestore error", e);
        return body(HttpStatus.BAD_GATEWAY, "storage unavailable — try again");
    }

    /** Our own errors carry a readable reason ("“Abfall” is already in A2", "GitHub rejected the token …"). */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> status(ResponseStatusException e) {
        HttpStatus status = HttpStatus.valueOf(e.getStatusCode().value());
        return body(status, e.getReason() != null ? e.getReason() : status.getReasonPhrase());
    }

    private static ResponseEntity<Map<String, Object>> body(HttpStatus status, String message) {
        Map<String, Object> b = new LinkedHashMap<>();
        b.put("status", status.value());
        b.put("error", status.getReasonPhrase());
        b.put("message", message);
        return ResponseEntity.status(status).body(b);
    }
}
