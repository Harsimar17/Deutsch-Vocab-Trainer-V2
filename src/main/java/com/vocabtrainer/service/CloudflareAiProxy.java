package com.vocabtrainer.service;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Talkloop's Cloudflare Workers AI backup. Cloudflare's API refuses calls from web pages
 * (no CORS), so Talkloop sends the chat request here and this forwards it with the
 * learner's own account ID and token, which come with each request and are never stored.
 * Only the one model Talkloop uses and the fields of a chat request are forwarded, so this
 * is no open proxy.
 */
@Service
public class CloudflareAiProxy {

    static final String MODEL = "@cf/openai/gpt-oss-120b";
    private static final Pattern ACCOUNT = Pattern.compile("[0-9a-f]{32}");
    private static final Pattern TOKEN = Pattern.compile("[A-Za-z0-9_\\-]{20,200}");
    private static final Set<String> FIELDS = Set.of("messages", "response_format", "temperature", "max_tokens", "reasoning_effort");
    private static final int MAX_MESSAGES = 60;

    private final RestClient http;

    @Autowired
    public CloudflareAiProxy(@Value("${app.cloudflare.api-url:https://api.cloudflare.com/client/v4}") String apiUrl) {
        this(RestClient.builder().baseUrl(apiUrl).requestFactory(factory()).build());
    }

    CloudflareAiProxy(RestClient http) {
        this.http = http;
    }

    /** Cloudflare's answer as it came (an OpenAI-style chat completion), with its status. */
    public ResponseEntity<String> chat(String account, String token, Map<String, Object> body) {
        if (account == null || !ACCOUNT.matcher(account).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "X-Cloudflare-Account: expected a 32-character account ID");
        }
        if (token == null || !TOKEN.matcher(token).matches()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "X-Cloudflare-Token: expected an API token");
        }
        if (!(body.get("messages") instanceof List<?> messages) || messages.isEmpty() || messages.size() > MAX_MESSAGES) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "messages: expected 1 to " + MAX_MESSAGES + " messages");
        }
        Map<String, Object> forward = new LinkedHashMap<>();
        forward.put("model", MODEL);
        FIELDS.stream().filter(body::containsKey).forEach((f) -> forward.put(f, body.get(f)));
        try {
            String answer = http.post().uri("/accounts/{account}/ai/v1/chat/completions", account)
                    .header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(forward)
                    .retrieve().body(String.class);
            return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(answer);
        } catch (RestClientResponseException e) {
            // Cloudflare's own status (401 bad token, 429 limit…) goes back to Talkloop as it is.
            return ResponseEntity.status(e.getStatusCode()).contentType(MediaType.APPLICATION_JSON).body(e.getResponseBodyAsString());
        }
    }

    private static JdkClientHttpRequestFactory factory() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());
        factory.setReadTimeout(Duration.ofSeconds(60));
        return factory;
    }
}
