package com.vocabtrainer.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

class CloudflareAiProxyTest {

    private static final String API = "https://cf.test/client/v4";
    private static final String ACCOUNT = "0123456789abcdef0123456789abcdef";
    private static final String TOKEN = "cfut_test-token_1234567890";
    private static final String URL = API + "/accounts/" + ACCOUNT + "/ai/v1/chat/completions";

    private MockRestServiceServer server;
    private CloudflareAiProxy proxy;

    @BeforeEach
    void setUp() {
        RestClient.Builder builder = RestClient.builder().baseUrl(API);
        server = MockRestServiceServer.bindTo(builder).build();
        proxy = new CloudflareAiProxy(builder.build());
    }

    /** Only the chat fields go on, with the one model and the learner's token. */
    @Test
    void forwardsAChatRequestWithTheFixedModel() {
        server.expect(requestTo(URL))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer " + TOKEN))
                .andExpect(content().json("""
                        {"model":"@cf/openai/gpt-oss-120b","messages":[{"role":"user","content":"Hallo"}],"temperature":0.4}
                        """, org.springframework.test.json.JsonCompareMode.STRICT))
                .andRespond(withSuccess("{\"choices\":[{\"message\":{\"content\":\"{}\"}}]}", MediaType.APPLICATION_JSON));
        ResponseEntity<String> answer = proxy.chat(ACCOUNT, TOKEN, Map.of(
                "model", "@cf/some/other-model", "messages", List.of(Map.of("role", "user", "content", "Hallo")),
                "temperature", 0.4, "tools", List.of("x")));
        assertEquals(200, answer.getStatusCode().value());
        assertEquals("{\"choices\":[{\"message\":{\"content\":\"{}\"}}]}", answer.getBody());
        server.verify();
    }

    /** Cloudflare's own error (e.g. its daily limit) reaches Talkloop with its status. */
    @Test
    void passesCloudflareErrorsOn() {
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.TOO_MANY_REQUESTS)
                .contentType(MediaType.APPLICATION_JSON).body("{\"errors\":[{\"message\":\"limit\"}]}"));
        ResponseEntity<String> answer = proxy.chat(ACCOUNT, TOKEN, Map.of("messages", List.of(Map.of("role", "user", "content", "x"))));
        assertEquals(429, answer.getStatusCode().value());
        assertEquals("{\"errors\":[{\"message\":\"limit\"}]}", answer.getBody());
    }

    @Test
    void refusesMalformedRequestsWithoutCallingCloudflare() {
        Map<String, Object> ok = Map.of("messages", List.of(Map.of("role", "user", "content", "x")));
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> proxy.chat("../evil", TOKEN, ok)).getStatusCode().value());
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> proxy.chat(ACCOUNT, "bad token!", ok)).getStatusCode().value());
        assertEquals(400, assertThrows(ResponseStatusException.class, () -> proxy.chat(ACCOUNT, TOKEN, Map.of("messages", List.of()))).getStatusCode().value());
        server.verify();
    }
}
