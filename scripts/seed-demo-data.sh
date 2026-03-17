#!/usr/bin/env bash
# Seed demo data for OtherThing workspace demo
# Creates fake users, conversations, tasks, transcriptions, and artifacts

API="http://localhost:8080/api/v1"
AUTH="Authorization: Bearer local-token"
CT="Content-Type: application/json"

# Use a deterministic workspace ID (matches what the UI would use)
WS="ws-demo-sprint-1"

echo "=== Seeding Demo Data ==="

# ── Fake User Profiles ──
echo ""
echo ">>> Creating fake user profiles..."

curl -s -X PUT "$API/profile" -H "$AUTH" -H "$CT" -d '{
  "displayName": "Alex (Founder)",
  "bio": "Building the future of decentralized work. Founder @ OtherThing.",
  "avatar": null
}' > /dev/null

for profile in \
  '{"address":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen","bio":"Senior fullstack dev. Rust + React. Open source enthusiast."}' \
  '{"address":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera","bio":"Smart contract engineer. Solidity/Vyper. Security-focused."}' \
  '{"address":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor","bio":"DevOps & infrastructure. Docker, k8s, ZLayer. Making things scale."}' \
  '{"address":"0xbDA5747bFD65F08deb54cb465eB87D40e51B197E","displayName":"Priya Sharma","bio":"UI/UX engineer. Design systems, accessibility, animations."}'; do
  addr=$(echo "$profile" | python3 -c "import sys,json; print(json.load(sys.stdin)['address'])")
  # We can't create profiles for other addresses via the API easily,
  # but we'll use these addresses in chat messages
  echo "  Profile prepared: $addr"
done

# ── Seed Tasks (various states) ──
echo ""
echo ">>> Creating sprint tasks..."

# Todo tasks
curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Add dark mode toggle to settings panel",
  "description": "Users have been requesting a manual dark/light mode toggle. Currently we only respect system preference. Add a three-way toggle: System / Dark / Light.",
  "status": "todo",
  "priority": "medium",
  "assignee": "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E"
}' > /dev/null && echo "  Task: Dark mode toggle (todo)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Write integration tests for escrow milestone flow",
  "description": "We need end-to-end tests covering: task creation with escrow, worker assignment, milestone submission, approval, and payment release. Use hardhat fork for contract interaction.",
  "status": "todo",
  "priority": "high",
  "assignee": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72"
}' > /dev/null && echo "  Task: Escrow integration tests (todo)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Investigate IPFS daemon crash on large file uploads",
  "description": "IPFS daemon exits with code 1 when uploading files >500MB. Need to check if this is a memory issue or a Kubo bug. Possibly need to increase ulimits or switch to chunked upload.",
  "status": "todo",
  "priority": "high"
}' > /dev/null && echo "  Task: IPFS crash investigation (todo)"

# In-progress tasks
curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Fix WebRTC connection drops on NAT traversal",
  "description": "Voice/video calls drop after ~30 seconds when peers are behind symmetric NAT. Need to add TURN server fallback. Currently only using STUN.",
  "status": "in-progress",
  "priority": "high",
  "assignee": "0x2546BcD3c84621e976D8185a91A922aE77ECEc30"
}' > /dev/null && echo "  Task: WebRTC NAT fix (in-progress)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Implement workspace file browser with drag-and-drop upload",
  "description": "Replace the basic file list with a proper file browser. Support folder navigation, drag-and-drop upload to IPFS, file preview for images/text, and bulk operations.",
  "status": "in-progress",
  "priority": "medium",
  "assignee": "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E"
}' > /dev/null && echo "  Task: File browser (in-progress)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Optimize Ollama model loading time",
  "description": "First inference after model load takes 15-20 seconds on 8GB RAM machines. Investigate model quantization options and lazy loading strategies. Consider keeping a warm model in memory.",
  "status": "in-progress",
  "priority": "medium",
  "assignee": "0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18"
}' > /dev/null && echo "  Task: Ollama optimization (in-progress)"

# Done tasks
curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Set up CI pipeline with GitHub Actions",
  "description": "Basic CI: lint, typecheck, build. Run on PRs to main. Cache node_modules and build artifacts.",
  "status": "done",
  "priority": "high",
  "assignee": "0x2546BcD3c84621e976D8185a91A922aE77ECEc30"
}' > /dev/null && echo "  Task: CI pipeline (done)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Add OTT balance display in workspace header",
  "description": "Show connected wallet OTT balance in the workspace header. Include treasury pack purchase link.",
  "status": "done",
  "priority": "medium",
  "assignee": "0xbDA5747bFD65F08deb54cb465eB87D40e51B197E"
}' > /dev/null && echo "  Task: OTT balance display (done)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Implement workspace voice/video chat",
  "description": "WebRTC-based voice and video calls within workspaces. Peer-to-peer with signaling server relay. Support for mute, camera toggle, and participant list.",
  "status": "done",
  "priority": "high",
  "assignee": "0x2546BcD3c84621e976D8185a91A922aE77ECEc30"
}' > /dev/null && echo "  Task: Voice/video chat (done)"

curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Deploy milestone task smart contracts to Sepolia",
  "description": "Deploy and verify MilestoneTask.sol and related contracts on Sepolia testnet. Update contract addresses in the app config.",
  "status": "done",
  "priority": "high",
  "assignee": "0x8Ba1f109551bD432803012645Ac136ddd64DBA72"
}' > /dev/null && echo "  Task: Contract deployment (done)"

# Blocked task
curl -s -X POST "$API/workspaces/$WS/tasks" -H "$AUTH" -H "$CT" -d '{
  "title": "Add TURN server for WebRTC relay",
  "description": "Blocked on infrastructure decision — self-hosted coturn vs managed Twilio TURN. Need to decide before implementing fallback in the WebRTC stack.",
  "status": "blocked",
  "priority": "high",
  "assignee": "0x2546BcD3c84621e976D8185a91A922aE77ECEc30"
}' > /dev/null && echo "  Task: TURN server (blocked)"

# ── Seed Team Chat (realistic dev conversation) ──
echo ""
echo ">>> Seeding team chat messages..."

# Simulate a multi-day sprint conversation
MSGS=(
  # Day 1 morning standup
  '{"content":"gm everyone. sprint 4 kickoff. lets sync on priorities","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"morning! im picking up the WebRTC NAT traversal issue today. sam had some ideas about TURN servers","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"yeah so the problem is symmetric NAT. STUN alone wont cut it. we need a TURN relay as fallback. i was looking at coturn vs Twilio","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'
  '{"content":"how much does Twilio TURN cost? we should keep infra costs minimal since this is local-first","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"Twilio is like $0.40/GB. for dev/small teams its basically free. but self-hosted coturn is zero cost if we can run it","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'
  '{"content":"lets go self-hosted for now. sam can you spin up a coturn instance on the test server?","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"on it. will have it running by EOD","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'

  # Dev discussion about a bug
  '{"content":"hey anyone else seeing the IPFS daemon crash when uploading large files? im getting exit code 1 on anything over ~500MB","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"yeah i hit that too yesterday. i think its an fd limit issue. check ulimit -n, kubo opens a ton of file descriptors","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'
  '{"content":"confirmed. ulimit was 1024, bumped to 65536 and the 500MB upload works now. should we set this in the installer script?","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"good catch. yes add it to install.sh. also add a check in ipfs-manager.ts init() that warns if ulimit is too low","senderAddress":"0xFounder","displayName":"Alex"}'

  # Contract discussion
  '{"content":"contracts are deployed to Sepolia. MilestoneTask at 0x7a23...4f1b, OTT token at 0x9c12...8e3d. verified on etherscan","senderAddress":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera"}'
  '{"content":"nice! did you run the full test suite before deploying?","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"yeah 47/47 passing. gas optimization reduced createTask from 380k to 290k gas. the merkle proof for agreement verification is clean","senderAddress":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera"}'
  '{"content":"love it. can you write up the integration test plan next? we need to cover the full escrow flow end to end","senderAddress":"0xFounder","displayName":"Alex"}'

  # UI discussion
  '{"content":"pushed the file browser PR. drag and drop works, folder navigation, preview for images and text files. still need bulk ops","senderAddress":"0xbDA5747bFD65F08deb54cb465eB87D40e51B197E","displayName":"Priya Sharma"}'
  '{"content":"looks great! one thing - can we add a progress indicator for IPFS uploads? right now theres no feedback","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"yeah good call. ill add a progress bar. the ipfs manager emits progress events so i can hook into that","senderAddress":"0xbDA5747bFD65F08deb54cb465eB87D40e51B197E","displayName":"Priya Sharma"}'

  # Ollama performance discussion
  '{"content":"so i profiled the ollama cold start issue. the 15-20s delay is all model loading from disk to GPU memory. once loaded its fast","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"can we keep the model warm? like a background process that keeps it loaded?","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"ollama already does that if keep_alive is set. default is 5 min. i changed it to 30min in our config. first load is still slow but subsequent chats are instant","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"perfect. 30min keep alive is fine for a work session","senderAddress":"0xFounder","displayName":"Alex"}'

  # End of day sync
  '{"content":"EOD update: coturn is running on test server. credentials are in the shared vault. ill wire it into the WebRTC config tomorrow","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'
  '{"content":"file browser PR updated with progress bar and bulk delete. ready for review","senderAddress":"0xbDA5747bFD65F08deb54cb465eB87D40e51B197E","displayName":"Priya Sharma"}'
  '{"content":"good progress today everyone. maya can you review priyas PR tomorrow? jordan - start on the integration tests when ready","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"will do!","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"starting on it now actually. got the hardhat fork setup working","senderAddress":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera"}'

  # Day 2 - issues
  '{"content":"heads up - found a race condition in the escrow release. if two milestones are approved simultaneously the second tx can fail with insufficient balance","senderAddress":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera"}'
  '{"content":"thats a critical bug. is it in the contract or the frontend?","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"contract side. the nonReentrant modifier is on releaseMilestone but the balance check happens before the state update. classic check-effects-interactions violation","senderAddress":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera"}'
  '{"content":"ok fix and redeploy ASAP. this is a blocker for the escrow launch","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"already fixed locally. running the full suite now. will redeploy in ~1 hour","senderAddress":"0x8Ba1f109551bD432803012645Ac136ddd64DBA72","displayName":"Jordan Rivera"}'

  # More dev chat
  '{"content":"TURN server integration is working! tested with two machines behind different NATs. calls stay connected now","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'
  '{"content":"amazing. how much bandwidth does the relay use?","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"about 100kbps for audio only, 500kbps with video. acceptable for a relay fallback. direct p2p is still preferred when possible","senderAddress":"0x2546BcD3c84621e976D8185a91A922aE77ECEc30","displayName":"Sam Okafor"}'
  '{"content":"reviewed priyas file browser PR. LGTM with one nit - the drag overlay z-index conflicts with the workspace header. easy fix","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
  '{"content":"fixed! merged to main","senderAddress":"0xbDA5747bFD65F08deb54cb465eB87D40e51B197E","displayName":"Priya Sharma"}'

  # Planning next sprint
  '{"content":"sprint 4 looking solid. lets plan sprint 5. top priorities: 1) digest/health reports UI polish 2) sandbox preview improvements 3) agent tool permissions","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"id add mobile responsiveness to that list. the workspace tabs dont scroll on narrow screens","senderAddress":"0xbDA5747bFD65F08deb54cb465eB87D40e51B197E","displayName":"Priya Sharma"}'
  '{"content":"good point. lets make that p2. also we should look at offline mode - caching workspace data locally so you can work without internet","senderAddress":"0xFounder","displayName":"Alex"}'
  '{"content":"the IPFS export already gives us most of that. we just need a local-first read path that checks IPFS before the network","senderAddress":"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18","displayName":"Maya Chen"}'
)

