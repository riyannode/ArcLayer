#!/usr/bin/env python3
import hmac, hashlib, time, json, urllib.request, sys, os
from datetime import datetime, timezone

# Read secret from env
secret = os.environ.get("ARCLAYER_RUNNER_SECRET", "")
if not secret:
    # Read from .env.runner
    with open("/root/ArcLayer/.env.runner") as f:
        for line in f:
            if line.startswith("ARCLAYER_RUNNER_SECRET="):
                secret = line.strip().split("=", 1)[1]
                break

if not secret:
    print("ERROR: ARCLAYER_RUNNER_SECRET not found")
    sys.exit(1)

def sha256hex(data):
    return hashlib.sha256(data.encode()).hexdigest()

def hmac_sha256(sec, payload):
    return "sha256=" + hmac.new(sec.encode(), payload.encode(), hashlib.sha256).hexdigest()

def hmac_post(path, body_dict=None):
    if body_dict is None:
        body_dict = {}
    body = json.dumps(body_dict)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    nonce = "test-" + str(int(time.time() * 1000))
    body_hash = sha256hex(body)
    payload = "POST\n" + path + "\n" + ts + "\n" + nonce + "\n" + body_hash
    sig = hmac_sha256(secret, payload)
    url = "http://127.0.0.1:8787" + path
    req = urllib.request.Request(url, data=body.encode(), method="POST")
    req.add_header("x-arclayer-runner-timestamp", ts)
    req.add_header("x-arclayer-runner-nonce", nonce)
    req.add_header("x-arclayer-runner-signature", sig)
    req.add_header("Content-Type", "application/json")
    try:
        resp = urllib.request.urlopen(req, timeout=15)
        return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"error": "HTTP " + str(e.code), "body": e.read().decode()[:300]}
    except Exception as e:
        return {"error": str(e)}

endpoints = [
    "/provider/context",
    "/provider/resume-plan",
    "/provider/list-assigned-jobs",
    "/provider/list-open-jobs",
]

print("=== Provider Read Tools Test ===")
for path in endpoints:
    result = hmac_post(path)
    status = "OK" if "error" not in result else "FAIL"
    print(f"{status} {path}: {json.dumps(result)[:250]}")
