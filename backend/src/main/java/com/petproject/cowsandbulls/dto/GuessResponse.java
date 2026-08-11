package com.petproject.cowsandbulls.dto;

import java.util.List;

public record GuessResponse(
        String gameId,
        String guess,
        int cows,
        int bulls,
        int attemptCount,
        boolean won,
        String rewardTier,          // null until won - e.g. "GOLD"
        String secretNumber,        // null until won - only revealed on win
        List<AttemptView> history
) {}
