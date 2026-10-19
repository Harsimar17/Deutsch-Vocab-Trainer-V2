package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.security.JwtService;
import com.vocabtrainer.security.SessionInterceptor;
import com.vocabtrainer.service.TalkloopService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Talkloop (see {@link TalkloopService}): the page asks for a link with the
 * learner's session; Talkloop then reads the learnt words and syncs its mistake
 * log with that link.
 */
@RestController
@RequestMapping("/api/talkloop")
public class TalkloopController {

    private final TalkloopService talkloop;

    public TalkloopController(TalkloopService talkloop) {
        this.talkloop = talkloop;
    }

    @PostMapping("/link")
    public Map<String, Object> link(HttpServletRequest request) {
        if (!(request.getAttribute(SessionInterceptor.SESSION_ATTRIBUTE) instanceof JwtService.Session s)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "not logged in");
        }
        return talkloop.link(s);
    }

    /** Needs a Talkloop link, not a session (see TalkloopLinkInterceptor). */
    @GetMapping("/words")
    public Map<String, Object> words(Ctx ctx) {
        return talkloop.learntWords(ctx);
    }

    /** Merges a device's new mistakes into the log and returns the whole log. Needs the link too. */
    @PostMapping("/mistakes")
    public Map<String, Object> mistakes(Ctx ctx, @RequestBody Map<String, Object> body) {
        return talkloop.syncMistakes(ctx, body);
    }

    /** Merges a device's speaking schedule and returns the whole schedule. Needs the link too. */
    @PostMapping("/spoken")
    public Map<String, Object> spoken(Ctx ctx, @RequestBody Map<String, Object> body) {
        return talkloop.syncSpoken(ctx, body);
    }
}
