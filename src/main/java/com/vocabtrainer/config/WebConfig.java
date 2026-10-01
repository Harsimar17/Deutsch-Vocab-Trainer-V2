package com.vocabtrainer.config;

import java.util.List;

import com.vocabtrainer.security.CtxArgumentResolver;
import com.vocabtrainer.security.FirebaseAuthInterceptor;
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
    private final FirebaseAuthInterceptor authInterceptor;

    public WebConfig(AppProperties props, FirebaseAuthInterceptor authInterceptor) {
        this.props = props;
        this.authInterceptor = authInterceptor;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOrigins(props.cors().allowedOrigins().toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("Authorization", "Content-Type", "X-GitHub-Token", "X-Gemini-Key", "X-Time-Zone")
                .maxAge(3600);
    }

    @Override
    public void addArgumentResolvers(List<HandlerMethodArgumentResolver> resolvers) {
        resolvers.add(new CtxArgumentResolver());
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        // Public: the vocabulary (same data as the repo) and getting a token in the
        // first place. Everything else needs the caller's Firebase ID token.
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**")
                .excludePathPatterns("/api/vocab", "/api/auth/**");
    }
}
