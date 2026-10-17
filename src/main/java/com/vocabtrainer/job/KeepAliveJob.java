package com.vocabtrainer.job;

import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalTime;
import java.time.ZoneId;

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
 * During the quiet window (app.keep-alive.quiet-from until quiet-until, in
 * app.keep-alive.zone) it skips its pings so the service can sleep and save
 * free instance hours. Waking it up again at the end of the window has to come
 * from outside — see .github/workflows/wake-up.yml.
 */
@Component
public class KeepAliveJob {

    private static final Logger log = LoggerFactory.getLogger(KeepAliveJob.class);

    private final RestClient http;
    private final String healthUrl;
    private final Clock clock;
    private final LocalTime quietFrom;
    private final LocalTime quietUntil;

    @Autowired
    public KeepAliveJob(@Value("${app.keep-alive.url:}") String baseUrl,
                        @Value("${app.keep-alive.quiet-from:}") String quietFrom,
                        @Value("${app.keep-alive.quiet-until:}") String quietUntil,
                        @Value("${app.keep-alive.zone:Asia/Kolkata}") String zone) {
        this(defaultClient(), baseUrl, Clock.system(ZoneId.of(zone)), time(quietFrom), time(quietUntil));
    }

    KeepAliveJob(RestClient http, String baseUrl) {
        this(http, baseUrl, Clock.systemDefaultZone(), null, null);
    }

    KeepAliveJob(RestClient http, String baseUrl, Clock clock, LocalTime quietFrom, LocalTime quietUntil) {
        this.http = http;
        this.healthUrl = StringUtils.hasText(baseUrl) ? baseUrl.replaceAll("/+$", "") + "/health" : null;
        this.clock = clock;
        this.quietFrom = quietFrom;
        this.quietUntil = quietUntil;
        if (healthUrl == null) {
            log.info("Keep-alive off (no app.keep-alive.url / RENDER_EXTERNAL_URL)");
        } else if (quietFrom != null && quietUntil != null) {
            log.info("Keep-alive on: pinging {}, quiet {}–{} {}", healthUrl, quietFrom, quietUntil, clock.getZone());
        } else {
            log.info("Keep-alive on: pinging {}", healthUrl);
        }
    }

    /** Every 10 minutes (configurable) — comfortably inside Render's 15-minute idle limit. */
    @Scheduled(initialDelayString = "${app.keep-alive.initial-delay:PT1M}", fixedDelayString = "${app.keep-alive.interval:PT10M}")
    public void ping() {
        if (healthUrl == null || isQuiet()) {
            return;
        }
        try {
            http.get().uri(healthUrl).retrieve().toBodilessEntity();
            log.info("Keep-alive ping ok");
        } catch (RuntimeException e) {
            // never let a failed ping disturb the app — the next one will try again
            log.warn("Keep-alive ping to {} failed: {}", healthUrl, e.getMessage());
        }
    }

    /** True inside the quiet window; a window like 23:00–06:00 that crosses midnight works too. */
    boolean isQuiet() {
        if (quietFrom == null || quietUntil == null) {
            return false;
        }
        LocalTime now = LocalTime.now(clock);
        return quietFrom.isBefore(quietUntil)
                ? !now.isBefore(quietFrom) && now.isBefore(quietUntil)
                : !now.isBefore(quietFrom) || now.isBefore(quietUntil);
    }

    String healthUrl() {
        return healthUrl;
    }

    private static LocalTime time(String value) {
        return StringUtils.hasText(value) ? LocalTime.parse(value.trim()) : null;
    }

    private static RestClient defaultClient() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build());
        factory.setReadTimeout(Duration.ofSeconds(30));
        return RestClient.builder().requestFactory(factory).build();
    }
}