for msg in "${MSGS[@]}"; do
  curl -s -X POST "$API/workspaces/$WS/chat" -H "$AUTH" -H "$CT" -d "$msg" > /dev/null
  sleep 0.05
done
echo "  Sent ${#MSGS[@]} chat messages"

# ── Export chat to IPFS (creates artifact for digest) ──
echo ""
echo ">>> Exporting chat artifacts..."

# Get all messages and export them
CHAT_DATA=$(curl -s "$API/workspaces/$WS/chat?limit=500" -H "$AUTH")
curl -s -X POST "$API/workspaces/$WS/exports/chat" -H "$AUTH" -H "$CT" \
  -d "{\"messages\": $(echo "$CHAT_DATA" | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('messages',[])))") }" > /dev/null 2>&1
echo "  Exported chat to IPFS artifact index"

# ── Seed Fake Transcription Data ──
echo ""
echo ">>> Seeding transcription segments..."

# Simulate a standup call transcription
SEGMENTS=(
  '{"audio":"fake-base64","speaker":"Alex","peerId":"local-founder"}'
  '{"audio":"fake-base64","speaker":"Maya Chen","peerId":"peer-maya"}'
  '{"audio":"fake-base64","speaker":"Sam Okafor","peerId":"peer-sam"}'
  '{"audio":"fake-base64","speaker":"Jordan Rivera","peerId":"peer-jordan"}'
  '{"audio":"fake-base64","speaker":"Priya Sharma","peerId":"peer-priya"}'
)

for seg in "${SEGMENTS[@]}"; do
  curl -s -X POST "$API/workspaces/$WS/transcription/chunk" -H "$AUTH" -H "$CT" -d "$seg" > /dev/null 2>&1
done
echo "  Submitted ${#SEGMENTS[@]} transcription chunks"

