package com.petproject.cowsandbulls.model;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

/**
 * A two-player room for friends-only online play.
 *
 * <p>Design notes worth knowing before changing this:
 *
 * <p><b>The room stores moves, not a board.</b> Both clients replay the same
 * ordered move list through the same pure rules module, so they cannot drift
 * apart, and the server does not need a copy of every game's rules to stay
 * useful. That keeps this class game-agnostic: Reversi and Tic-Tac-Toe share
 * it unchanged.
 *
 * <p><b>What the server does enforce</b> is everything that does not need the
 * rules: who is in the room, whose turn it is, that a square is on the board,
 * and that it has not already been played. That last check is sound for both
 * games because in Reversi a placed disc never leaves the board and in
 * Tic-Tac-Toe a mark never moves. Rules that need full board state - Reversi's
 * "a move must outflank" - stay on the client. A player could bypass those
 * with a hand-crafted request, which is an acceptable trade for a mode you
 * only enter by sharing a code with a friend.
 *
 * <p><b>version</b> increments on every change so clients can poll cheaply and
 * ignore responses that carry nothing new.
 */
public class Room {

    public record Move(int index, String playerId, int seq) {}

    public enum Status { WAITING, PLAYING, FINISHED }

    private final String code;
    private final String gameType;
    private final int boardSize;
    private final Instant createdAt;
    private volatile Instant lastActivityAt;

    private final String hostId;
    private final String hostName;
    private volatile String guestId;
    private volatile String guestName;

    private final List<Move> moves = new ArrayList<>();
    private volatile Status status = Status.WAITING;
    private volatile int version = 1;
    // Host always moves first; whoever is "current" flips as moves land.
    private volatile String currentPlayerId;
    // Set when a client reports the game over, or when someone forfeits.
    private volatile String resultNote;

    public Room(String code, String gameType, int boardSize, String hostId, String hostName) {
        this.code = code;
        this.gameType = gameType;
        this.boardSize = boardSize;
        this.hostId = hostId;
        this.hostName = hostName;
        this.currentPlayerId = hostId;
        this.createdAt = Instant.now();
        this.lastActivityAt = this.createdAt;
    }

    public String getCode() { return code; }
    public String getGameType() { return gameType; }
    public int getBoardSize() { return boardSize; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getLastActivityAt() { return lastActivityAt; }
    public String getHostId() { return hostId; }
    public String getHostName() { return hostName; }
    public String getGuestId() { return guestId; }
    public String getGuestName() { return guestName; }
    public Status getStatus() { return status; }
    public int getVersion() { return version; }
    public String getCurrentPlayerId() { return currentPlayerId; }
    public String getResultNote() { return resultNote; }

    public List<Move> getMoves() { return List.copyOf(moves); }

    public boolean isFull() { return guestId != null; }

    public boolean hasPlayer(String playerId) {
        return hostId.equals(playerId) || (guestId != null && guestId.equals(playerId));
    }

    public boolean isSquareTaken(int index) {
        return moves.stream().anyMatch(move -> move.index() == index);
    }

    public void touch() {
        this.lastActivityAt = Instant.now();
        this.version++;
    }

    public void join(String playerId, String playerName) {
        this.guestId = playerId;
        this.guestName = playerName;
        this.status = Status.PLAYING;
        touch();
    }

    public Move addMove(int index, String playerId) {
        Move move = new Move(index, playerId, moves.size() + 1);
        moves.add(move);
        touch();
        return move;
    }

    /**
     * Whose turn it is next. Passed in by the client rather than derived,
     * because only the client knows the rules - Reversi skips a player who
     * has no legal move, and the server has no way to work that out without
     * implementing the game.
     */
    public void setCurrentPlayerId(String playerId) {
        this.currentPlayerId = playerId;
    }

    public void finish(String note) {
        this.status = Status.FINISHED;
        this.resultNote = note;
        touch();
    }

    public String opponentOf(String playerId) {
        if (hostId.equals(playerId)) return guestId;
        if (guestId != null && guestId.equals(playerId)) return hostId;
        return null;
    }
}
