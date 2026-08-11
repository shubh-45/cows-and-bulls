package com.petproject.cowsandbulls.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/**
 * Loose format validation happens here (annotations).
 * The "must be 3 distinct digits, no leading zero, not repeated" business
 * rule is checked in GameService so we can return a precise error message.
 */
public record GuessRequest(
        @NotBlank(message = "guess is required")
        @Pattern(regexp = "\\d{3}", message = "guess must be exactly 3 digits")
        String guess
) {}
