package com.vocabtrainer.job;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KeepAliveJobTest {

    @Test
    void pingsTheAppsOwnHealthUrl() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = new KeepAliveJob(builder.build(), "https://vocab.onrender.com/");
        server.expect(requestTo("https://vocab.onrender.com/health")).andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"status\":\"ok\"}", null));
        job.ping();
        server.verify();
    }

    @Test
    void aFailedPingNeverThrows() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = new KeepAliveJob(builder.build(), "https://vocab.onrender.com");
        server.expect(requestTo("https://vocab.onrender.com/health")).andRespond(withServerError());
        assertDoesNotThrow(job::ping);
    }

    @Test
    void offWithoutAUrl() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = new KeepAliveJob(builder.build(), "");
        assertNull(job.healthUrl());
        job.ping();
        server.verify(); // no request made
        assertEquals(null, new KeepAliveJob(builder.build(), null).healthUrl());
    }
}
