# "<completed> <total>" from a TodoWrite payload, or empty when there is no list.
(.tool_input.todos // []) as $t
| if ($t | length) == 0 then ""
  else "\([$t[] | select(.status == "completed")] | length) \($t | length)"
  end
