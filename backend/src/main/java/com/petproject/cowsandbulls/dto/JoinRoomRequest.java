package com.petproject.cowsandbulls.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record JoinRoomRequest(
        @NotBlank(message = "playerId is required") String playerId,
        @Size(max = 16, message = "Name must be 16 characters or fewer") String playerName
) {}
