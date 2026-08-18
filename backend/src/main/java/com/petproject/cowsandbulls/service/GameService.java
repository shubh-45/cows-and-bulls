package com.petproject.cowsandbulls.service;

import com.petproject.cowsandbulls.dto.AttemptView;
import com.petproject.cowsandbulls.dto.GuessResponse;
import com.petproject.cowsandbulls.dto.NewGameResponse;
import com.petproject.cowsandbulls.exception.GameNotFoundException;
import com.petproject.cowsandbulls.exception.InvalidGuessException;
import com.petproject.cowsandbulls.model.Game;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class GameService {

    private static final Logger log = LoggerFactory.getLogger(GameService.class);

    private final Map<String, Game> games = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    // This map used to grow without limit: every POST /api/games added an
    // entry that was never removed. The 15-minute free-tier spin-down hid it
    // by wiping memory, but under steady traffic the instance would climb
    // until it was killed. app.game.ttl-minutes existed in the config all
    // along and was simply never read - now it is.
    @Value("${app.game.ttl-minutes:60}")
    private long ttlMinutes;

    // ---- Reward tiers -----------------------------------------------------
    // Tune these however you like - they're the whole "reward system" the
    // frontend shows once a game is won. See README for ideas on extending this
    // (streaks, timers, difficulty levels, a leaderboard, etc).
    private static final int GOLD_MAX_ATTEMPTS = 5;
    private static final int SILVER_MAX_ATTEMPTS = 8;
    private static final int BRONZE_MAX_ATTEMPTS = 12;

    public NewGameResponse startNewGame() {
        String secret = generateSecret();
        String id = UUID.randomUUID().toString();
        games.put(id, new Game(id, secret));
        return new NewGameResponse(id, "New game started. Guess a 3-digit number with no repeated digits.");
    }

    public GuessResponse submitGuess(String gameId, String guess) {
        Game game = games.get(gameId);
        if (game == null) {
            throw new GameNotFoundException(gameId);
        }
        if (game.isSolved()) {
            throw new InvalidGuessException("This game is already finished - start a new one.");
        }
        validateGuessRules(guess);

        int[] result = countCowsAndBulls(game.getSecret(), guess);
        int cows = result[0];
        int bulls = result[1];

        Game.Attempt attempt = game.recordAttempt(guess, cows, bulls);
        boolean won = CowsAndBullsRules.isSolved(bulls);

        String rewardTier = null;
        String secretNumber = null;
        if (won) {
            game.markSolved();
            rewardTier = rewardTierFor(attempt.attemptNumber());
            secretNumber = game.getSecret();
        }

        List<AttemptView> history = toHistory(game);

        return new GuessResponse(
                gameId,
                guess,
                cows,
                bulls,
                attempt.attemptNumber(),
                won,
                rewardTier,
                secretNumber,
                history
        );
    }

    /**
     * Evicts games that have seen no activity for longer than the configured
     * TTL. Runs every five minutes; removeIf on a ConcurrentHashMap is safe
     * to run while requests are being served.
     */
    @Scheduled(fixedDelayString = "${app.game.cleanup-interval-ms:300000}")
    public void evictIdleGames() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(ttlMinutes));
        int before = games.size();
        games.values().removeIf(game -> game.getLastActivityAt().isBefore(cutoff));
        int removed = before - games.size();
        if (removed > 0) {
            log.info("Evicted {} idle game(s); {} still active", removed, games.size());
        }
    }

    /** Exposed for the health endpoint and for tests to assert on. */
    public int activeGameCount() {
        return games.size();
    }

    public List<AttemptView> getHistory(String gameId) {
        Game game = games.get(gameId);
        if (game == null) {
            throw new GameNotFoundException(gameId);
        }
        return toHistory(game);
    }

    // ---- Internals ----------------------------------------------------------

    /**
     * Generates a 3-digit number with all distinct digits and no leading zero,
     * i.e. uniformly at random from the ~648 valid numbers (102-987 range,
     * skipping anything with a repeated digit).
     */
    private String generateSecret() {
        return CowsAndBullsRules.generateSecret();
    }

    private void validateGuessRules(String guess) {
        CowsAndBullsRules.validate(guess);
    }

    /** returns {cows, bulls} */
    private int[] countCowsAndBulls(String secret, String guess) {
        return CowsAndBullsRules.score(secret, guess);
    }

    private String rewardTierFor(int attempts) {
        if (attempts <= GOLD_MAX_ATTEMPTS) return "GOLD";
        if (attempts <= SILVER_MAX_ATTEMPTS) return "SILVER";
        if (attempts <= BRONZE_MAX_ATTEMPTS) return "BRONZE";
        return "PARTICIPANT";
    }

    private List<AttemptView> toHistory(Game game) {
        List<AttemptView> views = new ArrayList<>();
        for (Game.Attempt a : game.getAttempts()) {
            views.add(new AttemptView(a.attemptNumber(), a.guess(), a.cows(), a.bulls()));
        }
        return views;
    }
}
