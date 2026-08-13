package com.petproject.cowsandbulls.exception;

/** Anything the caller got wrong about a room: not their turn, room full, square taken. */
public class InvalidRoomActionException extends RuntimeException {
    public InvalidRoomActionException(String message) {
        super(message);
    }
}
