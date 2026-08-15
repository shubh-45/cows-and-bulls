package com.petproject.cowsandbulls.model;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A two-player room for friends-only online play.
 *
 * <p>A room outlives a single match. Players stay in it and play a series:
 * each finished match is scored, either side can offer a rematch, and the
 * board resets without anyone needing a fresh code.
 *
 * <p><b>The room stores moves, not a board.</b> Both clients replay the same
 * ordered move list through the same pure rules module, so they cannot drift
 * apart and the server does not need a copy of the rules. That keeps this
 * class game-agnostic: Reversi and Tic-Tac-Toe share it unchanged.
 *
 * <p><b>What the server enforces</b> is everything that needs no rules: who is
 * in the room, whose turn it is, that a square is on the board and has not
 * already been played. Rules that need board state - Reversi's "a move must
 * outflank", who actually won - stay on the client.
 *
 * <p><b>version</b> increments on every change so clients can poll cheaply and
 * ignore responses carrying nothing new.
 */
public class Room {

    public record Move(int index, String playerId, int seq) {}

    public enum Status { WAITING, PLAYING, FINISHED, ABANDONED }

    public static final String HOST = "host";
    public static final String GUEST = "guest";
    public static final String DRAW = "draw";

    /** How long since a player's last poll before we call them disconnected. */
    private static final Duration PRESENCE_TIMEOUT = Duration.ofSeconds(12);

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
    private volatile String currentPlayerId;
    private volatile String resultNote;

    // Both games give the player who moves first an advantage, so the start
    // alternates between matches - otherwise a five-match series is lopsided
    // before anyone touches the board. Clients derive their colour/mark from
    // this rather than from host/guest, so swapping the start swaps the sides.
    private volatile String startingRole = HOST;
    private volatile int matchNumber = 1;

    private volatile int hostWins = 0;
    private volatile int guestWins = 0;
    private volatile int draws = 0;
    /** Who won the match that just finished: HOST, GUEST or DRAW. */
    private volatile String lastWinnerRole;
    /** True when the last match ended because someone walked away. */
    private volatile boolean lastMatchForfeited;

    private final Set<String> rematchVotes = ConcurrentHashMap.newKeySet();

    // Presence rides on the existing poll: every state fetch stamps the
    // caller's clock, so an opponent who closes their tab goes quiet within a
    // few seconds without needing a heartbeat endpoint of its own.
    private volatile Instant hostSeenAt;
    private volatile Instant guestSeenAt;

    private volatile String abandonedByRole;

    public Room(String code, String gameType, int boardSize, String hostId, String hostName) {
        this.code = code;
        this.gameType = gameType;
        this.boardSize = boardSize;
        this.hostId = hostId;
        this.hostName = hostName;
        this.currentPlayerId = hostId;
        this.createdAt = Instant.now();
        this.lastActivityAt = this.createdAt;
        this.hostSeenAt = this.createdAt;
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
    public String getStartingRole() { return startingRole; }
    public int getMatchNumber() { return matchNumber; }
    public int getHostWins() { return hostWins; }
    public int getGuestWins() { return guestWins; }
    public int getDraws() { return draws; }
    public String getLastWinnerRole() { return lastWinnerRole; }
    public boolean isLastMatchForfeited() { return lastMatchForfeited; }
    public String getAbandonedByRole() { return abandonedByRole; }

    public List<Move> getMoves() { return List.copyOf(moves); }

    public boolean isFull() { return guestId != null; }

    public boolean hasPlayer(String playerId) {
        return hostId.equals(playerId) || (guestId != null && guestId.equals(playerId));
    }

    public String roleOf(String playerId) {
        if (hostId.equals(playerId)) return HOST;
        if (guestId != null && guestId.equals(playerId)) return GUEST;
        return null;
    }

    public String idOfRole(String role) {
        return HOST.equals(role) ? hostId : guestId;
    }

    public String opponentOf(String playerId) {
        if (hostId.equals(playerId)) return guestId;
        if (guestId != null && guestId.equals(playerId)) return hostId;
        return null;
    }

    public boolean isSquareTaken(int index) {
        return moves.stream().anyMatch(move -> move.index() == index);
    }

    public void touch() {
        this.lastActivityAt = Instant.now();
        this.version++;
    }

    /* ---- presence -------------------------------------------------------- */

    public void recordSeen(String playerId) {
        Instant now = Instant.now();
        if (hostId.equals(playerId)) hostSeenAt = now;
        else if (guestId != null && guestId.equals(playerId)) guestSeenAt = now;
        // Deliberately does not touch(): a poll is not a change, and bumping
        // the version on every poll would make every client re-render forever.
        this.lastActivityAt = now;
    }

    public boolean isRoleOnline(String role) {
        Instant seen = HOST.equals(role) ? hostSeenAt : guestSeenAt;
        if (seen == null) return false;
        return Duration.between(seen, Instant.now()).compareTo(PRESENCE_TIMEOUT) < 0;
    }

    /* ---- lifecycle ------------------------------------------------------- */

    public void join(String playerId, String playerName) {
        this.guestId = playerId;
        this.guestName = playerName;
        this.guestSeenAt = Instant.now();
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
     * because only the client knows the rules - Reversi skips a player with no
     * legal move, and the server does not implement the game.
     */
    public void setCurrentPlayerId(String playerId) {
        this.currentPlayerId = playerId;
    }

    /** Ends the current match and adds it to the series score. */
    public void finishMatch(String winnerRole, String note, boolean forfeited) {
        if (status == Status.FINISHED || status == Status.ABANDONED) return;

        if (HOST.equals(winnerRole)) hostWins++;
        else if (GUEST.equals(winnerRole)) guestWins++;
        else draws++;

        this.lastWinnerRole = winnerRole;
        this.lastMatchForfeited = forfeited;
        this.resultNote = note;
        this.status = Status.FINISHED;
        // A finished match invalidates any rematch offer made during it.
        this.rematchVotes.clear();
        touch();
    }

    /* ---- rematch --------------------------------------------------------- */

    /** @return true once both players have asked for a rematch. */
    public boolean voteRematch(String playerId) {
        rematchVotes.add(playerId);
        return isFull() && rematchVotes.contains(hostId) && rematchVotes.contains(guestId);
    }

    public boolean hasVotedRematch(String playerId) {
        return playerId != null && rematchVotes.contains(playerId);
    }

    /** Clears the board for the next match and swaps who starts. */
    public void startRematch() {
        moves.clear();
        rematchVotes.clear();
        matchNumber++;
        startingRole = HOST.equals(startingRole) ? GUEST : HOST;
        currentPlayerId = idOfRole(startingRole);
        status = Status.PLAYING;
        resultNote = null;
        lastWinnerRole = null;
        lastMatchForfeited = false;
        touch();
    }

    /**
     * A player leaving for good. If they walk out mid-match the opponent is
     * awarded that match first, so quitting a losing position cannot be used
     * to dodge the score.
     */
    public void abandon(String playerId) {
        String role = roleOf(playerId);
        if (role == null) return;

        if (status == Status.PLAYING && isFull()) {
            String winner = HOST.equals(role) ? GUEST : HOST;
            finishMatch(winner, "Opponent left the match.", true);
        }

        this.abandonedByRole = role;
        this.status = Status.ABANDONED;
        touch();
    }
}
