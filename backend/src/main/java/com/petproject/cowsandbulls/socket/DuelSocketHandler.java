package com.petproject.cowsandbulls.socket;

import com.petproject.cowsandbulls.model.Room;
import com.petproject.cowsandbulls.service.RoomService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Relays the Snake duel's input stream between two browsers.
 *
 * <p><b>Why this exists.</b> The duel used to run peer-to-peer over WebRTC.
 * That never worked across networks, and could not: STUN alone yields no relay
 * candidate, every free public TURN service has shut down, and Indian mobile
 * carriers are uniformly behind carrier-grade NAT. So the two peers had no path
 * to each other and the handshake always ended in failure.
 *
 * <p><b>Why relaying is free.</b> Lockstep's steering feel is fixed by
 * {@code INPUT_DELAY * TICK_MS} (380ms) on the client, whatever the transport -
 * network latency decides only whether the game <em>stalls</em>, never how
 * responsive it feels. A relayed hop through this instance measures ~158ms,
 * comfortably inside that budget, so a relayed duel plays identically to a
 * direct one while connecting every time.
 *
 * <p><b>This stays a dumb pipe.</b> Frames are forwarded verbatim and never
 * parsed, so the server still holds no game rules - the same principle the
 * move endpoints follow. It knows only who is allowed to talk to whom.
 */
