package com.vocabtrainer.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.vocabtrainer.repository.FirebaseAuthClient;
import com.vocabtrainer.repository.ProgressRepository;
import com.vocabtrainer.security.IdTokenCache;
import com.vocabtrainer.security.JwtService;
import com.vocabtrainer.service.AuthService;
import com.vocabtrainer.service.UserService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

@WebMvcTest(controllers = {AuthController.class, UserController.class}, properties = "app.auth.admin-key=admin-secret")
@Import({JwtService.class, IdTokenCache.class, AuthService.class, UserService.class})
class AuthControllerTest {

    private static final String LOGIN = "{\"email\":\"Anna@Example.de\",\"password\":\"hunter22\"}";

    @Autowired
    MockMvc mvc;

    @Autowired
    JwtService jwt;

    @MockitoBean
    FirebaseAuthClient firebase;

    @MockitoBean
    ProgressRepository progress;

    @Test
    void loginGivesASessionTokenForTheUser() throws Exception {
        when(firebase.signIn("anna@example.de", "hunter22"))
                .thenReturn(new FirebaseAuthClient.FirebaseSession("uid-anna", "anna@example.de", "id", "refresh", 3600));
        String body = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content(LOGIN))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.expiresIn").value(86400))
                .andExpect(jsonPath("$.user.uid").value("uid-anna"))
                .andReturn().getResponse().getContentAsString();
        String token = (String) JsonMapper.builder().build().readValue(body, java.util.Map.class).get("token");

        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.uid").value("uid-anna"))
                .andExpect(jsonPath("$.email").value("anna@example.de"))
                .andExpect(header().exists("X-Auth-Token")); // sliding expiry: a fresh token every time
    }

    @Test
    void loginChecksItsInputBeforeAskingFirebase() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"nope\",\"password\":\"hunter22\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON).content("{\"email\":\"a@b.de\",\"password\":\"123\"}"))
                .andExpect(status().isBadRequest());
        verifyNoInteractions(firebase);
    }

    @Test
    void protectedCallsNeedAValidSession() throws Exception {
        mvc.perform(get("/api/auth/me")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/auth/me").header("Authorization", "Bearer aaa.bbb.ccc")).andExpect(status().isUnauthorized());
    }

    @Test
    void creatingUsersNeedsTheAdminKey() throws Exception {
        String user = "{\"email\":\"ben@example.de\",\"password\":\"secret12\"}";
        mvc.perform(post("/api/users").contentType(MediaType.APPLICATION_JSON).content(user))
                .andExpect(status().isUnauthorized());
        mvc.perform(post("/api/users").header("X-Admin-Key", "wrong").contentType(MediaType.APPLICATION_JSON).content(user))
                .andExpect(status().isUnauthorized());
        // A session token is not an admin key.
        mvc.perform(post("/api/users").header("Authorization", "Bearer " + jwt.issue("u", "a@b.de", "r"))
                        .contentType(MediaType.APPLICATION_JSON).content(user))
                .andExpect(status().isUnauthorized());
        verifyNoInteractions(firebase);
    }

    @Test
    void createsAUserAndOptionallyCopiesTheOldProgress() throws Exception {
        when(firebase.signUp("ben@example.de", "secret12"))
                .thenReturn(new FirebaseAuthClient.FirebaseSession("uid-ben", "ben@example.de", "id", "refresh", 3600));
        when(progress.copyLegacyProgress(any())).thenReturn(true);
        mvc.perform(post("/api/users").header("X-Admin-Key", "admin-secret").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"ben@example.de\",\"password\":\"secret12\",\"importLegacyProgress\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.uid").value("uid-ben"))
                .andExpect(jsonPath("$.importedLegacyProgress").value(true));
        verify(progress).copyLegacyProgress(any());
    }
}
