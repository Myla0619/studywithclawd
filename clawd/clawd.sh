#!/bin/bash
# Control the study supervisor.
#
#   clawd.sh start | stop | restart | toggle
#   clawd.sh today            print today's record as JSON
#   clawd.sh build            recompile after editing ClawdStudy.swift
#
# Data lives in ~/.claude/clawd:
#   days/<yyyy-MM-dd>.json   the task list and give-up tally for that day
#   session.json             the countdown in flight (survives a restart)
#   pos                      where you dragged the panel

DIR="$HOME/.claude/clawd"

case "${1:-start}" in
  start)
    if pgrep -qx clawd 2>/dev/null; then echo "已经在跑了"; exit 0; fi
    nohup "$DIR/clawd" >/dev/null 2>&1 &
    echo "Clawd 起来了" ;;

  stop)
    pkill -x clawd 2>/dev/null && echo "Clawd 收工" || echo "本来就没在跑" ;;

  restart)
    pkill -x clawd 2>/dev/null; sleep 0.6
    nohup "$DIR/clawd" >/dev/null 2>&1 &
    echo "Clawd 重启了" ;;

  toggle)
    if pgrep -qx clawd 2>/dev/null; then
      pkill -x clawd; echo "Clawd 收工"
    else
      nohup "$DIR/clawd" >/dev/null 2>&1 &
      echo "Clawd 起来了"
    fi ;;

  motion)
    # Shared with the Claude Code pet: one flag drives both.
    F="$HOME/.claude/shared/motion"; mkdir -p "$HOME/.claude/shared"
    case "$2" in
      on)  : > "$F"; echo "动画开启（两只都会动）" ;;
      off) rm -f "$F"; echo "已改为静止（默认）" ;;
      *)   [ -f "$F" ] && echo "当前：动画开启" || echo "当前：静止" ;;
    esac ;;

  find)
    # 面板被别的窗口埋了就用这个：展开 + 回默认位置 + 置顶
    mkdir -p "$DIR"; : > "$DIR/find"
    if ! pgrep -qx clawd 2>/dev/null; then nohup "$DIR/clawd" >/dev/null 2>&1 & fi
    echo "已把面板叫回屏幕左上角" ;;

  summary)
    cat "$DIR/summary.md" 2>/dev/null || echo "还没有汇总" ;;

  today)
    cat "$DIR/days/$(date +%F).json" 2>/dev/null || echo "今天还没有记录" ;;

  build)
    swiftc -O -o "$DIR/clawd" "$DIR/ClawdStudy.swift" "$HOME/.claude/shared/Clawd.swift" -framework AppKit \
      && echo "编译好了，跑 clawd.sh restart 生效" ;;

  *)
    echo "用法: clawd.sh start|stop|restart|toggle|motion [on|off]|find|today|summary|build"; exit 1 ;;
esac
