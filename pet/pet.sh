#!/bin/bash
# Drive the desktop pet from Claude Code hooks, or control it by hand.
#
# Hooks (stdin carries the hook JSON — only this form reads stdin):
#   pet.sh hook idle|working|done|waiting
#   pet.sh hook act                    current tool call   (PreToolUse)
#   pet.sh hook todo                   todo progress       (PostToolUse TodoWrite)
#
# By hand (never reads stdin, so it cannot hang a terminal):
#   pet.sh hide | show | toggle        visibility
#   pet.sh reset                       back to the top-right corner
#   pet.sh quit                        shut the pet down
#   pet.sh idle|working|done|waiting   drive it manually, as session "manual"
#
# Every Claude session on this machine shares these hooks, so state is kept
# per session under s/<session_id>/ and the pet follows whichever is busiest.
#   state     idle|working|done|waiting     progress  "<done> <total>" from todos
#   activity  what it is doing right now    step      tool calls this turn
#   since     epoch when the turn started   dur       seconds the turn took
#   proj      project directory name
#
# The jq programs live in label.jq / todo.jq so shell quoting cannot mangle them.

DIR="$HOME/.claude/pet"
SROOT="$DIR/s"
mkdir -p "$SROOT"

launch() {
  if ! pgrep -qx claude-pet 2>/dev/null; then
    nohup "$DIR/claude-pet" >/dev/null 2>&1 &
  fi
}

# ---- global controls: no stdin, no session ----
case "$1" in
  hide)
    : > "$DIR/hidden"; launch; exit 0 ;;
  show)
    rm -f "$DIR/hidden"; launch; exit 0 ;;
  toggle)
    if [ -f "$DIR/hidden" ]; then rm -f "$DIR/hidden"; else : > "$DIR/hidden"; fi
    launch; exit 0 ;;
  quit)
    : > "$DIR/quit"; exit 0 ;;
  reset)
    # Position is only read at launch, so bounce the process.
    rm -f "$DIR/pos"; : > "$DIR/quit"; sleep 1.2; launch; exit 0 ;;
esac

# ---- resolve the session this invocation belongs to ----
if [ "$1" = "hook" ]; then
  CMD="$2"
  RAW=$(cat)                                  # hooks always pipe JSON in
  SID=$(printf '%s' "$RAW" | jq -r '.session_id // empty' 2>/dev/null \
        | tr -cd 'A-Za-z0-9._-' | cut -c1-64)
  [ -z "$SID" ] && SID="unknown"
else
  CMD="$1"
  RAW=""
  SID="manual"
fi

SDIR="$SROOT/$SID"
mkdir -p "$SDIR"

if [ -n "$RAW" ]; then
  CWD=$(printf '%s' "$RAW" | jq -r '.cwd // empty' 2>/dev/null)
  [ -n "$CWD" ] && basename "$CWD" > "$SDIR/proj"
fi

case "$CMD" in
  act)
    label=$(printf '%s' "$RAW" | jq -r -f "$DIR/label.jq" 2>/dev/null)
    [ -n "$label" ] && [ "$label" != "null" ] && printf '%s' "$label" > "$SDIR/activity"

    step=$(cat "$SDIR/step" 2>/dev/null)
    case "$step" in ''|*[!0-9]*) step=0 ;; esac
    printf '%s' "$((step + 1))" > "$SDIR/step"

    # A tool call means this session is working, whatever it last said. This also
    # covers sessions whose turn began before the hooks were installed.
    printf 'working' > "$SDIR/state"
    [ -s "$SDIR/since" ] || date +%s > "$SDIR/since"
    exit 0 ;;

  todo)
    printf '%s' "$RAW" | jq -r -f "$DIR/todo.jq" 2>/dev/null > "$SDIR/progress"
    exit 0 ;;

  working)
    # New turn: clear last turn's report.
    date +%s > "$SDIR/since"
    printf '0' > "$SDIR/step"
    : > "$SDIR/activity"
    : > "$SDIR/progress"
    : > "$SDIR/dur"
    # Drop sessions that have been silent for over a day.
    find "$SROOT" -mindepth 1 -maxdepth 1 -type d -mtime +1 -exec rm -rf {} + 2>/dev/null
    ;;

  done)
    since=$(cat "$SDIR/since" 2>/dev/null)
    case "$since" in ''|*[!0-9]*) since='' ;; esac
    [ -n "$since" ] && printf '%s' "$(( $(date +%s) - since ))" > "$SDIR/dur"
    : > "$SDIR/activity"
    ;;
esac

case "$CMD" in
  idle|working|done|waiting) printf '%s' "$CMD" > "$SDIR/state" ;;
  *) exit 0 ;;
esac

launch

# A soft chime for the moment it finishes, so it lands even if you are looking away.
if [ "$CMD" = "done" ]; then
  afplay /System/Library/Sounds/Glass.aiff >/dev/null 2>&1 &
fi

exit 0