@Component
public class DuelSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(DuelSocketHandler.class);

    /**
     * Keepalive marker, deliberately not JSON.
     *
     * <p>Cloudflare closes a WebSocket that has been silent for ~100s, which is
     * exactly what happens while two players sit in the lobby waiting for the
     * second one to arrive. Echoing a bare token keeps traffic flowing in both
     * directions without this class ever having to parse a frame.
     */
    private static final String KEEPALIVE = "ka";

    /** An input frame is a few dozen bytes; anything larger is not ours. */
    private static final int MAX_FRAME_CHARS = 4096;

    private static final String ATTR_CODE = "duel.code";
    private static final String ATTR_ROLE = "duel.role";

    private final RoomService roomService;

    /** code -> the pair of sockets currently in that room. */
    private final Map<String, Channel> channels = new ConcurrentHashMap<>();

    public DuelSocketHandler(RoomService roomService) {
        this.roomService = roomService;
    }

    /** The two seats of one room. Guarded by synchronizing on the instance. */
    private static final class Channel {
        private WebSocketSession host;
        private WebSocketSession guest;

        synchronized WebSocketSession seat(String role) {
            return Room.HOST.equals(role) ? host : guest;
        }

        synchronized void take(String role, WebSocketSession session) {
            if (Room.HOST.equals(role)) host = session;
            else guest = session;
        }

        /** Clears the seat only if it still holds this exact session. */
        synchronized boolean release(String role, WebSocketSession session) {
            if (Room.HOST.equals(role)) {
                if (host == session) host = null;
            } else if (guest == session) {
                guest = null;
            }
            return host == null && guest == null;
        }

        synchronized boolean bothPresent() {
            return host != null && host.isOpen() && guest != null && guest.isOpen();
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        Map<String, String> params = queryParams(session.getUri());
        String code = params.get("code");
        String playerId = params.get("playerId");

        // Same rule the HTTP endpoints apply: you may only join a room you are
        // already a player in. Without this anyone knowing a code could sit in
        // the middle of someone else's match.
        String role = code == null || playerId == null ? null : roomService.roleIn(code, playerId);
        if (role == null) {
            session.close(new CloseStatus(4004, "Not a player in this room"));
            return;
        }

        String normalized = code.trim().toUpperCase();
        session.getAttributes().put(ATTR_CODE, normalized);
        session.getAttributes().put(ATTR_ROLE, role);

        Channel channel = channels.computeIfAbsent(normalized, key -> new Channel());

        // A reconnect (tab refresh, phone waking, a flaky mobile handover)
        // arrives as a second socket for the same seat. The new one wins and
        // the stale one is dropped, so a player is never locked out of their
        // own room by a socket the network already abandoned.
        // Claim the seat BEFORE closing the old socket. Closing first lets the
        // old socket's afterConnectionClosed run against a seat it still owns,
        // which clears it and tells the opponent "peer-left" for a player who
        // is in fact right here - a visible stutter for no reason. Taking the
        // seat first makes release() a no-op for the stale session.
        WebSocketSession previous = channel.seat(role);
        channel.take(role, session);
        if (previous != null && previous != session) {
            close(previous, new CloseStatus(4001, "Replaced by a newer connection"));
        }

        if (channel.bothPresent()) {
            // Sent to BOTH sides, on every pairing rather than only the first.
            // The clients use it as their cue to replay the inputs they have
            // already sent, which is what lets a match survive a reconnect
            // instead of freezing on an input that went missing.
            broadcast(channel, "{\"k\":\"sys\",\"e\":\"ready\"}");
        } else {
            send(session, "{\"k\":\"sys\",\"e\":\"waiting\"}");
        }
        log.debug("Duel socket open: room {} seat {}", normalized, role);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        String payload = message.getPayload();

        if (KEEPALIVE.equals(payload)) {
            send(session, KEEPALIVE);
            return;
        }
        if (payload.length() > MAX_FRAME_CHARS) {
            return;
        }

        String code = (String) session.getAttributes().get(ATTR_CODE);
        String role = (String) session.getAttributes().get(ATTR_ROLE);
        if (code == null || role == null) return;

        Channel channel = channels.get(code);
        if (channel == null) return;

        // Forwarded untouched - the server has no idea what an input means.
        WebSocketSession partner = channel.seat(Room.HOST.equals(role) ? Room.GUEST : Room.HOST);
        send(partner, payload);
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        String code = (String) session.getAttributes().get(ATTR_CODE);
        String role = (String) session.getAttributes().get(ATTR_ROLE);
        if (code == null || role == null) return;

        Channel channel = channels.get(code);
        if (channel == null) return;

        boolean empty = channel.release(role, session);
        if (empty) {
            channels.remove(code, channel);
        } else {
            // Tell whoever is left, so their screen can say "reconnecting"
            // rather than sitting on a board that has quietly stopped moving.
            send(channel.seat(Room.HOST.equals(role) ? Room.GUEST : Room.HOST),
                    "{\"k\":\"sys\",\"e\":\"peer-left\"}");
        }
        log.debug("Duel socket closed: room {} seat {} ({})", code, role, status.getCode());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) {
        close(session, CloseStatus.SERVER_ERROR);
    }

    /**
     * Safety net for channels whose sockets died without a close callback.
     * afterConnectionClosed normally fires, but a dropped mobile connection is
     * exactly the case where "normally" is not good enough.
     */
    @Scheduled(fixedDelayString = "${app.duel.sweep-interval-ms:120000}")
    public void sweepDeadChannels() {
        channels.entrySet().removeIf(entry -> {
            Channel channel = entry.getValue();
            synchronized (channel) {
                boolean hostGone = channel.host == null || !channel.host.isOpen();
                boolean guestGone = channel.guest == null || !channel.guest.isOpen();
                return hostGone && guestGone;
            }
        });
    }

    public int activeChannelCount() {
        return channels.size();
    }

    /* ---- plumbing -------------------------------------------------------- */

    private void broadcast(Channel channel, String text) {
        send(channel.seat(Room.HOST), text);
        send(channel.seat(Room.GUEST), text);
    }

    /**
     * A WebSocketSession is not safe for concurrent writes - two threads
     * sending at once corrupts the frame stream - and both the partner's relay
     * and this class's own control messages can land on the same session.
     */
    private void send(WebSocketSession session, String text) {
        if (session == null || !session.isOpen()) return;
        try {
            synchronized (session) {
                session.sendMessage(new TextMessage(text));
            }
        } catch (IOException | IllegalStateException ex) {
            // The socket is on its way out; afterConnectionClosed will tidy up.
            close(session, CloseStatus.SERVER_ERROR);
        }
    }

    private void close(WebSocketSession session, CloseStatus status) {
        try {
            session.close(status);
        } catch (IOException | IllegalStateException ex) {
            /* already gone */
        }
    }

    private Map<String, String> queryParams(URI uri) {
        Map<String, String> out = new java.util.HashMap<>();
        if (uri == null || uri.getQuery() == null) return out;
        for (String pair : uri.getQuery().split("&")) {
            int eq = pair.indexOf('=');
            if (eq <= 0) continue;
            out.put(
                    java.net.URLDecoder.decode(pair.substring(0, eq), java.nio.charset.StandardCharsets.UTF_8),
                    java.net.URLDecoder.decode(pair.substring(eq + 1), java.nio.charset.StandardCharsets.UTF_8));
        }
        return out;
    }
}
