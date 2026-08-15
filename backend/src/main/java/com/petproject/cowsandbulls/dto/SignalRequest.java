package com.petproject.cowsandbulls.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * One WebRTC handshake message. `payload` is opaque to the server - it is the
 * browser's own SDP or ICE candidate JSON, relayed untouched.
 */
public record SignalRequest(
        @NotBlank(message = "playerId is required") String playerId,
        @NotBlank(message = "kind is required") String kind,
        @NotBlank(message = "payload is required")
        @Size(max = 8000, message = "Handshake message too large") String payload
) {}
