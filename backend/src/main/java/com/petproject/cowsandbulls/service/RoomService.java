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

    /** Board sizes the room API knows about, keyed by game type. */
    private static final Map<String, Integer> BOARD_SIZES = Map.of(
            "reversi", 8,
            "tic-tac-toe", 3
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
        return room;
    }

    /**
     * Applies a move after checking everything that can be checked without
     * knowing the game's rules: the room is playable, the caller is in it, it
     * is their turn, the square exists and is free.
     */
    public Room applyMove(String code, String playerId, int index, String nextPlayerId,
                          boolean gameOver, String resultNote) {
        Room room = require(code);

        if (!room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        if (room.getStatus() == Room.Status.WAITING) {
            throw new InvalidRoomActionException("Waiting for another player to join.");
        }
        if (room.getStatus() == Room.Status.FINISHED) {
            throw new InvalidRoomActionException("This game has already finished.");
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

        room.addMove(index, playerId);

        // Trust the client only for the parts that need the rules, and only
        // ever to name a player who is actually in this room.
        String next = nextPlayerId != null && room.hasPlayer(nextPlayerId)
                ? nextPlayerId
                : room.opponentOf(playerId);
        room.setCurrentPlayerId(next);

        if (gameOver) {
            room.finish(resultNote);
        }
        return room;
    }

    public Room forfeit(String code, String playerId) {
        Room room = require(code);
        if (!room.hasPlayer(playerId)) {
            throw new InvalidRoomActionException("You are not a player in this room.");
        }
        if (room.getStatus() != Room.Status.FINISHED) {
            room.finish("A player left the game.");
        }
        return room;
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
