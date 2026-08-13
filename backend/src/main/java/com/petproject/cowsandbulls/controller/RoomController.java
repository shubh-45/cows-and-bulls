package com.petproject.cowsandbulls.controller;

import com.petproject.cowsandbulls.dto.CreateRoomRequest;
import com.petproject.cowsandbulls.dto.JoinRoomRequest;
import com.petproject.cowsandbulls.dto.RoomMoveRequest;
import com.petproject.cowsandbulls.dto.RoomStateResponse;
import com.petproject.cowsandbulls.service.RoomService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.*;

/**
 * Friends-only online play. There is no matchmaking on purpose: you get in by
 * being told a four-character code, which is what makes the feature work at
 * zero traffic when a lobby of strangers never would.
 *
 * <p>Clients poll GET /api/rooms/{code} rather than holding a socket open.
 * Both supported games are turn-based, so a poll every second or two is
 * indistinguishable from realtime, and it avoids WebSocket lifecycle handling
 * on an instance that sleeps.
 */
@RestController
@RequestMapping("/api/rooms")
public class RoomController {

    private final RoomService roomService;

    public RoomController(RoomService roomService) {
        this.roomService = roomService;
    }

    // POST /api/rooms -> create a room, returns its code
    @PostMapping
    public RoomStateResponse create(@Valid @RequestBody CreateRoomRequest request) {
        return RoomStateResponse.of(
                roomService.createRoom(request.gameType(), request.playerId(), request.playerName()),
                request.playerId());
    }

    // POST /api/rooms/{code}/join -> second player joins
    @PostMapping("/{code}/join")
    public RoomStateResponse join(@PathVariable String code, @Valid @RequestBody JoinRoomRequest request) {
        return RoomStateResponse.of(
                roomService.join(code, request.playerId(), request.playerName()),
                request.playerId());
    }

    // GET /api/rooms/{code}?playerId=... -> poll for the current state
    @GetMapping("/{code}")
    public RoomStateResponse state(@PathVariable String code, @RequestParam String playerId) {
        return RoomStateResponse.of(roomService.get(code, playerId), playerId);
    }

    // POST /api/rooms/{code}/moves -> play a square
    @PostMapping("/{code}/moves")
    public RoomStateResponse move(@PathVariable String code, @Valid @RequestBody RoomMoveRequest request) {
        return RoomStateResponse.of(
                roomService.applyMove(
                        code,
                        request.playerId(),
                        request.index(),
                        request.nextPlayerId(),
                        request.gameOver(),
                        request.resultNote()),
                request.playerId());
    }

    // POST /api/rooms/{code}/forfeit -> leave, ending the game for both sides
    @PostMapping("/{code}/forfeit")
    public RoomStateResponse forfeit(@PathVariable String code, @RequestParam String playerId) {
        return RoomStateResponse.of(roomService.forfeit(code, playerId), playerId);
    }
}
