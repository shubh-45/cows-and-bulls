package com.petproject.cowsandbulls.dto;

import com.petproject.cowsandbulls.model.Room;

import java.util.List;

/** Whatever the other player has posted since the caller's cursor. */
public record SignalsResponse(int cursor, List<Item> signals) {

    public record Item(int seq, String kind, String payload) {}

    public static SignalsResponse of(List<Room.Signal> signals, int since) {
        int cursor = signals.isEmpty() ? since : signals.get(signals.size() - 1).seq();
        return new SignalsResponse(
                cursor,
                signals.stream().map(s -> new Item(s.seq(), s.kind(), s.payload())).toList());
    }
}
