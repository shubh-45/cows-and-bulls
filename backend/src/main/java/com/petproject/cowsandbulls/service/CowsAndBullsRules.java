package com.petproject.cowsandbulls.service;

import com.petproject.cowsandbulls.exception.InvalidGuessException;

import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;

/**
 * The code-breaking rules themselves, with no game or room around them.
 *
 * <p>Pulled out of {@link GameService} when the two-player mode arrived. Both
 * the solo game and a room need to make a secret and score a guess against it,
 * and two copies of "what counts as a cow" is exactly the kind of duplication
 * that drifts and then disagrees with itself - one player being told two cows
 * and the other three for the same guess would be unarguable and unfindable.
 *
 * <p>This is the one place in the codebase where the server holds game rules,
 * and it is deliberate: the whole game is that the client must NOT know the
 * answer. Everything else is refereed by the browser.
 */
public final class CowsAndBullsRules {

    /** Three distinct digits, never starting with zero. */
    public static final int LENGTH = 3;

    private static final SecureRandom RANDOM = new SecureRandom();

    private CowsAndBullsRules() {}

    public static String generateSecret() {
        List<Integer> digits = new ArrayList<>();
        for (int i = 0; i <= 9; i++) digits.add(i);

        int first = 1 + RANDOM.nextInt(9);          // 1-9, no leading zero
        digits.remove(Integer.valueOf(first));

        int second = digits.remove(RANDOM.nextInt(digits.size()));
        int third = digits.remove(RANDOM.nextInt(digits.size()));

        return "" + first + second + third;
    }

    /** @return {cows, bulls} - right digit wrong place, and right digit right place. */
    public static int[] score(String secret, String guess) {
        int bulls = 0;
        int cows = 0;
        for (int i = 0; i < LENGTH; i++) {
            char g = guess.charAt(i);
            if (g == secret.charAt(i)) {
                bulls++;
            } else if (secret.indexOf(g) >= 0) {
                cows++;
            }
        }
        return new int[]{cows, bulls};
    }

    public static boolean isSolved(int bulls) {
        return bulls == LENGTH;
    }

    /** The rules a guess must obey to be worth scoring at all. */
    public static void validate(String guess) {
        if (guess == null || guess.length() != LENGTH) {
            throw new InvalidGuessException("guess must be exactly " + LENGTH + " digits");
        }
        if (guess.charAt(0) == '0') {
            throw new InvalidGuessException("guess cannot start with 0");
        }
        if (guess.chars().distinct().count() != LENGTH) {
            throw new InvalidGuessException("guess cannot have repeated digits");
        }
    }
}
