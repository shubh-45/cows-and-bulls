package com.petproject.cowsandbulls.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
public class HealthController {

    @GetMapping("/")
    public String health() {
        return "Cows and Bulls API is running";
    }

    /**
     * Same check, but under /api/** so it is covered by the CORS mapping.
     *
     * <p>The frontend pings this when the multiplayer lobby opens, to start
     * the free instance waking while the player is still reading the screen.
     * Pinging "/" would also wake it - a browser sends a simple GET before it
     * blocks the response - but the blocked read logs a CORS error that looks
     * like a real fault. This endpoint keeps that console clean.
     */
    @GetMapping("/api/health")
    public Map<String, String> apiHealth() {
        return Map.of("status", "ok");
    }
}
