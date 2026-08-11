package com.petproject.cowsandbulls.controller;

import com.petproject.cowsandbulls.dto.AttemptView;
import com.petproject.cowsandbulls.dto.GuessRequest;
import com.petproject.cowsandbulls.dto.GuessResponse;
import com.petproject.cowsandbulls.dto.NewGameResponse;
import com.petproject.cowsandbulls.service.GameService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/games")
public class GameController {

    private final GameService gameService;

    public GameController(GameService gameService) {
        this.gameService = gameService;
    }

    // POST /api/games  -> start a new game
    @PostMapping
    public NewGameResponse newGame() {
        return gameService.startNewGame();
    }

    // POST /api/games/{gameId}/guesses  -> submit a guess
    @PostMapping("/{gameId}/guesses")
    public GuessResponse guess(@PathVariable String gameId, @Valid @RequestBody GuessRequest request) {
        return gameService.submitGuess(gameId, request.guess());
    }

    // GET /api/games/{gameId}/history -> useful if the frontend ever needs to re-sync
    @GetMapping("/{gameId}/history")
    public List<AttemptView> history(@PathVariable String gameId) {
        return gameService.getHistory(gameId);
    }
}
