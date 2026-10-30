package com.vocabtrainer.job;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KeepAliveJobTest {

    private static final ZoneId INDIA = ZoneId.of("Asia/Kolkata");
    private static final LocalTime SLEEP_AT = LocalTime.of(4, 30);

    /** A clock the test moves forward by hand. */
    private static final class TestClock extends Clock {
        Instant now;

        TestClock(String localDateTime) {
            now = ZonedDateTime.of(LocalDateTime.parse(localDateTime), INDIA).toInstant();
        }

        void advanceTo(String localDateTime) {
            now = ZonedDateTime.of(LocalDateTime.parse(localDateTime), INDIA).toInstant();
        }

        @Override public ZoneId getZone() { return INDIA; }
        @Override public Clock withZone(ZoneId zone) { throw new UnsupportedOperationException(); }
        @Override public Instant instant() { return now; }
    }

    private static KeepAliveJob job(RestClient http, String baseUrl) {
        return new KeepAliveJob(http, baseUrl, new TestClock("2026-10-31T08:05"), SLEEP_AT);
    }

    @Test
    void pingsTheAppsOwnHealthUrl() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = job(builder.build(), "https://vocab.onrender.com/");
        server.expect(requestTo("https://vocab.onrender.com/health")).andExpect(method(HttpMethod.GET))
                .andRespond(withSuccess("{\"status\":\"ok\"}", null));
        job.ping();
        server.verify();
    }

    @Test
    void aFailedPingNeverThrows() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = job(builder.build(), "https://vocab.onrender.com");
        server.expect(requestTo("https://vocab.onrender.com/health")).andRespond(withServerError());
        assertDoesNotThrow(job::ping);
    }

    @Test
    void offWithoutAUrl() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        KeepAliveJob job = job(builder.build(), "");
        assertNull(job.healthUrl());
        job.ping();
        server.verify(); // no request made
        assertEquals(null, job(builder.build(), null).healthUrl());
    }

    @Test
    void stopsPingingAtHalfPastFourUntilTheNextStart() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        TestClock clock = new TestClock("2026-10-31T08:05"); // woken by the morning shortcut
        KeepAliveJob job = new KeepAliveJob(builder.build(), "https://vocab.onrender.com", clock, SLEEP_AT);
        server.expect(requestTo("https://vocab.onrender.com/health")).andRespond(withSuccess());
        server.expect(requestTo("https://vocab.onrender.com/health")).andRespond(withSuccess());
        job.ping();
        clock.advanceTo("2026-11-01T04:25");
        job.ping(); // still the night before the cut-off
        clock.advanceTo("2026-11-01T04:30");
        job.ping();
        clock.advanceTo("2026-11-01T08:05"); // same run still up (no restart): stays quiet
        job.ping();
        server.verify(); // exactly the two pings before 04:30
    }

    @Test
    void sleepsAtTheNextHalfPastFour() {
        ZonedDateTime morning = ZonedDateTime.of(2026, 10, 31, 8, 5, 0, 0, INDIA);
        assertEquals(ZonedDateTime.of(2026, 11, 1, 4, 30, 0, 0, INDIA).toInstant(),
                KeepAliveJob.nextOccurrence(morning, SLEEP_AT));
        ZonedDateTime earlyMorning = ZonedDateTime.of(2026, 10, 31, 2, 0, 0, 0, INDIA);
        assertEquals(ZonedDateTime.of(2026, 10, 31, 4, 30, 0, 0, INDIA).toInstant(),
                KeepAliveJob.nextOccurrence(earlyMorning, SLEEP_AT));
        ZonedDateTime exactly = ZonedDateTime.of(2026, 10, 31, 4, 30, 0, 0, INDIA);
        assertEquals(ZonedDateTime.of(2026, 11, 1, 4, 30, 0, 0, INDIA).toInstant(),
                KeepAliveJob.nextOccurrence(exactly, SLEEP_AT));
    }
}
