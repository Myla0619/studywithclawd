# Turn a PreToolUse hook payload into a few readable characters for the pet.
# Kept in its own file so no shell quoting rules apply to it.

# Last path segment, with stray shell quote marks stripped.
def base:
  if . == null or . == "" then ""
  else (gsub("[\"']"; "") | split("/") | last)
  end;

# First real word of a shell command, skipping leading VAR=value assignments.
def cmdword:
  (. // "")
  | gsub("\\s+"; " ")
  | split(" ")
  | map(select(length > 0))
  | map(select(test("^[A-Za-z_][A-Za-z0-9_]*=") | not))
  | (.[0] // "")
  | base;

(.tool_name // "") as $t
| (.tool_input // {}) as $i
| if   $t == "Read"         then "读 " + ($i.file_path | base)
  elif $t == "Edit"         then "改 " + ($i.file_path | base)
  elif $t == "Write"        then "写 " + ($i.file_path | base)
  elif $t == "NotebookEdit" then "改 " + ($i.notebook_path | base)
  elif $t == "Bash"         then "跑 " + ($i.command | cmdword)
  elif $t == "Grep"         then "搜 " + (($i.pattern // "") | .[0:12])
  elif $t == "Glob"         then "找文件"
  elif $t == "WebFetch"     then "上网查"
  elif $t == "WebSearch"    then "上网查"
  elif $t == "Task"         then "派活给小弟"
  elif $t == "TodoWrite"    then "理待办"
  elif $t == "Skill"        then "翻技能书"
  elif ($t | startswith("mcp__")) then "调 " + ($t | split("__") | last)
  else ($t // "")
  end
