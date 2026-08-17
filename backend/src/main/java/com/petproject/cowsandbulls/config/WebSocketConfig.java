package com.petproject.cowsandbulls.config;

import com.petproject.cowsandbulls.socket.DuelSocketHandler;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * Exposes the duel relay at /ws/duel.
 *
 * <p>Note this is outside /api/**, so the CorsConfig mapping does not cover it.
 * WebSockets are not subject to CORS at all - the browser sends an Origin
 * header and the server is expected to check it itself, which is what
 * setAllowedOrigins does. It reads the same property as the REST CORS list so
 * there is one place to add a deployed frontend URL.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final DuelSocketHandler duelSocketHandler;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    public WebSocketConfig(DuelSocketHandler duelSocketHandler) {
        this.duelSocketHandler = duelSocketHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Trimmed: an origin is matched by exact string, so "a.com, b.com"
        // written with the usual space after the comma would silently refuse
        // every connection from b.com.
        String[] origins = java.util.Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toArray(String[]::new);
        registry.addHandler(duelSocketHandler, "/ws/duel").setAllowedOrigins(origins);
    }
}
