package com.petproject.cowsandbulls.exception;

public class RoomNotFoundException extends RuntimeException {
    public RoomNotFoundException(String code) {
        super("No room with code " + code + ". It may have expired, or the code was mistyped.");
    }
}
