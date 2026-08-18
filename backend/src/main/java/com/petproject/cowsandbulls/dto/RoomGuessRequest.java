package com.petproject.cowsandbulls.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

/** One turn in a two-player Cows &amp; Bulls room. */
public record RoomGuessRequest(
        @NotBlank(message = "playerId is required")
        String playerId,

        @Pattern(regexp = "\\d{3}", message = "guess must be exactly 3 digits")
        String guess
) {}
