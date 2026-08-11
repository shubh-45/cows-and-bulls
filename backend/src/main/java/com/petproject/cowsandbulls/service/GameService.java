package com.petproject.cowsandbulls.service;

import com.petproject.cowsandbulls.dto.AttemptView;
import com.petproject.cowsandbulls.dto.GuessResponse;
import com.petproject.cowsandbulls.dto.NewGameResponse;
import com.petproject.cowsandbulls.exception.GameNotFoundException;
import com.petproject.cowsandbulls.exception.InvalidGuessException;
import com.petproject.cowsandbulls.model.Game;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class GameService {

    private final Map<String, Game> games = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

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
        boolean won = bulls == 3;

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
        List<Integer> digits = new ArrayList<>();
        for (int i = 0; i <= 9; i++) digits.add(i);

        int first = 1 + random.nextInt(9);          // 1-9, no leading zero
        digits.remove(Integer.valueOf(first));

        int secondIndex = random.nextInt(digits.size());
        int second = digits.remove(secondIndex);

        int thirdIndex = random.nextInt(digits.size());
        int third = digits.remove(thirdIndex);

        return "" + first + second + third;
    }

    private void validateGuessRules(String guess) {
        if (guess.charAt(0) == '0') {
            throw new InvalidGuessException("guess cannot start with 0");
        }
        if (guess.chars().distinct().count() != 3) {
            throw new InvalidGuessException("guess cannot have repeated digits");
        }
    }

    /** returns {cows, bulls} */
    private int[] countCowsAndBulls(String secret, String guess) {
        int bulls = 0;
        int cows = 0;
        for (int i = 0; i < 3; i++) {
            char g = guess.charAt(i);
            if (g == secret.charAt(i)) {
                bulls++;
            } else if (secret.indexOf(g) >= 0) {
                cows++;
            }
        }
        return new int[]{cows, bulls};
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
