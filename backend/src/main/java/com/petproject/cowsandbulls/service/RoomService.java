package com.petproject.cowsandbulls.service;

import com.petproject.cowsandbulls.exception.InvalidRoomActionException;
import com.petproject.cowsandbulls.exception.RoomNotFoundException;
import com.petproject.cowsandbulls.model.Room;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class RoomService {

    private static final Logger log = LoggerFactory.getLogger(RoomService.class);

    /**
     * Ambiguous characters are left out on purpose: no O/0, no I/1/L. Codes
     * get read aloud and retyped by hand, and "was that an oh or a zero" is
     * the most common way a join fails.
     */
    private static final String CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private static final int CODE_LENGTH = 4;
    private static final int MAX_CODE_ATTEMPTS = 40;

    /**
     * Board sizes the room API knows about, keyed by game type.
     *
     * <p>Snake is here only so a room can be created and the two browsers can
     * find each other. It never uses the move endpoints: once the peers are
     * connected the whole game runs between them, and the server hears nothing
     * until the result is reported.
     */
    private static final Map<String, Integer> BOARD_SIZES = Map.of(
            "reversi", 8,
            "tic-tac-toe", 3,
            "snake", 15
    );

    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();

    // Rooms are short-lived by nature; a much shorter TTL than games keeps
    // abandoned lobbies from accumulating on a small free instance.
    @Value("${app.room.ttl-minutes:90}")
    private long ttlMinutes;

    public Room createRoom(String gameType, String playerId, String playerName) {
        Integer boardSize = BOARD_SIZES.get(gameType);
        if (boardSize == null) {
            throw new InvalidRoomActionException(
                    "Unsupported game type: " + gameType + ". Supported: " + BOARD_SIZES.keySet());
        }

        Room room = insertWithUniqueCode(gameType, boardSize, playerId, safeName(playerName, "Host"));
        log.info("Room {} created for {} by {}", room.getCode(), gameType, room.getHostName());
        return room;
    }

    public Room join(String code, String playerId, String playerName) {
        Room room = require(code);

        // Rejoining your own room is normal - a refresh, or opening the link
        // on a second tab - so it must not be treated as a third player.
        if (room.hasPlayer(playerId)) {
            return room;
        }
        if (room.isFull()) {
            throw new InvalidRoomActionException("That room already has two players.");
        }

        room.join(playerId, safeName(playerName, "Guest"));
        log.info("Room {}: {} joined", code, room.getGuestName());
        return room;
    }

    public Room get(String code, String playerId) {
        Room room = require(code);
        if (playerId != null && !room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        // Presence rides on the poll clients already make, so an opponent who
        // closes their tab is detected without a heartbeat endpoint.
        if (playerId != null) room.recordSeen(playerId);
        return room;
    }

    /**
     * Applies a move after checking everything that can be checked without
     * knowing the game's rules: the room is playable, the caller is in it, it
     * is their turn, the square exists and is free.
     */
    public Room applyMove(String code, String playerId, int index, String nextPlayerId,
                          boolean gameOver, String winnerRole, String resultNote) {
        Room room = require(code);

        if (!room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        if (room.getStatus() == Room.Status.WAITING) {
            throw new InvalidRoomActionException("Waiting for another player to join.");
        }
        if (room.getStatus() == Room.Status.FINISHED) {
            throw new InvalidRoomActionException("This match has already finished.");
        }
        if (room.getStatus() == Room.Status.ABANDONED) {
            throw new InvalidRoomActionException("Your opponent has left the room.");
        }
        if (!playerId.equals(room.getCurrentPlayerId())) {
            throw new InvalidRoomActionException("It is not your turn.");
        }

        int cells = room.getBoardSize() * room.getBoardSize();
        if (index < 0 || index >= cells) {
            throw new InvalidRoomActionException("That square is not on the board.");
        }
        // Sound for both supported games: a Reversi disc never leaves the
        // board once placed, and a Tic-Tac-Toe mark never moves.
        if (room.isSquareTaken(index)) {
            throw new InvalidRoomActionException("That square has already been played.");
        }

        // A move is the strongest possible proof someone is still there, so it
        // counts towards presence as well as the poll does. Without this a
        // player who is actively moving can flicker "offline" to their
        // opponent whenever a poll is slow.
        room.recordSeen(playerId);
        room.addMove(index, playerId);

        // Trust the client only for the parts that need the rules, and only
        // ever to name a player who is actually in this room.
        String next = nextPlayerId != null && room.hasPlayer(nextPlayerId)
                ? nextPlayerId
                : room.opponentOf(playerId);
        room.setCurrentPlayerId(next);

        if (gameOver) {
            // Only the client knows the rules, so it reports who won - but the
            // value is normalised here so a bad one cannot corrupt the score.
            room.finishMatch(normalizeWinner(winnerRole), resultNote, false);
        }
        return room;
    }

    /** Anything that is not a recognised role is scored as a draw. */
    private String normalizeWinner(String winnerRole) {
        if (Room.HOST.equals(winnerRole) || Room.GUEST.equals(winnerRole)) return winnerRole;
        return Room.DRAW;
    }

    /**
     * Offers a rematch. The board only resets once BOTH players have asked,
     * so nobody has the position wiped from under them while they are still
     * looking at how they lost.
     */
    public Room requestRematch(String code, String playerId) {
        Room room = require(code);
        if (!room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        if (room.getStatus() == Room.Status.ABANDONED) {
            throw new InvalidRoomActionException("Your opponent has left the room.");
        }
        if (room.getStatus() != Room.Status.FINISHED) {
            throw new InvalidRoomActionException("Finish the current match first.");
        }
        if (!room.isFull()) {
            throw new InvalidRoomActionException("Waiting for another player to join.");
        }

        room.recordSeen(playerId);
        if (room.voteRematch(playerId)) {
            room.startRematch();
            log.info("Room {}: rematch accepted, starting match {}", room.getCode(), room.getMatchNumber());
        } else {
            room.touch();
        }
        return room;
    }

    /**
     * Leaving the room for good. Walking out of a match in progress awards it
     * to the opponent, so quitting a losing position does not dodge the score.
     */
    public Room leave(String code, String playerId) {
        Room room = require(code);
        if (!room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        room.abandon(playerId);
        log.info("Room {}: {} left", code, room.getAbandonedByRole());
        return room;
    }

    /**
     * Ends a match that was played outside the move endpoints.
     *
     * <p>Snake runs peer to peer, so the server never sees the moves - it is
     * simply told the outcome so the series score stays correct. Safe for both
     * players to call: finishMatch ignores a match that is already over, so a
     * result cannot be counted twice.
     */
    public Room reportResult(String code, String playerId, String winnerRole, String note) {
        Room room = require(code);
        if (!room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        room.recordSeen(playerId);
        room.finishMatch(normalizeWinner(winnerRole), note, false);
        return room;
    }

    /**
     * Relays one WebRTC handshake message. The server never inspects the
     * payload - it is the browser's own SDP or ICE JSON. This is the only part
     * of a Snake duel the backend touches; once the peers connect directly it
     * sees nothing until the result is reported.
     */
    public Room postSignal(String code, String playerId, String kind, String payload) {
        Room room = require(code);
        String role = room.roleOf(playerId);
        if (role == null) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        room.recordSeen(playerId);
        try {
            room.addSignal(role, kind, payload);
        } catch (IllegalStateException ex) {
            throw new InvalidRoomActionException(ex.getMessage());
        }
        return room;
    }

    public java.util.List<Room.Signal> readSignals(String code, String playerId, int since) {
        Room room = require(code);
        String role = room.roleOf(playerId);
        if (role == null) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        room.recordSeen(playerId);
        return room.signalsFor(role, since);
    }

    @Scheduled(fixedDelayString = "${app.room.cleanup-interval-ms:300000}")
    public void evictIdleRooms() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(ttlMinutes));
        int before = rooms.size();
        rooms.values().removeIf(room -> room.getLastActivityAt().isBefore(cutoff));
        int removed = before - rooms.size();
        if (removed > 0) {
            log.info("Evicted {} idle room(s); {} still active", removed, rooms.size());
        }
    }

    public int activeRoomCount() {
        return rooms.size();
    }

    public Set<String> supportedGameTypes() {
        return BOARD_SIZES.keySet();
    }

    private Room require(String code) {
        Room room = rooms.get(normalize(code));
        if (room == null) {
            throw new RoomNotFoundException(code);
        }
        return room;
    }

    /** Codes are typed by humans, so accept any case and stray whitespace. */
    private String normalize(String code) {
        return code == null ? "" : code.trim().toUpperCase();
    }

    /**
     * Claims a free code and inserts the room in one atomic step.
     *
     * <p>Generating a code, checking it is free, and inserting afterwards
     * would leave a gap in which a second request could claim the same code
     * and silently overwrite the first room. putIfAbsent closes that gap: it
     * only succeeds if the code was genuinely unclaimed, so a collision just
     * costs another spin of the loop.
     */
    private Room insertWithUniqueCode(String gameType, int boardSize, String hostId, String hostName) {
        for (int attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
            StringBuilder builder = new StringBuilder(CODE_LENGTH);
            for (int i = 0; i < CODE_LENGTH; i++) {
                builder.append(CODE_ALPHABET.charAt(random.nextInt(CODE_ALPHABET.length())));
            }
            String candidate = builder.toString();
            Room room = new Room(candidate, gameType, boardSize, hostId, hostName);
            if (rooms.putIfAbsent(candidate, room) == null) {
                return room;
            }
        }
        throw new InvalidRoomActionException("Could not allocate a room code. Please try again.");
    }

    private String safeName(String name, String fallback) {
        if (name == null || name.isBlank()) return fallback;
        return name.trim().length() > 16 ? name.trim().substring(0, 16) : name.trim();
    }
}
