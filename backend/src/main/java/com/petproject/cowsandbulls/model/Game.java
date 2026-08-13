package com.petproject.cowsandbulls.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * A single in-progress (or finished) game.
 * Kept in memory only - fine for a pet project, but it does mean every
 * game is lost if the server restarts. See README for how you'd swap this
 * for a real database later.
 */
public class Game {

    public record Attempt(int attemptNumber, String guess, int cows, int bulls) {}

    private final String id;
    private final String secret;
    private final Instant createdAt;
    // Eviction is based on last activity rather than creation time, so a
    // player thinking hard about a long game never has it swept out from
    // under them mid-guess.
    private volatile Instant lastActivityAt;
    private final List<Attempt> attempts = new ArrayList<>();
    private boolean solved = false;

    public Game(String id, String secret) {
        this.id = id;
        this.secret = secret;
        this.createdAt = Instant.now();
        this.lastActivityAt = this.createdAt;
    }

    public String getId() {
        return id;
    }

    public String getSecret() {
        return secret;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastActivityAt() {
        return lastActivityAt;
    }

    public void touch() {
        this.lastActivityAt = Instant.now();
    }

    public List<Attempt> getAttempts() {
        return attempts;
    }

    public boolean isSolved() {
        return solved;
    }

    public void markSolved() {
        this.solved = true;
    }

    public Attempt recordAttempt(String guess, int cows, int bulls) {
        Attempt attempt = new Attempt(attempts.size() + 1, guess, cows, bulls);
        attempts.add(attempt);
        touch();
        return attempt;
    }
}
