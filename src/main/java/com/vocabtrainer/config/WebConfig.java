package com.vocabtrainer.config;

import java.util.List;

import com.vocabtrainer.security.CtxArgumentResolver;
import com.vocabtrainer.security.IdTokenCache;
import com.vocabtrainer.security.SessionInterceptor;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.method.support.HandlerMethodArgumentResolver;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

@Configuration
@EnableConfigurationProperties(AppProperties.class)
public class WebConfig implements WebMvcConfigurer {

    private final AppProperties props;
    private final SessionInterceptor sessionInterceptor;
    private final IdTokenCache idTokens;

    public WebConfig(AppProperties props, SessionInterceptor sessionInterceptor, IdTokenCache idTokens) {
        this.props = props;
        this.sessionInterceptor = sessionInterceptor;
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
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CtxArgumentResolver(idTokens));
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Public: the vocabulary (same data as the repo), logging in, and creating
        // users (guarded by the admin key instead). Everything else needs a session.
        registry.addInterceptor(sessionInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/vocab", "/api/auth/login", "/api/users");
    }
}
