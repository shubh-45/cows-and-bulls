# Two-player Cows & Bulls, end to end against a running backend.
#
# Python rather than Node because this one talks to the API and never touches
# the browser: the interesting claims are all server-side. The claim that
# matters most is the last group - that the opponent's guesses are not merely
# hidden by the UI but never leave the server, because both players are
# hunting the SAME code and one leaked guess would hand over the answer.
#
# Needs the backend on :8080. Run: python3 cows-bulls-room-test.py
import json, urllib.request, itertools, sys

B = "http://localhost:8080"
ok = fail = 0
def check(label, cond, detail=""):
    global ok, fail
    if cond: ok += 1; print(f"  PASS  {label}")
    else: fail += 1; print(f"  FAIL  {label}" + (f"\n          {detail}" if detail else ""))

def call(method, path, body=None, expect_error=False):
    req = urllib.request.Request(B + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"})
    try:
        return json.load(urllib.request.urlopen(req))
    except urllib.error.HTTPError as e:
        payload = json.load(e)
        if expect_error: return {"_error": payload, "_status": e.code}
        raise AssertionError(f"{path} -> {e.code} {payload}")

print("solo Cows & Bulls still works after the rules were extracted:")
g = call("POST", "/api/games")
r = call("POST", f"/api/games/{g['gameId']}/guesses", {"guess": "123"})
check("a solo guess is scored", isinstance(r.get("cows"), int) and isinstance(r.get("bulls"), int),
      json.dumps(r)[:120])
check("cows+bulls never exceeds the code length", r["cows"] + r["bulls"] <= 3)
bad = call("POST", f"/api/games/{g['gameId']}/guesses", {"guess": "112"}, expect_error=True)
check("repeated digits still rejected", bad.get("_status") == 400, json.dumps(bad)[:120])

print("\nother games are untouched:")
t = call("POST", "/api/rooms", {"gameType": "tic-tac-toe", "playerId": "h1", "playerName": "H"})
call("POST", f"/api/rooms/{t['code']}/join", {"playerId": "g1", "playerName": "G"})
mv = call("POST", f"/api/rooms/{t['code']}/moves", {"playerId": "h1", "index": 4})
check("tic-tac-toe still accepts a move", any(m["index"] == 4 for m in mv["moves"]))
check("and carries no Cows & Bulls baggage",
      mv["yourGuesses"] == [] and mv["opponentGuessCount"] == 0 and mv["secret"] is None,
      json.dumps({k: mv[k] for k in ("yourGuesses","opponentGuessCount","secret")}))

print("\ntwo-player Cows & Bulls:")
room = call("POST", "/api/rooms", {"gameType": "cows-and-bulls", "playerId": "A", "playerName": "Ana"})
code = room["code"]
call("POST", f"/api/rooms/{code}/join", {"playerId": "B", "playerName": "Ben"})
state_a = call("GET", f"/api/rooms/{code}?playerId=A")
check("the secret is never sent while the match is live", state_a["secret"] is None)
check("host starts", state_a["yourTurn"] is True)

# Out of turn must be refused.
oot = call("POST", f"/api/rooms/{code}/guess", {"playerId": "B", "guess": "123"}, expect_error=True)
check("guessing out of turn is refused", oot.get("_status") == 409, json.dumps(oot)[:140])

candidates = ["".join(p) for p in itertools.permutations("0123456789", 3) if p[0] != "0"]
players, turn, i, last = ["A", "B"], 0, 0, None
while i < len(candidates):
    me = players[turn % 2]
    res = call("POST", f"/api/rooms/{code}/guess", {"playerId": me, "guess": candidates[i]})
    last = res
    if res["status"] == "FINISHED": break
    turn += 1; i += 1

check("the match reaches a finish", last["status"] == "FINISHED", last["status"])
check("the code is revealed only once it is over", last["secret"] is not None)
check("the winner is recorded", last["lastResult"] in ("you", "them", "draw"), str(last["lastResult"]))

a = call("GET", f"/api/rooms/{code}?playerId=A")
b = call("GET", f"/api/rooms/{code}?playerId=B")
mine_a = {x["guess"] for x in a["yourGuesses"]}
mine_b = {x["guess"] for x in b["yourGuesses"]}
check("each player sees their own guesses", len(mine_a) > 0 and len(mine_b) > 0,
      f"A {len(mine_a)}  B {len(mine_b)}")
check("and NONE of the opponent's", mine_a.isdisjoint(mine_b),
      f"overlap: {sorted(mine_a & mine_b)[:5]}")
check("the opponent's turn count is visible as a number only",
      a["opponentGuessCount"] == len(mine_b) and b["opponentGuessCount"] == len(mine_a),
      f'A sees {a["opponentGuessCount"]} vs {len(mine_b)}')
check("both players agree on the revealed code", a["secret"] == b["secret"])
solved = [x for x in a["yourGuesses"] + b["yourGuesses"] if x["bulls"] == 3]
check("somebody actually cracked it", len(solved) >= 1)
check("the cracked guess IS the secret", all(x["guess"] == a["secret"] for x in solved),
      f'{[x["guess"] for x in solved]} vs {a["secret"]}')
check("turns stayed even or one apart", abs(len(mine_a) - len(mine_b)) <= 1,
      f"{len(mine_a)} vs {len(mine_b)}")

print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