# Finalize the session
curl -s -X POST "$API/workspaces/$WS/transcription/finalize" -H "$AUTH" > /dev/null 2>&1
echo "  Finalized transcription session"

# ── Export whiteboard data ──
echo ""
echo ">>> Exporting whiteboard artifact..."
curl -s -X POST "$API/workspaces/$WS/exports/whiteboard" -H "$AUTH" -H "$CT" -d '{
  "data": {
    "elements": [
      {"type":"rectangle","x":100,"y":100,"width":200,"height":80,"label":"API Server"},
      {"type":"rectangle","x":400,"y":100,"width":200,"height":80,"label":"IPFS Node"},
      {"type":"rectangle","x":100,"y":250,"width":200,"height":80,"label":"Ollama"},
      {"type":"rectangle","x":400,"y":250,"width":200,"height":80,"label":"Blockchain"},
      {"type":"arrow","from":"API Server","to":"IPFS Node","label":"export artifacts"},
      {"type":"arrow","from":"API Server","to":"Ollama","label":"AI inference"},
      {"type":"arrow","from":"API Server","to":"Blockchain","label":"escrow ops"},
      {"type":"text","x":250,"y":30,"content":"Sprint 4 Architecture Overview"},
      {"type":"sticky","x":650,"y":100,"content":"TODO: Add TURN relay between peers"},
      {"type":"sticky","x":650,"y":200,"content":"BUG: Race condition in milestone release - Jordan fixing"}
    ],
    "viewport": {"x":0,"y":0,"zoom":1}
  }
}' > /dev/null 2>&1
echo "  Exported whiteboard to artifact index"

# ── Generate AI Digest ──
echo ""
echo ">>> Generating AI digest (this calls Ollama, may take a moment)..."
DIGEST_RESULT=$(curl -s -X POST "$API/workspaces/$WS/digest/generate" -H "$AUTH" -H "$CT" --max-time 120 2>&1)
echo "  Digest result: $(echo "$DIGEST_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('digest',{}).get('summary','No summary')[:120] if 'digest' in d else d.get('error','unknown error'))" 2>/dev/null || echo "$DIGEST_RESULT" | head -c 200)"

# ── Generate Health Report ──
echo ""
echo ">>> Generating health report (calls Ollama)..."
HEALTH_RESULT=$(curl -s -X POST "$API/workspaces/$WS/health-report/generate" -H "$AUTH" -H "$CT" --max-time 120 2>&1)
echo "  Health result: $(echo "$HEALTH_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('report',{}); print(f\"Speakers: {r.get('participationMetrics',{}).get('activeSpeakers',0)}, Messages: {r.get('participationMetrics',{}).get('messageCount',0)}, Tasks created: {r.get('taskVelocity',{}).get('created',0)}\") if 'report' in d else print(d.get('error','unknown'))" 2>/dev/null || echo "$HEALTH_RESULT" | head -c 200)"

# ── Verify everything ──
echo ""
echo "=== Verification ==="
echo ""

TASK_COUNT=$(curl -s "$API/workspaces/$WS/tasks" -H "$AUTH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('tasks',[])))" 2>/dev/null)
echo "Tasks: $TASK_COUNT"

MSG_COUNT=$(curl -s "$API/workspaces/$WS/chat?limit=500" -H "$AUTH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('messages',[])))" 2>/dev/null)
echo "Chat messages: $MSG_COUNT"

EXPORT_COUNT=$(curl -s "$API/workspaces/$WS/exports" -H "$AUTH" | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('artifacts',[])))" 2>/dev/null)
echo "IPFS artifacts: $EXPORT_COUNT"

DIGEST=$(curl -s "$API/workspaces/$WS/digest/latest" -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin).get('digest'); print('Yes' if d else 'No')" 2>/dev/null)
echo "Digest available: $DIGEST"

HEALTH=$(curl -s "$API/workspaces/$WS/health-report/latest" -H "$AUTH" | python3 -c "import sys,json; d=json.load(sys.stdin).get('report'); print('Yes' if d else 'No')" 2>/dev/null)
echo "Health report: $HEALTH"

JOBS=$(curl -s "$API/scheduler/jobs" -H "$AUTH" 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('jobs',[])))" 2>/dev/null)
echo "Scheduled jobs: $JOBS"

echo ""
echo "=== Demo data seeded! ==="
echo "Open workspace '$WS' in the app to see:"
echo "  - Chat tab: developer conversations"
echo "  - Tasks tab: sprint backlog with various states"
echo "  - Digest tab: AI-generated sprint summary"
echo "  - Health tab: team participation metrics"
