package com.vocabtrainer.job;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClient;

/**
 * Keeps the app awake on Render's free tier, which puts a service to sleep
 * after 15 minutes without incoming HTTP traffic. Every few minutes the app
 * calls its own public /health URL; that request comes in through Render's
 * edge like any visitor's, so the idle timer resets.
 *
 * The URL is RENDER_EXTERNAL_URL (set by Render automatically) unless
 * app.keep-alive.url is given. Without a URL — e.g. running locally — the job
 * does nothing. It can only keep a running app awake: if the service was
 * already asleep, the first visitor still wakes it.
 *
 * Each run of the app stops pinging at the next app.keep-alive.sleep-at
 * (04:30 India time by default), so Render puts it to sleep 15 minutes later.
 * Whatever wakes it next (the morning shortcut, a visitor) starts a fresh run,
 * which pings again until the following 04:30.
 */
@Component
public class KeepAliveJob {

    private static final Logger log = LoggerFactory.getLogger(KeepAliveJob.class);

    private final RestClient http;
    private final String healthUrl;
    private final Clock clock;
    private final Instant sleepAt;
    private boolean asleep;

    @Autowired
    public KeepAliveJob(@Value("${app.keep-alive.url:}") String baseUrl,
            @Value("${app.keep-alive.sleep-at:04:30}") String sleepTime,
            @Value("${app.keep-alive.zone:Asia/Kolkata}") String zone) {
        this(defaultClient(), baseUrl, Clock.system(ZoneId.of(zone)), LocalTime.parse(sleepTime));
    }

    KeepAliveJob(RestClient http, String baseUrl, Clock clock, LocalTime sleepTime) {
        this.http = http;
        this.healthUrl = StringUtils.hasText(baseUrl) ? baseUrl.replaceAll("/+$", "") + "/health" : null;
        this.clock = clock;
        this.sleepAt = nextOccurrence(ZonedDateTime.now(clock), sleepTime);
        if (healthUrl == null) {
            log.info("Keep-alive off (no app.keep-alive.url / RENDER_EXTERNAL_URL)");
        } else {
            log.info("Keep-alive on: pinging {} until {}", healthUrl, sleepAt.atZone(clock.getZone()));
        }
    }

    /** Every 10 minutes (configurable) — comfortably inside Render's 15-minute idle limit. */
    @Scheduled(initialDelayString = "${app.keep-alive.initial-delay:PT1M}", fixedDelayString = "${app.keep-alive.interval:PT10M}")
    public void ping() {
        if (healthUrl == null || asleep) {
            return;
        }
        if (!clock.instant().isBefore(sleepAt)) {
            asleep = true;
            log.info("Keep-alive stopped for the night: Render will put the app to sleep");
            return;
        }
        try {
            http.get().uri(healthUrl).retrieve().toBodilessEntity();
            log.error("Keep-alive ping ok");
        } catch (RuntimeException e) {
            // never let a failed ping disturb the app — the next one will try again
            log.warn("Keep-alive ping to {} failed: {}", healthUrl, e.getMessage());
        }
    }

    String healthUrl() {
        return healthUrl;
    }

    /** The first time-of-day {@code time} strictly after {@code now}: today's if still ahead, else tomorrow's. */
    static Instant nextOccurrence(ZonedDateTime now, LocalTime time) {
        ZonedDateTime today = now.with(time);
        return (today.isAfter(now) ? today : today.plusDays(1)).toInstant();
    }

    private static RestClient defaultClient() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());
        factory.setReadTimeout(Duration.ofSeconds(30));
        return RestClient.builder().requestFactory(factory).build();
    }
}
