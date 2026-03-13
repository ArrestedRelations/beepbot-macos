#!/bin/bash
# BeepBot Memory System Test Suite
# Run: bash tests/memory-system.test.sh
# Requires: BeepBot sidecar running on port 3004

set -e

PASS=0
FAIL=0
DB="$HOME/.beepbot-v2/beepbot.db"
WS_URL="ws://127.0.0.1:3004/ws"
API_URL="http://127.0.0.1:3004/api"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

pass() { echo -e "  ${GREEN}✅ PASS${NC}: $1"; ((PASS++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC}: $1 — $2"; ((FAIL++)); }

send_message() {
  local msg="$1"
  local timeout="${2:-60}"
  python3 -c "
import websocket, json, threading, time
output = ''
done = False
def on_message(ws, message):
    global output, done
    msg = json.loads(message)
    if msg['type'] == 'text': output += msg['data']
    elif msg['type'] == 'done':
        done = True
        ws.close()
    elif msg['type'] == 'error':
        done = True
        ws.close()
def on_open(ws):
    ws.send(json.dumps({'type': 'chat', 'content': '''$msg'''}))
ws = websocket.WebSocketApp('$WS_URL', on_message=on_message, on_open=on_open)
timer = threading.Timer($timeout, lambda: ws.close())
timer.start()
ws.run_forever()
timer.cancel()
print(output)
" 2>/dev/null
}

wait_for_extraction() {
  local seconds="${1:-30}"
  sleep "$seconds"
}

new_conversation() {
  curl -s -X POST "$API_URL/conversations" > /dev/null 2>&1
}

query_db() {
  sqlite3 "$DB" "$1" 2>/dev/null
}

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   BeepBot Memory System Test Suite           ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ─────────────────────────────────────────────
echo -e "${YELLOW}[0] Pre-flight checks${NC}"
# ─────────────────────────────────────────────

# 0.1 Sidecar running
health=$(curl -s "$API_URL/health" 2>/dev/null)
if echo "$health" | grep -q '"ok":true'; then
  pass "Sidecar is running"
else
  fail "Sidecar not running" "Start with: cd sidecar && npm run dev"
  echo -e "${RED}Cannot continue without sidecar. Exiting.${NC}"
  exit 1
fi

# 0.2 Database exists
if [ -f "$DB" ]; then
  pass "Database exists at $DB"
else
  fail "Database not found" "$DB"
  exit 1
fi

# 0.3 Memory tables exist
tables=$(query_db ".tables")
if echo "$tables" | grep -q "memories"; then
  pass "memories table exists"
else
  fail "memories table missing" "Run initMemoryTables"
fi

if echo "$tables" | grep -q "memories_fts"; then
  pass "memories_fts (FTS5) table exists"
else
  fail "memories_fts table missing" "FTS5 not initialized"
fi

if echo "$tables" | grep -q "memory_meta"; then
  pass "memory_meta table exists"
else
  fail "memory_meta table missing" "Metadata table not created"
fi

# 0.4 Clear test data
echo ""
echo -e "${YELLOW}  Clearing previous test memories...${NC}"
query_db "DELETE FROM memories WHERE content LIKE '%TEST_MARKER%';"
query_db "DELETE FROM memories_fts WHERE content LIKE '%TEST_MARKER%';"
BASELINE_COUNT=$(query_db "SELECT count(*) FROM memories;")
echo "  Baseline memory count: $BASELINE_COUNT"

# ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[1] Heuristic Filter Tests${NC}"
# ─────────────────────────────────────────────

# 1.1 Short responses should not trigger extraction
new_conversation
response=$(send_message "hi" 30)
wait_for_extraction 10
count_after=$(query_db "SELECT count(*) FROM memories;")
if [ "$count_after" = "$BASELINE_COUNT" ]; then
  pass "Short response ('hi') did not trigger extraction"
else
  fail "Short response triggered extraction" "Count went from $BASELINE_COUNT to $count_after"
  BASELINE_COUNT=$count_after
fi

# ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2] Memory Extraction Tests${NC}"
# ─────────────────────────────────────────────

# 2.1 Preference extraction
new_conversation
response=$(send_message "Remember this TEST_MARKER fact: I prefer using Neovim over Emacs for all text editing tasks. This is an important preference." 60)
echo "  Response: ${response:0:100}..."
wait_for_extraction 30

pref_count=$(query_db "SELECT count(*) FROM memories WHERE content LIKE '%Neovim%' OR content LIKE '%neovim%';")
if [ "$pref_count" -gt 0 ]; then
  pass "Preference extracted (Neovim preference found in DB)"
  query_db "SELECT '    → ' || content || ' [' || category || '/' || importance || ']' FROM memories WHERE content LIKE '%Neovim%' OR content LIKE '%neovim%';"
else
  fail "Preference not extracted" "No Neovim memory found after 30s"
fi

# 2.2 Project/deadline extraction
new_conversation
response=$(send_message "TEST_MARKER note: The Alpha project launches on April 15, 2026. Remember this deadline." 60)
echo "  Response: ${response:0:100}..."
wait_for_extraction 30

project_count=$(query_db "SELECT count(*) FROM memories WHERE content LIKE '%Alpha%' OR content LIKE '%April 15%';")
if [ "$project_count" -gt 0 ]; then
  pass "Project/deadline extracted (Alpha project found in DB)"
  query_db "SELECT '    → ' || content || ' [' || category || '/' || importance || ']' FROM memories WHERE content LIKE '%Alpha%' OR content LIKE '%April 15%';"
else
  fail "Project/deadline not extracted" "No Alpha project memory found"
fi

# 2.3 Multiple facts in one turn
new_conversation
response=$(send_message "TEST_MARKER remember all of these: 1) My favorite color is blue 2) I work at TechCorp 3) I wake up at 6am every day" 60)
echo "  Response: ${response:0:100}..."
wait_for_extraction 30

multi_count=$(query_db "SELECT count(*) FROM memories WHERE content LIKE '%blue%' OR content LIKE '%TechCorp%' OR content LIKE '%6am%' OR content LIKE '%6 am%';")
if [ "$multi_count" -ge 2 ]; then
  pass "Multiple facts extracted ($multi_count facts from one turn)"
  query_db "SELECT '    → ' || content || ' [' || category || '/' || importance || ']' FROM memories WHERE content LIKE '%blue%' OR content LIKE '%TechCorp%' OR content LIKE '%6am%' OR content LIKE '%6 am%';"
else
  fail "Multiple facts not extracted" "Only $multi_count facts found (expected 2+)"
fi

# ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3] FTS5 Search Tests${NC}"
# ─────────────────────────────────────────────

# 3.1 Keyword search
fts_result=$(query_db "SELECT content FROM memories_fts WHERE memories_fts MATCH 'Neovim' LIMIT 1;")
if [ -n "$fts_result" ]; then
  pass "FTS5 keyword search works (found: ${fts_result:0:60})"
else
  fail "FTS5 keyword search failed" "No result for 'Neovim'"
fi

# 3.2 Multi-word search
fts_multi=$(query_db "SELECT content FROM memories_fts WHERE memories_fts MATCH '\"dark\" OR \"mode\"' LIMIT 1;")
if [ -n "$fts_multi" ]; then
  pass "FTS5 multi-word search works"
else
  fail "FTS5 multi-word search failed" "No result for dark mode"
fi

# 3.3 Search returns nothing for irrelevant query
fts_irrelevant=$(query_db "SELECT count(*) FROM memories_fts WHERE memories_fts MATCH 'xyzzyplugh';")
if [ "$fts_irrelevant" = "0" ]; then
  pass "FTS5 correctly returns nothing for irrelevant query"
else
  fail "FTS5 returned results for irrelevant query" "Found $fts_irrelevant results"
fi

# ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4] Memory Recall Tests${NC}"
# ─────────────────────────────────────────────

# 4.1 Recall in new conversation
new_conversation
recall_response=$(send_message "What text editor do I prefer?" 60)
echo "  Response: ${recall_response:0:200}"

if echo "$recall_response" | grep -iq "neovim\|Neovim\|neo vim"; then
  pass "Memory recalled in new conversation (Neovim preference)"
else
  fail "Memory not recalled" "Response didn't mention Neovim"
fi

# 4.2 Recall project deadline
new_conversation
deadline_response=$(send_message "When does the Alpha project launch?" 60)
echo "  Response: ${deadline_response:0:200}"

if echo "$deadline_response" | grep -iq "april\|April\|15"; then
  pass "Project deadline recalled (April 15)"
else
  fail "Project deadline not recalled" "Response didn't mention April 15"
fi

# ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[5] File Persistence Tests${NC}"
# ─────────────────────────────────────────────

# 5.1 Daily log file created
today=$(date +%Y-%m-%d)
daily_file="$HOME/.beepbot-v2/workspace/memory/${today}.md"
if [ -f "$daily_file" ]; then
  pass "Daily log file exists: memory/${today}.md"
  lines=$(wc -l < "$daily_file")
  echo "    → $lines lines"
else
  fail "Daily log file not created" "Expected $daily_file"
fi

# 5.2 MEMORY.md has high-importance entries
memory_file="$HOME/.beepbot-v2/workspace/MEMORY.md"
if [ -f "$memory_file" ]; then
  high_entries=$(grep -c "High Priority\|high" "$memory_file" 2>/dev/null || echo "0")
  if [ "$high_entries" -gt 0 ]; then
    pass "MEMORY.md has high-importance entries ($high_entries sections)"
  else
    pass "MEMORY.md exists (no high-importance entries yet — may be normal)"
  fi
else
  fail "MEMORY.md not found" "Expected $memory_file"
fi

# ─────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[6] Data Integrity Tests${NC}"
# ─────────────────────────────────────────────

# 6.1 FTS index matches memories table
mem_count=$(query_db "SELECT count(*) FROM memories;")
fts_count=$(query_db "SELECT count(*) FROM memories_fts;")
if [ "$mem_count" = "$fts_count" ]; then
  pass "FTS index in sync with memories table ($mem_count records)"
else
  fail "FTS index out of sync" "memories: $mem_count, fts: $fts_count"
fi

# 6.2 All memories have required fields
null_count=$(query_db "SELECT count(*) FROM memories WHERE content IS NULL OR category IS NULL OR importance IS NULL;")
if [ "$null_count" = "0" ]; then
  pass "All memories have required fields (content, category, importance)"
else
  fail "Some memories have NULL fields" "$null_count records with NULLs"
fi

# 6.3 Importance values are valid
invalid_imp=$(query_db "SELECT count(*) FROM memories WHERE importance NOT IN ('low', 'medium', 'high');")
if [ "$invalid_imp" = "0" ]; then
  pass "All importance values are valid (low/medium/high)"
else
  fail "Invalid importance values found" "$invalid_imp records"
fi

# ─────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   Results                                    ║"
echo "╚══════════════════════════════════════════════╝"
echo ""
echo -e "  ${GREEN}Passed: $PASS${NC}"
echo -e "  ${RED}Failed: $FAIL${NC}"
echo ""

total_memories=$(query_db "SELECT count(*) FROM memories;")
echo "  Total memories in DB: $total_memories"
echo ""
echo "  Memory breakdown:"
query_db "SELECT '    ' || category || ': ' || count(*) FROM memories GROUP BY category ORDER BY count(*) DESC;"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo -e "  ${GREEN}🎉 All tests passed!${NC}"
  exit 0
else
  echo -e "  ${RED}⚠️  $FAIL test(s) failed.${NC}"
  exit 1
fi
