# A Cows & Bulls room across two matches.
#
# Split from the main room test because it guards one specific trap:
# startRematch clears the secret, and RoomService re-seeds it straight after.
# Get that order wrong and the first guess of the second match scores against
# a null - a 500 that only ever shows up on the second game anyone plays.
#
# Needs the backend on :8080. Run: python3 cows-bulls-rematch-test.py
import json, urllib.request, itertools, sys
B="http://localhost:8080"; ok=fail=0
def check(l,c,d=""):
    global ok,fail
    if c: ok+=1; print(f"  PASS  {l}")
    else: fail+=1; print(f"  FAIL  {l}"+(f"\n          {d}" if d else ""))
def call(m,p,b=None,err=False):
    r=urllib.request.Request(B+p,method=m,data=json.dumps(b).encode() if b is not None else None,
        headers={"Content-Type":"application/json"})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        p=json.load(e)
        if err: return {"_status":e.code,"_err":p}
        raise AssertionError(f"{p}")

print("rematch gives a fresh code, not a null one:")
room=call("POST","/api/rooms",{"gameType":"cows-and-bulls","playerId":"A","playerName":"Ana"})
code=room["code"]; call("POST",f"/api/rooms/{code}/join",{"playerId":"B","playerName":"Ben"})
cands=["".join(p) for p in itertools.permutations("0123456789",3) if p[0]!="0"]
def play_to_finish():
    players=["A","B"]; t=0; i=0; last=None
    while i<len(cands):
        last=call("POST",f"/api/rooms/{code}/guess",{"playerId":players[t%2],"guess":cands[i]})
        if last["status"]=="FINISHED": return last
        t+=1; i+=1
    return last
first=play_to_finish()
secret1=first["secret"]
check("match 1 finishes and reveals a code", first["status"]=="FINISHED" and secret1 is not None)

call("POST",f"/api/rooms/{code}/rematch?playerId=A")
r2=call("POST",f"/api/rooms/{code}/rematch?playerId=B")
check("rematch restarts the room", r2["status"]=="PLAYING", r2["status"])
check("and hides the code again", r2["secret"] is None, str(r2["secret"]))
check("guess history is cleared", r2["yourGuesses"]==[] and r2["opponentGuessCount"]==0)

# The real risk: startRematch nulls the secret, so if RoomService did not
# re-seed it the first guess of match 2 would blow up on a null.
g=call("POST",f"/api/rooms/{code}/guess",{"playerId":r2["startingRole"]=="host" and "A" or "B","guess":"123"},err=True)
check("the first guess of match 2 is scored, not a 500",
      "_status" not in g and isinstance(g.get("yourGuesses"),list) and len(g["yourGuesses"])==1,
      json.dumps(g)[:160])
second=play_to_finish()
check("match 2 also finishes", second["status"]=="FINISHED")
check("a new code was drawn", second["secret"] is not None)
print(f"          (match 1 code {secret1}, match 2 code {second['secret']})")
print(f"\n{ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
