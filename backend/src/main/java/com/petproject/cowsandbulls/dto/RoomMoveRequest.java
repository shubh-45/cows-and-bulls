package com.petproject.cowsandbulls.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * `index` is a flattened board position (row * boardSize + col), which keeps
 * this DTO the same shape for a 3x3 grid and an 8x8 one.
 *
 * `nextPlayerId`, `gameOver` and `winnerRole` are supplied by the client
 * because only the client knows the rules - Reversi skips a player with no
 * legal move, and the server does not implement either game. The server
 * normalises `winnerRole` before scoring it, so a bad value cannot corrupt
 * the series.
 */
public record RoomMoveRequest(
        @NotBlank(message = "playerId is required") String playerId,
        @Min(value = 0, message = "index must be on the board") int index,
        String nextPlayerId,
        boolean gameOver,
        /** "host", "guest" or "draw". */
        String winnerRole,
        String resultNote
) {}
