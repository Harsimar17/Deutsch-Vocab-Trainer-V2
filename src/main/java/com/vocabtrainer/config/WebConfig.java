package com.vocabtrainer.config;

import java.util.List;

import com.vocabtrainer.security.CtxArgumentResolver;
import com.vocabtrainer.security.IdTokenCache;
import com.vocabtrainer.security.SessionInterceptor;
import com.vocabtrainer.security.TalkloopLinkInterceptor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private final AppProperties props;
    private final SessionInterceptor sessionInterceptor;
    private final TalkloopLinkInterceptor talkloopLinkInterceptor;
    private final IdTokenCache idTokens;

    public WebConfig(AppProperties props, SessionInterceptor sessionInterceptor, TalkloopLinkInterceptor talkloopLinkInterceptor,
                     IdTokenCache idTokens) {
        this.props = props;
        this.sessionInterceptor = sessionInterceptor;
        this.talkloopLinkInterceptor = talkloopLinkInterceptor;
        this.idTokens = idTokens;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(props.cors().allowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("Authorization", "Content-Type", "X-GitHub-Token", "X-Gemini-Key", "X-Time-Zone")
                .exposedHeaders(SessionInterceptor.RENEWED_TOKEN_HEADER)
                .maxAge(3600);
        // The Talkloop screen in ChatGPT runs in a sandbox with no origin of its own.
        registry.addMapping("/talkloop-screen/**").allowedOrigins("*").allowedMethods("GET");
    }

    /** Talkloop, the speaking practice, lives in static/talkloop: serve its page at /talkloop/. */
    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/talkloop", "/talkloop/");
        registry.addViewController("/talkloop/").setViewName("forward:/talkloop/index.html");
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CtxArgumentResolver(idTokens));
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Public: the vocabulary (same data as the repo), logging in, and creating
        // users (guarded by the admin key instead). Talkloop's calls (learnt words,
        // mistake log, topic chats, sentence deck) and ChatGPT's connection to Talkloop
        // (/mcp/{link}) need a Talkloop link instead. Everything else needs a session.
        registry.addInterceptor(sessionInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/vocab", "/api/auth/login", "/api/users", "/api/talkloop/words",
                        "/api/talkloop/mistakes", "/api/talkloop/spoken", "/api/talkloop/sentences", "/api/talkloop/cloudflare",
                        "/api/talkloop/chats", "/api/talkloop/chats/*");
        registry.addInterceptor(talkloopLinkInterceptor)
                .addPathPatterns("/api/talkloop/words", "/api/talkloop/mistakes", "/api/talkloop/spoken", "/api/talkloop/sentences",
                        "/api/talkloop/cloudflare", "/api/talkloop/chats", "/api/talkloop/chats/*", "/mcp/*");
    }
}
