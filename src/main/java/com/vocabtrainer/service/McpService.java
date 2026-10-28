package com.vocabtrainer.service;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.FirestoreAccessException;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * A Model Context Protocol server, so ChatGPT (developer mode, or an app in ChatGPT)
 * can run Talkloop with ChatGPT itself as the conversation partner: see
 * {@link TalkloopChatGptService} for the tools. Stateless "Streamable HTTP": every
 * JSON-RPC message is one POST and its answer is plain JSON (no event stream, no
 * session id). Notifications get no answer.
 */
@Service
public class McpService {

    static final List<String> PROTOCOL_VERSIONS = List.of("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05");
    private static final String INSTRUCTIONS = "Talkloop is the learner's German speaking practice. When they want to practise German, "
            + "call start_talkloop and follow what it returns for the rest of the conversation; call record_turn as it says.";

    private final TalkloopChatGptService talkloop;

    public McpService(TalkloopChatGptService talkloop) {
        this.talkloop = talkloop;
    }

    /** One JSON-RPC message or a batch → the answer, or null when there is nothing to answer. */
    public Object handle(Ctx ctx, Object body) {
        if (body instanceof List<?> batch) {
            List<Map<String, Object>> answers = batch.stream().map(m -> message(ctx, m)).filter(Objects::nonNull).toList();
            return answers.isEmpty() ? null : answers;
        }
        return message(ctx, body);
    }

    private Map<String, Object> message(Ctx ctx, Object o) {
        if (!(o instanceof Map<?, ?> m) || !(m.get("method") instanceof String method)) {
            return o instanceof Map<?, ?> m && m.containsKey("id") ? error(m.get("id"), -32600, "invalid request") : null;
        }
        if (!m.containsKey("id")) {
            return null; // a notification (initialized, cancelled …): nothing to answer
        }
        Object id = m.get("id");
        Map<?, ?> params = m.get("params") instanceof Map<?, ?> p ? p : Map.of();
        return switch (method) {
            case "initialize" -> result(id, initialize(params));
            case "ping" -> result(id, Map.of());
            case "tools/list" -> result(id, Map.of("tools", talkloop.tools()));
            case "tools/call" -> result(id, callTool(ctx, params));
            default -> error(id, -32601, "method not found: " + method);
        };
    }

    private static Map<String, Object> initialize(Map<?, ?> params) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("protocolVersion", params.get("protocolVersion") instanceof String v && PROTOCOL_VERSIONS.contains(v) ? v : PROTOCOL_VERSIONS.get(0));
        r.put("capabilities", Map.of("tools", Map.of()));
        r.put("serverInfo", Map.of("name", "talkloop", "title", "Talkloop", "version", "1.0.0"));
        r.put("instructions", INSTRUCTIONS);
        return r;
    }

    /** A tool's answer; a bad call or a storage problem comes back as a tool error ChatGPT can read. */
    @SuppressWarnings("unchecked")
    private Map<String, Object> callTool(Ctx ctx, Map<?, ?> params) {
        String name = params.get("name") instanceof String n ? n : "";
        Map<String, Object> args = params.get("arguments") instanceof Map<?, ?> a ? (Map<String, Object>) a : Map.of();
        try {
            return Map.of("content", List.of(Map.of("type", "text", "text", talkloop.call(ctx, name, args))));
        } catch (ResponseStatusException e) {
            return toolError(e.getReason() != null ? e.getReason() : e.getMessage());
        } catch (FirestoreAccessException e) {
            return toolError("The learner's data can't be reached right now; go on without saving and try again later.");
        }
    }

    private static Map<String, Object> toolError(String message) {
        return Map.of("content", List.of(Map.of("type", "text", "text", message)), "isError", true);
    }

    private static Map<String, Object> result(Object id, Object result) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("jsonrpc", "2.0");
        r.put("id", id);
        r.put("result", result);
        return r;
    }

    private static Map<String, Object> error(Object id, int code, String message) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("jsonrpc", "2.0");
        r.put("id", id);
        r.put("error", Map.of("code", code, "message", message));
        return r;
    }
}
