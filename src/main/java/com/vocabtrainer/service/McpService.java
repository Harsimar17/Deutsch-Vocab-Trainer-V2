package com.vocabtrainer.service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

import com.vocabtrainer.model.Ctx;
import com.vocabtrainer.repository.FirestoreAccessException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

/**
 * A Model Context Protocol server, so ChatGPT (developer mode, or an app in ChatGPT)
 * can run Talkloop with ChatGPT itself as the conversation partner: see
 * {@link TalkloopChatGptService} for the tools. Stateless "Streamable HTTP": every
 * JSON-RPC message is one POST and its answer is plain JSON (no event stream, no
 * session id). Notifications get no answer.
 *
 * The Talkloop screen is an MCP App (the "MCP Apps" extension ChatGPT implements): the
 * resource {@value TalkloopChatGptService#SCREEN_URI} is static/talkloop/chatgpt.html,
 * which ChatGPT shows in the chat when start_talkloop runs. Every tool answer carries the
 * screen's state as structuredContent, tied to that one screen by openai/widgetSessionId.
 */
@Service
public class McpService {

    static final List<String> PROTOCOL_VERSIONS = List.of("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05");
    private static final String INSTRUCTIONS = "Talkloop is the learner's German speaking practice. When they want to practise German, "
            + "call start_talkloop and follow what it returns for the rest of the conversation; call talkloop_turn as it says.";
    private static final String SCREEN_MIME_TYPE = "text/html;profile=mcp-app";

    private final TalkloopChatGptService talkloop;
    private final String screenHtml;

    public McpService(TalkloopChatGptService talkloop) {
        this.talkloop = talkloop;
        try {
            this.screenHtml = new ClassPathResource("static/talkloop/chatgpt.html").getContentAsString(StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /**
     * One JSON-RPC message or a batch → the answer, or null when there is nothing to answer.
     * origin is this server as ChatGPT reaches it (https://…), where the screen asks for its state.
     */
    public Object handle(Ctx ctx, String origin, Object body) {
        if (body instanceof List<?> batch) {
            List<Map<String, Object>> answers = batch.stream().map(m -> message(ctx, origin, m)).filter(Objects::nonNull).toList();
            return answers.isEmpty() ? null : answers;
        }
        return message(ctx, origin, body);
    }

    private Map<String, Object> message(Ctx ctx, String origin, Object o) {
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
            case "resources/list" -> result(id, Map.of("resources", List.of(Map.of(
                    "uri", TalkloopChatGptService.SCREEN_URI, "name", "Talkloop screen", "mimeType", SCREEN_MIME_TYPE))));
            case "resources/templates/list" -> result(id, Map.of("resourceTemplates", List.of()));
            case "resources/read" -> TalkloopChatGptService.SCREEN_URI.equals(params.get("uri"))
                    ? result(id, Map.of("contents", List.of(screen(origin))))
                    : error(id, -32002, "resource not found");
            default -> error(id, -32601, "method not found: " + method);
        };
    }

    private static Map<String, Object> initialize(Map<?, ?> params) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("protocolVersion", params.get("protocolVersion") instanceof String v && PROTOCOL_VERSIONS.contains(v) ? v : PROTOCOL_VERSIONS.get(0));
        r.put("capabilities", Map.of("tools", Map.of(), "resources", Map.of()));
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
            TalkloopChatGptService.ToolResult r = talkloop.call(ctx, name, args);
            Map<String, Object> answer = new LinkedHashMap<>();
            answer.put("content", List.of(Map.of("type", "text", "text", r.text())));
            if (r.screen() != null) {
                Map<String, Object> view = r.screen().view();
                answer.put("structuredContent", view);
                // One screen for the whole practice: without this, every turn would open a new one.
                answer.put("_meta", Map.of("openai/widgetSessionId", view.get("id")));
            } else if (r.data() != null) {
                answer.put("structuredContent", r.data());
            }
            return answer;
        } catch (ResponseStatusException e) {
            return toolError(e.getReason() != null ? e.getReason() : e.getMessage());
        } catch (FirestoreAccessException e) {
            return toolError("The learner's data can't be reached right now; go on without saving and try again later.");
        }
    }

    /**
     * The screen's HTML, told where this server is. ChatGPT runs it sandboxed: it may reach this
     * origin (its state, Talkloop's Piper voice code), LanguageTool, and where the Piper voice and
     * its runtime download from, load Talkloop's fonts, and asks for the microphone.
     */
    private Map<String, Object> screen(String origin) {
        Map<String, Object> csp = new LinkedHashMap<>();
        csp.put("connectDomains", List.of(origin, "https://api.languagetool.org", "https://cdn.jsdelivr.net",
                "https://huggingface.co", "https://*.huggingface.co", "https://*.hf.co"));
        csp.put("resourceDomains", List.of(origin, "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://fonts.gstatic.com"));
        Map<String, Object> ui = new LinkedHashMap<>();
        ui.put("csp", csp);
        ui.put("permissions", Map.of("microphone", Map.of()));
        ui.put("prefersBorder", false);
        Map<String, Object> c = new LinkedHashMap<>();
        c.put("uri", TalkloopChatGptService.SCREEN_URI);
        c.put("mimeType", SCREEN_MIME_TYPE);
        c.put("text", screenHtml.replace("__TALKLOOP_ORIGIN__", origin));
        c.put("_meta", Map.of("ui", ui));
        return c;
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
