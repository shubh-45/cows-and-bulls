# Test harnesses

No test framework. These are plain Node scripts - run them with `node <file>`
from this directory. They print `PASS`/`FAIL` lines and exit non-zero on
failure, which is enough to catch regressions and cheap enough to run often.

They exist because the interesting failures here are not assertable by looking
at the screen: netcode desync, a shell's ricochet, whether a generated arena is
even playable, whether the board is actually animating.

## No backend needed

    node tanks-engine-test.mjs    tank rules: driving, weight, turret traverse,
                                  ricochet, cover, blasts, aim guide, and whether
                                  a tank can actually drive between the spawns
    node tank-auth-test.mjs       tank netcode with both ends in one process and
                                  no sockets - host/guest agreement at 80ms
    node auth-test.mjs            Snake netcode: prediction, rollback, convergence
    node glide-test.mjs           Snake between-cell drawing
    node guest-clock-test.mjs     Snake guest clock: jitter, corrections, progress bounds
    node render-trace.mjs         replays a Snake duel on a virtual clock and
                                  measures what each screen DRAWS - frozen
                                  frames, jumps, snap-backs

## Backend required on :8080

Start it first (see the handover doc), then:

    node relay-test.mjs           Snake end to end through the real WebSocket relay
    node tank-relay-test.mjs      tanks end to end, both clients here
    python3 cows-bulls-room-test.py     two-player Cows & Bulls: turn order,
                                        scoring, the win/draw rule, and that
                                        the opponent's guesses never leave the
                                        server. Also checks the other games and
                                        the solo game still behave
    python3 cows-bulls-rematch-test.py  the same room across two matches, where
                                        the secret has to be re-drawn

## Manual helpers

    node node-guest.mjs <CODE>    joins a Snake room and plays, so a browser has
                                  an opponent
    node tank-guest.mjs <CODE>    the same for Bank Shot

Both need the backend running and a room already created in the browser.
