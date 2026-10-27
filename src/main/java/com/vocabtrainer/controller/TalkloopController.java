package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.security.JwtService;
import com.vocabtrainer.security.SessionInterceptor;
import com.vocabtrainer.service.CloudflareAiProxy;
import com.vocabtrainer.service.TalkloopService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
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
    private final CloudflareAiProxy cloudflare;

    public TalkloopController(TalkloopService talkloop, CloudflareAiProxy cloudflare) {
        this.talkloop = talkloop;
        this.cloudflare = cloudflare;
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

    /**
     * Forwards a chat request to Cloudflare Workers AI with the learner's own account ID and
     * token (sent per request, never stored), as Cloudflare refuses calls from web pages.
     * Needs the link, so only Talkloop's own users can use it.
     */
    @PostMapping("/cloudflare")
    public ResponseEntity<String> cloudflare(HttpServletRequest request,
                                             @RequestHeader(value = "X-Cloudflare-Account", required = false) String account,
                                             @RequestHeader(value = "X-Cloudflare-Token", required = false) String token,
                                             @RequestBody Map<String, Object> body) {
        if (!(request.getAttribute(SessionInterceptor.SESSION_ATTRIBUTE) instanceof JwtService.Session)) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "not linked");
        }
        return cloudflare.chat(account, token, body);
    }

    /** The saved topic chats and the topics discussed so far. Needs the link too. */
    @GetMapping("/chats")
    public Map<String, Object> chats(Ctx ctx) {
        return talkloop.chats(ctx);
    }

    /** Saves one topic chat (created or replaced). Needs the link too. */
    @PostMapping("/chats/{id}")
    public Map<String, Object> saveChat(Ctx ctx, @PathVariable String id, @RequestBody Map<String, Object> body) {
        return talkloop.saveChat(ctx, id, body);
    }

    /** Deletes one topic chat; its topic still counts as discussed. Needs the link too. */
    @DeleteMapping("/chats/{id}")
    public Map<String, Object> deleteChat(Ctx ctx, @PathVariable String id) {
        talkloop.deleteChat(ctx, id);
        return Map.of("ok", true);
    }

    /** Merges a device's speaking schedule and returns the whole schedule. Needs the link too. */
    @PostMapping("/spoken")
    public Map<String, Object> spoken(Ctx ctx, @RequestBody Map<String, Object> body) {
        return talkloop.syncSpoken(ctx, body);
    }

    /** Merges a device's Dolmetscher sentence deck and returns the whole deck. Needs the link too. */
    @PostMapping("/sentences")
    public Map<String, Object> sentences(Ctx ctx, @RequestBody Map<String, Object> body) {
        return talkloop.syncSentences(ctx, body);
    }
}
