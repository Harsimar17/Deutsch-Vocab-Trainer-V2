package com.vocabtrainer.job;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

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
    void skipsPingsInTheQuietWindow() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = jobAt(builder, "06:00");
        job.ping();
        server.verify(); // no request made
    }

    @Test
    void quietWindowIsFrom0430Until0800IndiaTime() {
        RestClient.Builder builder = RestClient.builder();
        assertFalse(jobAt(builder, "04:29").isQuiet());
        assertTrue(jobAt(builder, "04:30").isQuiet());
        assertTrue(jobAt(builder, "07:59").isQuiet());
        assertFalse(jobAt(builder, "08:00").isQuiet());
        assertFalse(jobAt(builder, "08:01").isQuiet());
    }

    @Test
    void quietWindowCanCrossMidnight() {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        KeepAliveJob night = new KeepAliveJob(RestClient.builder().build(), "https://vocab.onrender.com",
                Clock.fixed(ZonedDateTime.of(2026, 10, 17, 1, 0, 0, 0, ist).toInstant(), ist),
                LocalTime.of(23, 0), LocalTime.of(6, 0));
        assertTrue(night.isQuiet());
    }

    private static KeepAliveJob jobAt(RestClient.Builder builder, String istTime) {
        ZoneId ist = ZoneId.of("Asia/Kolkata");
        Clock clock = Clock.fixed(ZonedDateTime.of(LocalDate.of(2026, 10, 17), LocalTime.parse(istTime), ist).toInstant(), ist);
        return new KeepAliveJob(builder.build(), "https://vocab.onrender.com", clock, LocalTime.of(4, 30), LocalTime.of(8, 0));
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
