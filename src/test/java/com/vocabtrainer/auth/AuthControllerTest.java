package com.vocabtrainer.auth;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(AuthController.class)
class AuthControllerTest {

    @Autowired
    MockMvc mvc;

    @Test
    void refreshIsPublicButValidatesItsInput() throws Exception {
        // No Authorization header: reaches the controller (400), not the token check (401).
        mvc.perform(post("/api/auth/refresh").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"\"}"))
                .andExpect(status().isBadRequest());
    }
}
