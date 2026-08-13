package com.petproject.cowsandbulls.dto;

import com.petproject.cowsandbulls.model.Room;

import java.util.List;

/**
 * The whole room as the client needs to see it. Clients poll for this and
 * rebuild the board by replaying `moves` through their own rules module.
 *
 * <p>`yourRole` is resolved per-caller so the frontend never has to compare
 * ids to work out which side of the board it is on.
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
        boolean yourTurn,
        boolean opponentPresent,
        List<MoveView> moves,
        String resultNote
) {

    public record MoveView(int seq, int index, String role) {}

    public static RoomStateResponse of(Room room, String viewerId) {
        boolean isHost = room.getHostId().equals(viewerId);
        String role = isHost ? "host" : "guest";

        List<MoveView> moves = room.getMoves().stream()
                .map(move -> new MoveView(
                        move.seq(),
                        move.index(),
                        room.getHostId().equals(move.playerId()) ? "host" : "guest"))
                .toList();

        return new RoomStateResponse(
                room.getCode(),
                room.getGameType(),
                room.getBoardSize(),
                room.getStatus().name(),
                room.getVersion(),
                room.getHostName(),
                room.getGuestName(),
                role,
                viewerId != null && viewerId.equals(room.getCurrentPlayerId()),
                room.isFull(),
                moves,
                room.getResultNote()
        );
    }
}
