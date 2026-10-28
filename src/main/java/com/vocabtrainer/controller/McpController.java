package com.vocabtrainer.controller;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.service.McpService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Talkloop for ChatGPT (see {@link McpService}), at /mcp/{link}: the Talkloop link is
 * in the address, since ChatGPT's developer mode connects to a plain URL
 * (see TalkloopLinkInterceptor). ?tz=Area/City sets the learner's day for the
 * speaking schedule.
 */
@RestController
@RequestMapping("/mcp/{link}")
public class McpController {

    private final McpService mcp;

    public McpController(McpService mcp) {
        this.mcp = mcp;
    }

    @PostMapping
    public ResponseEntity<Object> message(Ctx ctx, HttpServletRequest request, @RequestBody Object body) {
        Object answer = mcp.handle(ctx, origin(request), body);
        return answer == null ? ResponseEntity.accepted().build() : ResponseEntity.ok(answer);
    }

    /** This server as ChatGPT reaches it: behind Render or a tunnel, the forwarded scheme and host. */
    private static String origin(HttpServletRequest request) {
        String proto = request.getHeader("X-Forwarded-Proto");
        String host = request.getHeader("X-Forwarded-Host") != null ? request.getHeader("X-Forwarded-Host") : request.getHeader("Host");
        return (proto != null ? proto.split(",")[0].trim() : request.getScheme()) + "://"
                + (host != null ? host.split(",")[0].trim() : request.getServerName() + ":" + request.getServerPort());
    }

    /** No server-sent event stream: everything is answered in the POST. */
    @GetMapping
    public ResponseEntity<Void> stream() {
        return ResponseEntity.status(HttpStatus.METHOD_NOT_ALLOWED).build();
    }
}
