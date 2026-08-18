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
    public static final String COWS_AND_BULLS = "cows-and-bulls";

    private static final Map<String, Integer> BOARD_SIZES = Map.of(
            "reversi", 8,
            "tic-tac-toe", 3,
            "snake", 15,
            "tanks", 15,
            // No board at all - the entry exists so the room type is accepted,
            // and boardSize is never read for it.
            COWS_AND_BULLS, 0
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
        if (COWS_AND_BULLS.equals(gameType)) room.setSecret(CowsAndBullsRules.generateSecret());
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
    /**
     * One turn of a two-player Cows &amp; Bulls race.
     *
     * <p>Both players hunt the SAME code and take alternate turns, but neither
     * sees the other's guesses - so unlike every other room here, the server
     * cannot just record the move and let the clients work it out. It holds the
     * secret, so it has to do the scoring too.
     *
     * <p>The match does not end the instant someone cracks it. Turns alternate,
     * so at the moment the starter solves it the other player has had one turn
     * fewer, and stopping there would award the match for moving first. The
     * trailing player is allowed to finish the round; matching the winner on
     * the same number of turns is a draw.
     */
    public Room applyGuess(String code, String playerId, String guess) {
        Room room = require(code);

        if (!COWS_AND_BULLS.equals(room.getGameType())) {
            throw new InvalidRoomActionException("This room is not a Cows & Bulls room.");
        }
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

        CowsAndBullsRules.validate(guess);

        int[] result = CowsAndBullsRules.score(room.getSecret(), guess);
        int cows = result[0];
        int bulls = result[1];

        String role = room.roleOf(playerId);
        room.recordSeen(playerId);
        room.addGuess(playerId, guess, cows, bulls);

        // Hand the turn over first; whether the match then ends is a separate
        // question from whose go it is.
        room.setCurrentPlayerId(room.opponentOf(playerId));

        String solvedBy = room.getSolvedByRole();
        if (solvedBy != null && room.turnsAreEven()) {
            // Even turns and at least one solve: the round is complete and can
            // be judged. Both on the same turn count means both cracked it.
            boolean bothSolved = room.guessesOfRole(Room.HOST).stream().anyMatch(g -> g.bulls() == 3)
                    && room.guessesOfRole(Room.GUEST).stream().anyMatch(g -> g.bulls() == 3);
            if (bothSolved) {
                room.finishMatch(Room.DRAW, "Both cracked " + room.getSecret() + " in the same number of turns.", false);
            } else {
                room.finishMatch(solvedBy, "Code was " + room.getSecret() + ".", false);
            }
        }

        log.info("Room {}: {} guessed {} -> {} cows {} bulls", code, role, guess, cows, bulls);
        return room;
    }

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
            // startRematch clears the old secret; a fresh code for a fresh match.
            if (COWS_AND_BULLS.equals(room.getGameType())) {
                room.setSecret(CowsAndBullsRules.generateSecret());
            }
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
     * Which seat a player holds, or null if the room or the player is unknown.
     *
     * <p>Unlike the rest of this class this reports failure by returning null
     * rather than throwing: the caller is the duel WebSocket, which answers a
     * rejected connection with a close frame, not an HTTP error.
     */
    public String roleIn(String code, String playerId) {
        Room room = rooms.get(normalize(code));
        if (room == null) return null;
        String role = room.roleOf(playerId);
        // Holding the socket open is proof of presence just as polling is, so a
        // player mid-duel cannot flicker "offline" to their opponent.
        if (role != null) room.recordSeen(playerId);
        return role;
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
