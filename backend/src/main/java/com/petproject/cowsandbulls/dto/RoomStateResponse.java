package com.petproject.cowsandbulls.dto;

import com.petproject.cowsandbulls.model.Room;

import java.util.List;

/**
 * The whole room as one caller needs to see it. Clients poll for this and
 * rebuild the board by replaying `moves` through their own rules module.
 *
 * <p>Everything is resolved from the caller's point of view - `yourRole`,
 * `yourWins`, `youStart`, `opponentOnline` - so the frontend never has to
 * compare ids to work out which side of the board it is on.
 */
public record RoomStateResponse(
        String code,
        String gameType,
        int boardSize,
        String status,
        int version,

        String hostName,
        String guestName,
        String yourRole,
        String opponentName,
        boolean opponentPresent,
        boolean opponentOnline,

        boolean yourTurn,
        List<MoveView> moves,
        String resultNote,

        // series
        int matchNumber,
        String startingRole,
        boolean youStart,
        int yourWins,
        int theirWins,
        int draws,
        /** "you", "them" or "draw" for the match that just finished. */
        String lastResult,
        boolean lastMatchForfeited,

        // rematch
        boolean youWantRematch,
        boolean opponentWantsRematch,

        /** "you" or "them" when someone has left the room for good. */
        String abandonedBy
) {

    public record MoveView(int seq, int index, String role) {}

    public static RoomStateResponse of(Room room, String viewerId) {
        String role = room.roleOf(viewerId);
        String otherRole = Room.HOST.equals(role) ? Room.GUEST : Room.HOST;
        boolean isHost = Room.HOST.equals(role);

        List<MoveView> moves = room.getMoves().stream()
                .map(move -> new MoveView(
                        move.seq(),
                        move.index(),
                        room.roleOf(move.playerId())))
                .toList();

        String opponentId = room.opponentOf(viewerId);

        return new RoomStateResponse(
                room.getCode(),
                room.getGameType(),
                room.getBoardSize(),
                room.getStatus().name(),
                room.getVersion(),

                room.getHostName(),
                room.getGuestName(),
                role,
                isHost ? room.getGuestName() : room.getHostName(),
                room.isFull(),
                room.isFull() && room.isRoleOnline(otherRole),

                viewerId != null && viewerId.equals(room.getCurrentPlayerId()),
                moves,
                room.getResultNote(),

                room.getMatchNumber(),
                room.getStartingRole(),
                role != null && role.equals(room.getStartingRole()),
                isHost ? room.getHostWins() : room.getGuestWins(),
                isHost ? room.getGuestWins() : room.getHostWins(),
                room.getDraws(),
                relativeResult(room.getLastWinnerRole(), role),
                room.isLastMatchForfeited(),

                room.hasVotedRematch(viewerId),
                room.hasVotedRematch(opponentId),

                relativeSide(room.getAbandonedByRole(), role)
        );
    }

    /** Turns an absolute winner role into "you" / "them" / "draw". */
    private static String relativeResult(String winnerRole, String viewerRole) {
        if (winnerRole == null) return null;
        if (Room.DRAW.equals(winnerRole)) return "draw";
        return winnerRole.equals(viewerRole) ? "you" : "them";
    }

    private static String relativeSide(String role, String viewerRole) {
        if (role == null) return null;
        return role.equals(viewerRole) ? "you" : "them";
    }
}
