package com.petproject.cowsandbulls.controller;

import com.petproject.cowsandbulls.dto.CreateRoomRequest;
import com.petproject.cowsandbulls.dto.JoinRoomRequest;
import com.petproject.cowsandbulls.dto.RoomGuessRequest;
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
 * The turn-based games are well served by a poll every second or two, and it
 * avoids WebSocket lifecycle handling on an instance that sleeps. Snake is the
 * exception: a real-time duel cannot be polled, so it opens a socket to
 * {@code /ws/duel} for its input stream and uses these endpoints only to find
 * an opponent and record the result.
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
                        request.winnerRole(),
                        request.resultNote()),
                request.playerId());
    }

    // POST /api/rooms/{code}/rematch -> offer a rematch; the board resets once
    // both players have asked
    /**
     * One turn of a two-player Cows &amp; Bulls race.
     *
     * <p>Separate from /moves rather than folded into it: a move is an integer
     * square that both players replay, a guess is a code the server has to
     * score against a secret only it holds, and the response is different for
     * each caller. Sharing one endpoint would have meant one of them lying
     * about what it does.
     */
    @PostMapping("/{code}/guess")
    public RoomStateResponse guess(@PathVariable String code, @Valid @RequestBody RoomGuessRequest request) {
        return RoomStateResponse.of(
                roomService.applyGuess(code, request.playerId(), request.guess()),
                request.playerId());
    }

    @PostMapping("/{code}/rematch")
    public RoomStateResponse rematch(@PathVariable String code, @RequestParam String playerId) {
        return RoomStateResponse.of(roomService.requestRematch(code, playerId), playerId);
    }

    // POST /api/rooms/{code}/result -> report the outcome of a match played
    // peer-to-peer, so the series score stays correct
    @PostMapping("/{code}/result")
    public RoomStateResponse reportResult(
            @PathVariable String code,
            @RequestParam String playerId,
            @RequestParam String winnerRole,
            @RequestParam(required = false) String note) {
        return RoomStateResponse.of(roomService.reportResult(code, playerId, winnerRole, note), playerId);
    }

    // POST /api/rooms/{code}/leave -> leave for good; walking out mid-match
    // awards that match to the opponent
    @PostMapping("/{code}/leave")
    public RoomStateResponse leave(@PathVariable String code, @RequestParam String playerId) {
        return RoomStateResponse.of(roomService.leave(code, playerId), playerId);
    }
}
