package com.petproject.cowsandbulls.exception;

public class GameNotFoundException extends RuntimeException {
    public GameNotFoundException(String gameId) {
        super("No game found with id " + gameId + " (it may have expired or already finished)");
    }
}
