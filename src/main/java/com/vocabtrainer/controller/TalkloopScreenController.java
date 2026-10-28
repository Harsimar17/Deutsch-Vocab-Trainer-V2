package com.vocabtrainer.controller;

import java.util.Map;

import com.vocabtrainer.service.TalkloopChatGptService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

/**
 * What the Talkloop screen in ChatGPT shows (see McpService): it asks here while it waits
 * for ChatGPT's turn. Open to any origin, as ChatGPT's sandbox has none of its own; the
 * random practice id is the only key, and the answer is that practice's conversation.
 */
@RestController
public class TalkloopScreenController {

    private final TalkloopChatGptService talkloop;

    public TalkloopScreenController(TalkloopChatGptService talkloop) {
        this.talkloop = talkloop;
    }

    @GetMapping("/talkloop-screen/{id}")
    public Map<String, Object> screen(@PathVariable String id) {
        return talkloop.screen(id);
    }
}
