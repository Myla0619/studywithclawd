// Myla 的一天 — 视图层，页面自己就是完整的 app。
//
// 为什么不是「脚本画一张、页面显示一张」：
// 往「已经弹出来的」WebView 里 evaluateJavaScript 送数据是送不到的，第一版就栽在这——
// render 从没跑过所以白屏，脚本还在等一条永远不会来的消息所以一直转圈。
// 现在数据在 loadHTML 之前就写进页面，点击也在页面内直接生效，脚本完全不参与交互。
//
// 存盘：每次操作往 LOG 里记一条，带自己的时间戳。关掉窗口之后脚本读 LOG 回放。
// 所以「14:00 切成学习、14:30 才关窗口」记下来的仍然是 14:00，晚存不影响准确性。
//
// 代价：24 小时圆环在这里用 SVG 又画了一遍（脚本那份给小组件用）。圆环几何很简单
// ——每段就是一天里的起止比例——但这确实是两份实现，改配色要记得两边都改。
// Clawd 还是脚本画的，按状态预生成成图片传过来。
//
// 页面里的 JS 一律不用反引号和 ${}，因为整个文件是被模板字符串包着的。

module.exports.HTML = `
<!DOCTYPE html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<style>
:root {
  --bg: #F2EEE9; --card: #FFFFFF; --ink: #2A2622;
  --dim: rgba(42,38,34,.5); --faint: rgba(42,38,34,.28);
  --line: rgba(42,38,34,.08); --fill: rgba(42,38,34,.05);
  --bar: rgba(255,255,255,.82); --green: #58C04A;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131017; --card: #1E1A24; --ink: #F6F1EC;
    --dim: rgba(246,241,236,.5); --faint: rgba(246,241,236,.28);
    --line: rgba(246,241,236,.09); --fill: rgba(246,241,236,.07);
    --bar: rgba(30,26,36,.82); --green: #7DD73C;
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body {
  background: var(--bg); color: var(--ink);
  font: 400 17px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased; overscroll-behavior: none;
}
body { padding-bottom: calc(70px + env(safe-area-inset-bottom)); }

header { padding: calc(env(safe-area-inset-top) + 14px) 20px 6px; }
h1 { font: 700 30px/1.2 -apple-system, system-ui; letter-spacing: -.5px; }
header .sub { color: var(--dim); font-size: 14px; margin-top: 3px; }
main { padding: 8px 16px 24px; }

.card {
  background: var(--card); border-radius: 20px; padding: 16px;
  margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
.card h2 {
  font: 600 13px/1 -apple-system, system-ui; letter-spacing: .3px;
  color: var(--dim); margin: 2px 4px 12px;
}

nav {
  position: fixed; left: 0; right: 0; bottom: 0; display: flex;
  background: var(--bar); backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: .5px solid var(--line); padding-bottom: env(safe-area-inset-bottom);
}
nav button {
  flex: 1; background: none; border: 0; color: var(--faint);
  font: 500 11px/1 -apple-system, system-ui; padding: 9px 0 7px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
nav button .g { font-size: 21px; line-height: 1; }
nav button.on { color: var(--ink); }

/* ---------------------------------------------------------------- 圆盘 */
.dialwrap { position: relative; width: 100%; max-width: 306px; margin: 4px auto 0; }
.dialwrap svg { display: block; width: 100%; height: auto; }
.dialface {
  position: absolute; inset: 26%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 2px; pointer-events: none;
}
.dialface img { width: 58%; max-width: 108px; display: block; }
.dialface .nm { color: #F6F1EC; font: 700 19px/1.1 -apple-system, system-ui; margin-top: 2px; }
.dialface .ln { color: rgba(246,241,236,.55); font-size: 13px; }

/* ---------------------------------------------------------------- 状态格 */
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.act {
  display: flex; align-items: center; gap: 9px; padding: 11px 12px;
  background: var(--fill); border: 1.5px solid transparent; border-radius: 15px;
  font-size: 16px; overflow: hidden;
}
.act .d { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.act .n { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.act .t { font-size: 12px; color: var(--faint); flex: none; font-variant-numeric: tabular-nums; }
.act.on { border-color: currentColor; background: transparent; font-weight: 600; }
.act:active { opacity: .55; }

/* ---------------------------------------------------------------- 清单 */
.todo { display: flex; align-items: flex-start; gap: 12px; padding: 12px 4px; border-top: .5px solid var(--line); }
.todo:first-of-type { border-top: 0; }
.todo .box {
  width: 23px; height: 23px; border-radius: 50%; flex: none; margin-top: 1px;
  border: 2px solid var(--faint); display: flex; align-items: center; justify-content: center;
  font-size: 13px; color: #fff; transition: background .15s, border-color .15s;
}
.todo.done .box { background: var(--green); border-color: var(--green); }
.todo .txt { flex: 1; font-size: 16px; line-height: 1.35; word-break: break-word; }
.todo.done .txt { color: var(--faint); text-decoration: line-through; }
.todo .at { font-size: 12px; color: var(--faint); flex: none; margin-top: 3px; font-variant-numeric: tabular-nums; }
.addrow { display: flex; align-items: center; gap: 10px; padding: 12px 4px 4px; border-top: .5px solid var(--line); }
.addrow input {
  flex: 1; border: 0; background: none; color: var(--ink);
  font: 400 16px -apple-system, system-ui; outline: none;
}
.addrow input::placeholder { color: var(--faint); }
.addrow .plus { color: var(--green); font-size: 21px; line-height: 1; }
.carry { text-align: center; color: var(--dim); font-size: 14px; padding: 12px 4px 2px; border-top: .5px solid var(--line); }

/* ---------------------------------------------------------------- 切换器 */
.seg { display: flex; background: var(--fill); border-radius: 11px; padding: 2.5px; gap: 2px; margin-bottom: 10px; }
.seg button {
  flex: 1; border: 0; background: none; color: var(--dim); border-radius: 8.5px;
  font: 500 14px -apple-system, system-ui; padding: 7px 0;
}
.seg button.on { background: var(--card); color: var(--ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,.12); }

/* ---------------------------------------------------------------- 柱状图 */
.bars { display: flex; align-items: flex-end; gap: 2px; height: 148px; padding: 4px 0 0; }
.bars .col { flex: 1; display: flex; flex-direction: column-reverse; border-radius: 2px; overflow: hidden; min-width: 0; }
.bars .col.blank { background: var(--fill); height: 3px !important; align-self: flex-end; border-radius: 2px; }
.bars .col i { display: block; width: 100%; }
.note { text-align: center; color: var(--faint); font-size: 12.5px; padding: 8px 0 2px; }

/* ---------------------------------------------------------------- 列表 */
.row { display: flex; align-items: center; gap: 10px; padding: 13px 4px; border-top: .5px solid var(--line); }
.row:first-of-type { border-top: 0; }
.row .d { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.row .n { flex: 1; font-size: 16px; min-width: 0; }
.row .p { font-size: 13px; color: var(--faint); width: 40px; flex: none; text-align: right; font-variant-numeric: tabular-nums; }
.row .v { font-size: 14px; color: var(--dim); text-align: right; white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
.row .chev { color: var(--faint); font-size: 15px; }
.stat { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 11px 4px; border-top: .5px solid var(--line); }
.stat:first-of-type { border-top: 0; }
.stat .k { color: var(--dim); font-size: 14.5px; flex: none; }
.stat .v { font-size: 16px; font-weight: 500; text-align: right; font-variant-numeric: tabular-nums; }
.warn { border-radius: 14px; padding: 12px 14px; font-size: 13.5px; line-height: 1.4; margin-bottom: 12px; }
.link { color: var(--ink); font-size: 16px; padding: 14px 4px; border-top: .5px solid var(--line); display: flex; justify-content: space-between; gap: 12px; }
.link:first-of-type { border-top: 0; }
.link .h { color: var(--faint); font-size: 14px; white-space: nowrap; }
.empty { text-align: center; color: var(--faint); font-size: 14px; padding: 22px 0; }

/* ---------------------------------------------------------------- 弹层 */
.sheet { position: fixed; inset: 0; z-index: 20; display: none; background: rgba(0,0,0,.42); align-items: flex-end; }
.sheet.open { display: flex; }
.sheet .inner {
  background: var(--bg); width: 100%; max-height: 88vh; overflow-y: auto;
  border-radius: 22px 22px 0 0; padding: 10px 16px calc(24px + env(safe-area-inset-bottom));
  animation: up .28s cubic-bezier(.32,.72,0,1);
}
@keyframes up { from { transform: translateY(100%) } }
.grip { width: 36px; height: 5px; border-radius: 3px; background: var(--faint); margin: 0 auto 14px; }
.sheet h3 { font: 700 22px/1.25 -apple-system, system-ui; margin: 0 4px 14px; }
.tip { color: var(--dim); font-size: 14px; margin: -8px 4px 14px; line-height: 1.45; }
</style>

<header><h1>Myla 的一天</h1><div class="sub" id="sub"></div></header>
<main id="view"></main>
<nav>
  <button id="tab-today" onclick="setTab('today')"><span class="g">◷</span>今天</button>
  <button id="tab-stats" onclick="setTab('stats')"><span class="g">◔</span>统计</button>
  <button id="tab-more"  onclick="setTab('more')"><span class="g">⋯</span>别的</button>
</nav>
<div class="sheet" id="sheet" onclick="tapOut(event)">
  <div class="inner" onclick="event.stopPropagation()">
    <div class="grip" onclick="closeSheet()"></div>
    <div id="sheetBody"></div>
  </div>
</div>

<script>
// ---------------------------------------------------------------- 状态
var P = null                                  // 脚本传进来的数据
var S = { tab: "today", sheet: null, pending: null }
var LOG = []                                  // 关窗口时脚本读这个回放
window.LOG = LOG

var SPANS = [["周", 7], ["月", 30], ["3个月", 90]]
var CHARTS = [["柱状", "bar"], ["圆盘", "dial"]]

function log(t, v, v2) { LOG.push({ t: t, v: v, v2: v2, at: Date.now() }) }
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function nowSec() { return Math.floor(Date.now() / 1000) }
function hhmm(secs) {
  var m = Math.round(secs / 60)
  return m >= 60 ? Math.floor(m / 60) + " 小时 " + (m % 60) + " 分" : m + " 分钟"
}
function clock(s) {
  var d = new Date(s * 1000)
  return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2)
}
function actOf(id) {
  for (var i = 0; i < P.activities.length; i++) if (P.activities[i].id === id) return P.activities[i]
  return { id: id, name: id, hex: "#6B6B70" }
}
function openSeg() {
  for (var i = P.segs.length - 1; i >= 0; i--) if (P.segs[i].e == null) return P.segs[i]
  return null
}
function todayTotals() {
  var t = {}
  for (var i = 0; i < P.segs.length; i++) {
    var s = P.segs[i]
    var end = s.e == null ? nowSec() : s.e
    t[s.a] = (t[s.a] || 0) + Math.max(0, end - s.s)
  }
  return t
}

window.boot = function (payload) {
  P = payload
  S.span = P.span; S.chart = P.chart
  document.getElementById("sub").textContent = P.sub
  draw()
}

function setTab(t) { S.tab = t; S.sheet = null; draw() }

function draw() {
  var names = ["today", "stats", "more"]
  for (var i = 0; i < names.length; i++) {
    document.getElementById("tab-" + names[i]).className = names[i] === S.tab ? "on" : ""
  }
  var v = document.getElementById("view")
  v.innerHTML = S.tab === "today" ? viewToday() : S.tab === "stats" ? viewStats() : viewMore()
  var sh = document.getElementById("sheet")
  if (S.sheet) { document.getElementById("sheetBody").innerHTML = S.sheet; sh.className = "sheet open" }
  else sh.className = "sheet"
}

// ---------------------------------------------------------------- 24 小时圆环
// 跟脚本里 drawDial 同一套几何：0 点在正上方顺时针，每段就是一天里的起止比例。
function ringPath(cx, cy, rIn, rOut, t0, t1) {
  if (t1 - t0 >= 0.5) {                       // SVG 的弧画不了半圈以上，劈成两半
    var mid = (t0 + t1) / 2
    return ringPath(cx, cy, rIn, rOut, t0, mid) + " " + ringPath(cx, cy, rIn, rOut, mid, t1)
  }
  var a0 = t0 * 2 * Math.PI - Math.PI / 2, a1 = t1 * 2 * Math.PI - Math.PI / 2
  function pt(a, r) { return (cx + Math.cos(a) * r).toFixed(2) + " " + (cy + Math.sin(a) * r).toFixed(2) }
  return "M" + pt(a0, rOut) + " A" + rOut + " " + rOut + " 0 0 1 " + pt(a1, rOut)
    + " L" + pt(a1, rIn) + " A" + rIn + " " + rIn + " 0 0 0 " + pt(a0, rIn) + " Z"
}

function dialSVG() {
  var N = 300, cx = 150, cy = 150, rOut = 149, rIn = rOut * 0.74
  var h = '<svg viewBox="0 0 ' + N + ' ' + N + '">'
  h += '<circle cx="150" cy="150" r="150" fill="#1B1720"/>'
  h += '<path d="' + ringPath(cx, cy, rIn, rOut, 0, 1) + '" fill="#FFFFFF" fill-opacity=".07"/>'
  for (var i = 0; i < P.segs.length; i++) {
    var s = P.segs[i]
    var t0 = Math.min(1, Math.max(0, (s.s - P.dayStart) / 86400))
    var t1 = Math.min(1, Math.max(0, ((s.e == null ? nowSec() : s.e) - P.dayStart) / 86400))
    if (t1 <= t0) continue
    h += '<path d="' + ringPath(cx, cy, rIn, rOut, t0, t1) + '" fill="' + actOf(s.a).hex + '"/>'
  }
  for (var k = 0; k < 24; k += 3) {                      // 三小时一个刻度
    var a = k / 24 * 2 * Math.PI - Math.PI / 2
    var r0 = rIn - 3.6, r1 = rIn - 13.5
    h += '<line x1="' + (cx + Math.cos(a) * r0).toFixed(2) + '" y1="' + (cy + Math.sin(a) * r0).toFixed(2)
      + '" x2="' + (cx + Math.cos(a) * r1).toFixed(2) + '" y2="' + (cy + Math.sin(a) * r1).toFixed(2)
      + '" stroke="#FFFFFF" stroke-opacity="' + (k === 0 ? ".45" : ".18") + '" stroke-width="1.8"/>'
  }
  return h + '</svg>'
}

function viewToday() {
  var t = todayTotals(), open = openSeg()
  var acc = 0
  for (var k in t) acc += t[k]

  var h = ""
  if (P.warn) {
    h += '<div class="warn" style="background:' + P.warn.hex + '22;color:' + P.warn.hex + '">'
      + esc(P.warn.text) + '</div>'
  }

  var a = open ? actOf(open.a) : null
  h += '<div class="dialwrap">' + dialSVG() + '<div class="dialface">'
    + '<img src="' + (P.clawd[open ? open.a : "_"] || P.clawd["_"]) + '">'
    + (a ? '<div class="nm">' + esc(a.name) + '</div>'
         + '<div class="ln">已经 ' + hhmm(nowSec() - open.s) + '</div>' : "")
    + '</div></div>'
  h += '<div class="note" style="padding-bottom:14px">今天已记录 ' + hhmm(acc) + '</div>'

  // 睡着了没人能替你点，长得离谱的一段主动问一句
  if (open && nowSec() - open.s > 4 * 3600) {
    h += '<div class="card" style="color:#F99243;font-size:14.5px" onclick="askSplit(\\'' + open.id + '\\')">'
      + '✂︎ 这一段已经 ' + hhmm(nowSec() - open.s) + '，中间换过吗？</div>'
  }

  h += '<div class="card"><h2>现在在做</h2><div class="grid">'
  for (var i = 0; i < P.activities.length; i++) {
    var x = P.activities[i], on = open && open.a === x.id
    h += '<div class="act' + (on ? " on" : "") + '"' + (on ? ' style="color:' + x.hex + '"' : "")
      + ' onclick="switchTo(\\'' + x.id + '\\')">'
      + '<i class="d" style="background:' + x.hex + '"></i>'
      + '<span class="n"' + (on ? ' style="color:var(--ink)"' : "") + '>' + esc(x.name) + '</span>'
      + (t[x.id] ? '<span class="t">' + hhmm(t[x.id]) + '</span>' : "")
      + '</div>'
  }
  h += '</div></div>'

  var left = 0
  for (var j = 0; j < P.todos.length; j++) if (!P.todos[j].done) left++
  h += '<div class="card"><h2>' + (left ? "今天要做的 · 还剩 " + left + " 条" : "今天要做的") + '</h2>'
  var sorted = P.todos.slice().sort(function (m, n) { return (m.done ? 1 : 0) - (n.done ? 1 : 0) })
  for (var q = 0; q < sorted.length; q++) {
    var it = sorted[q]
    h += '<div class="todo' + (it.done ? " done" : "") + '">'
      + '<div class="box" onclick="toggleTodo(\\'' + it.id + '\\')">' + (it.done ? "✓" : "") + '</div>'
      + '<div class="txt" onclick="editTodo(\\'' + it.id + '\\')">' + esc(it.text) + '</div>'
      + (it.done && it.doneAt ? '<div class="at">' + clock(Math.floor(it.doneAt / 1000)) + '</div>' : "")
      + '</div>'
  }
  h += '<div class="addrow"><span class="plus">＋</span>'
    + '<input id="newTodo" placeholder="加一条" enterkeyhint="done"'
    + ' onkeydown="if(event.key===\\'Enter\\'){addTodo();event.preventDefault()}" onblur="addTodo()"></div>'
  if (!P.todos.length && P.carry) {
    h += '<div class="carry" onclick="carryOver()">昨天还剩 ' + P.carry + ' 条，搬过来？</div>'
  }
  return h + '</div>'
}

// ---------------------------------------------------------------- 今天的操作
function switchTo(id) {
  var open = openSeg()
  if (open && open.a === id) return
  var t = nowSec()
  if (open) open.e = t
  P.segs.push({ id: "l" + LOG.length + "" + t, a: id, s: t, e: null })
  log("switch", id)
  draw()
}
function toggleTodo(id) {
  for (var i = 0; i < P.todos.length; i++) if (P.todos[i].id === id) {
    P.todos[i].done = !P.todos[i].done
    P.todos[i].doneAt = P.todos[i].done ? Date.now() : null
    log("todo.toggle", id)
  }
  draw()
}
function addTodo() {
  var el = document.getElementById("newTodo")
  if (!el) return
  var v = el.value.trim()
  el.value = ""
  if (!v) return
  var id = "n" + LOG.length + "" + Date.now()
  P.todos.push({ id: id, text: v, done: false })
  log("todo.add", v, id)
  draw()
}
function carryOver() { log("todo.carry"); P.carry = 0; alertSaved("下次打开就在了"); }
function editTodo(id) {
  var cur = ""
  for (var i = 0; i < P.todos.length; i++) if (P.todos[i].id === id) cur = P.todos[i].text
  S.sheet = '<h3>改这一条</h3>'
    + '<div class="card"><div class="addrow" style="border:0;padding:4px">'
    + '<input id="si" value="' + esc(cur) + '" enterkeyhint="done"'
    + ' onkeydown="if(event.key===\\'Enter\\'){saveTodo(\\'' + id + '\\');event.preventDefault()}"></div></div>'
    + '<div class="card"><div class="link" style="color:var(--green)" onclick="saveTodo(\\'' + id + '\\')">'
    + '<span>改好了</span><span></span></div>'
    + '<div class="link" style="color:#F2363C" onclick="delTodo(\\'' + id + '\\')">'
    + '<span>删掉</span><span></span></div></div>'
  draw()
  focusInput()
}
function saveTodo(id) {
  var el = document.getElementById("si")
  var v = el ? el.value.trim() : ""
  if (v) {
    for (var i = 0; i < P.todos.length; i++) if (P.todos[i].id === id) P.todos[i].text = v
    log("todo.save", v, id)
  }
  S.sheet = null; draw()
}
function delTodo(id) {
  P.todos = P.todos.filter(function (x) { return x.id !== id })
  log("todo.del", id)
  S.sheet = null; draw()
}

// ---------------------------------------------------------------- 统计
function bucketsOf(span) {
  var out = []
  var perWeek = span > 31
  var today = todayTotals()
  function dayTotals(back) {
    if (back === 0) return P.segs.length ? today : null
    var d = new Date(Date.now() - back * 86400000)
    var key = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)
    return P.days[key] || null
  }
  if (!perWeek) {
    for (var back = span - 1; back >= 0; back--) {
      var t = dayTotals(back)
      out.push({ totals: t || {}, has: !!t, cap: 86400 })
    }
    return out
  }
  for (var w = Math.ceil(span / 7) - 1; w >= 0; w--) {
    var totals = {}, has = false
    for (var i = 0; i < 7; i++) {
      var b = w * 7 + i
      if (b >= span) continue
      var d2 = dayTotals(b)
      if (!d2) continue
      has = true
      for (var k in d2) totals[k] = (totals[k] || 0) + d2[k]
    }
    out.push({ totals: totals, has: has, cap: 7 * 86400 })
  }
  return out
}

function barsHTML(bs, onlyID) {
  // 满格 = 一天 8 小时（按周的桶就是一周 8 小时 × 7）
  var full = bs.length && bs[0].cap > 86400 ? 8 * 3600 * 7 : 8 * 3600
  var h = '<div class="bars">'
  for (var i = 0; i < bs.length; i++) {
    var b = bs[i]
    if (!b.has) { h += '<div class="col blank"></div>'; continue }
    if (onlyID) {
      var secs = b.totals[onlyID] || 0
      var pct = Math.max(1.5, Math.min(100, secs / full * 100))
      h += '<div class="col" style="height:' + pct.toFixed(1) + '%">'
        + '<i style="height:100%;background:' + actOf(onlyID).hex + '"></i></div>'
      continue
    }
    var used = 0
    for (var k in b.totals) used += b.totals[k]
    var inner = ""
    for (var j = 0; j < P.activities.length; j++) {
      var a = P.activities[j], s = b.totals[a.id] || 0
      if (!s) continue
      inner += '<i style="height:' + (s / used * 100).toFixed(2) + '%;background:' + a.hex + '"></i>'
    }
    h += '<div class="col" style="height:' + (used / b.cap * 100).toFixed(1) + '%">' + inner + '</div>'
  }
  return h + '</div>'
}

function donutHTML(agg) {
  var total = 0
  for (var k in agg) total += agg[k]
  var N = 300, cx = 150, cy = 150, rOut = 128, rIn = 79
  var h = '<svg viewBox="0 0 ' + N + ' ' + N + '" style="max-width:300px;margin:0 auto;display:block">'
  h += '<rect width="300" height="300" rx="26" fill="#1B1720"/>'
  h += '<path d="' + ringPath(cx, cy, rIn, rOut, 0, 1) + '" fill="#FFFFFF" fill-opacity=".07"/>'
  var ranked = P.activities.filter(function (a) { return agg[a.id] > 0 })
    .sort(function (x, y) { return agg[y.id] - agg[x.id] })
  var t = 0
  for (var i = 0; i < ranked.length; i++) {
    var f = agg[ranked[i].id] / total
    h += '<path d="' + ringPath(cx, cy, rIn, rOut, t, t + f) + '" fill="' + ranked[i].hex + '"/>'
    t += f
  }
  h += '<text x="150" y="152" text-anchor="middle" fill="#F6F1EC" font-size="34" font-weight="700"'
    + ' font-family="-apple-system,system-ui">' + (total ? Math.round(total / 3600) + " 小时" : "没有记录") + '</text>'
  return h + '</svg>'
}

function viewStats() {
  var bs = bucketsOf(S.span)
  var agg = {}, total = 0
  for (var i = 0; i < bs.length; i++) for (var k in bs[i].totals) agg[k] = (agg[k] || 0) + bs[i].totals[k]
  for (var q in agg) total += agg[q]

  var recorded = 0
  for (var back = 0; back < S.span; back++) {
    if (back === 0) { if (P.segs.length) recorded++; continue }
    var d = new Date(Date.now() - back * 86400000)
    var key = d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2)
    if (P.days[key]) recorded++
  }

  var h = '<div class="card">' + segHTML(SPANS, S.span, "setSpan") + segHTML(CHARTS, S.chart, "setChart")
  if (S.chart === "dial") {
    var from = new Date(Date.now() - (S.span - 1) * 86400000)
    h += donutHTML(agg)
    h += '<div class="note">' + (from.getMonth() + 1) + '月' + from.getDate() + '日 起 · 有记录 ' + recorded + ' 天</div>'
  } else {
    h += barsHTML(bs, null)
    h += '<div class="note">' + (S.span > 31 ? "一根柱子是一周" : "一根柱子是一天")
      + '，' + S.span + ' 天里有记录的 ' + recorded + ' 天</div>'
  }
  h += '</div>'

  h += '<div class="card"><h2>点开看单项</h2>'
  var ranked = P.activities.filter(function (a) { return (agg[a.id] || 0) >= 60 })
    .sort(function (x, y) { return agg[y.id] - agg[x.id] })
  if (!ranked.length) h += '<div class="empty">这段时间还没有记录</div>'
  for (var r = 0; r < ranked.length; r++) {
    var a = ranked[r]
    h += '<div class="row" onclick="showDetail(\\'' + a.id + '\\')">'
      + '<i class="d" style="background:' + a.hex + '"></i>'
      + '<span class="n">' + esc(a.name) + '</span>'
      + '<span class="p">' + (total ? Math.round(agg[a.id] / total * 100) + "%" : "") + '</span>'
      + '<span class="v">' + hhmm(agg[a.id]) + '</span><span class="chev">›</span></div>'
  }
  return h + '</div>'
}

function segHTML(opts, cur, fn) {
  var h = '<div class="seg">'
  for (var i = 0; i < opts.length; i++) {
    h += '<button class="' + (opts[i][1] === cur ? "on" : "") + '" onclick="' + fn
      + '(' + JSON.stringify(opts[i][1]) + ')">' + esc(opts[i][0]) + '</button>'
  }
  return h + '</div>'
}
function setSpan(v) { S.span = v; log("span", v); draw() }
function setChart(v) { S.chart = v; log("chart", v); draw() }

function showDetail(id) {
  var a = actOf(id), bs = bucketsOf(S.span), weekly = S.span > 31
  var total = 0, withAny = 0
  for (var i = 0; i < bs.length; i++) {
    var s = bs[i].totals[id] || 0
    total += s
    if (s > 0) withAny++
  }
  var h = '<h3>' + esc(a.name) + '</h3>'
  h += '<div class="card">' + barsHTML(bs, id)
    + '<div class="note">近 ' + S.span + ' 天，' + (weekly ? "一根柱子是一周" : "一根柱子是一天") + '</div></div>'
  h += '<div class="card">'
    + stat("总计", hhmm(total))
    + stat(weekly ? "有记录的周平均" : "有记录的天平均", withAny ? hhmm(total / withAny) : "—")
    + stat(weekly ? "出现过的周" : "出现过的天", withAny + " / " + bs.length)
    + '</div>'

  var mine = P.segs.filter(function (s) { return s.a === id })
  h += '<div class="card"><h2>今天的时段（点一段可以拆开）</h2>'
  if (!mine.length) h += '<div class="empty">今天还没有</div>'
  for (var j = 0; j < mine.length; j++) {
    var s2 = mine[j]
    h += '<div class="row" onclick="askSplit(\\'' + s2.id + '\\')">'
      + '<span class="n" style="color:' + a.hex + '">' + clock(s2.s) + ' – '
      + (s2.e == null ? "现在" : clock(s2.e)) + '</span>'
      + '<span class="v">' + hhmm((s2.e == null ? nowSec() : s2.e) - s2.s) + '</span></div>'
  }
  S.sheet = h + '</div>'
  draw()
}
function stat(k, v) {
  return '<div class="stat"><span class="k">' + esc(k) + '</span><span class="v">' + esc(v) + '</span></div>'
}

// ---------------------------------------------------------------- 拆分
function askSplit(segID) {
  var seg = null
  for (var i = 0; i < P.segs.length; i++) if (P.segs[i].id === segID) seg = P.segs[i]
  if (!seg) return
  var end = seg.e == null ? nowSec() : seg.e
  S.pending = segID
  S.sheet = '<h3>' + clock(seg.s) + ' – ' + (seg.e == null ? "现在" : clock(seg.e)) + '</h3>'
    + '<div class="tip">从几点起换成别的了？填了之后选后半段是什么。</div>'
    + '<div class="card"><div class="addrow" style="border:0;padding:4px">'
    + '<input id="si" placeholder="比如 23:30" value="' + clock(Math.floor((seg.s + end) / 2)) + '"'
    + ' onkeydown="if(event.key===\\'Enter\\'){splitNext();event.preventDefault()}"></div></div>'
    + '<div class="card"><div class="link" style="color:var(--green)" onclick="splitNext()">'
    + '<span>下一步</span><span></span></div></div>'
  draw()
  focusInput()
}
function splitNext() {
  var el = document.getElementById("si")
  var raw = el ? el.value.trim() : ""
  var m = raw.match(/^(\\d{1,2})[:：](\\d{2})$/)
  var seg = null
  for (var i = 0; i < P.segs.length; i++) if (P.segs[i].id === S.pending) seg = P.segs[i]
  if (!seg) { closeSheet(); return }
  var end = seg.e == null ? nowSec() : seg.e
  if (!m) return alertSheet("时间要写成 23:30 这样")
  var base = new Date(seg.s * 1000)
  base.setHours(Number(m[1]), Number(m[2]), 0, 0)
  var when = Math.floor(base.getTime() / 1000)
  if (when <= seg.s) when += 86400          // 跨零点的段
  if (when <= seg.s || when >= end) return alertSheet("这个时间不在这一段里")

  var h = '<h3>后半段是什么？</h3><div class="card">'
  for (var j = 0; j < P.activities.length; j++) {
    var a = P.activities[j]
    h += '<div class="link" onclick="doSplit(' + when + ',\\'' + a.id + '\\')">'
      + '<span style="color:' + a.hex + '">' + esc(a.name) + '</span><span></span></div>'
  }
  S.sheet = h + '</div>'
  draw()
}
function doSplit(when, laterID) {
  var i = -1
  for (var k = 0; k < P.segs.length; k++) if (P.segs[k].id === S.pending) i = k
  if (i < 0) { closeSheet(); return }
  var old = P.segs[i]
  P.segs.splice(i + 1, 0, { id: "s" + when, a: laterID, s: when, e: old.e })
  // 记起点而不是 id：页面里新开的那些段 id 是页面自己编的，脚本回放时对不上号，
  // 起点秒数两边一定一致。
  log("split", old.s, { when: when, later: laterID })
  old.e = when
  S.pending = null; S.sheet = null
  draw()
}
function alertSheet(msg) {
  var b = document.getElementById("sheetBody")
  if (b) b.insertAdjacentHTML("afterbegin",
    '<div class="warn" style="background:#F2363C22;color:#F2363C">' + esc(msg) + '</div>')
}

// ---------------------------------------------------------------- 别的
function viewMore() {
  var h = '<div class="card">'
    + '<div class="link" onclick="manage()"><span>管理状态</span><span class="h">'
    + P.activities.length + ' 个 ›</span></div>'
    + '<div class="link" onclick="nudge()"><span>定时问一句</span><span class="h">'
    + (P.nudge === 0 ? "关着" : P.nudge + " 分钟") + ' ›</span></div>'
    + '<div class="link" onclick="wantExport()"><span>导出一份备份</span><span class="h">存到「文件」›</span></div>'
    + '</div>'
  h += '<div class="note">版本 ' + esc(P.version) + '</div>'
  h += '<div class="note" style="padding-top:14px;line-height:1.5">改动在你关掉这个窗口时存盘，<br>每条都带自己发生的时间，晚存不影响记录</div>'
  return h
}
function manage() {
  var h = '<h3>管理状态</h3><div class="card">'
  for (var i = 0; i < P.activities.length; i++) {
    var a = P.activities[i]
    h += '<div class="link" onclick="editAct(\\'' + a.id + '\\')">'
      + '<span style="color:' + a.hex + '">' + esc(a.name) + '</span><span class="h">›</span></div>'
  }
  h += '<div class="link" style="color:var(--green)" onclick="newAct()"><span>＋ 加一个</span><span></span></div>'
  S.sheet = h + '</div>'
  draw()
}
function editAct(id) {
  var a = actOf(id)
  S.sheet = '<h3>' + esc(a.name) + '</h3>'
    + '<div class="card"><div class="addrow" style="border:0;padding:4px">'
    + '<input id="si" value="' + esc(a.name) + '"></div></div>'
    + '<div class="card"><div class="link" style="color:var(--green)" onclick="saveAct(\\'' + id + '\\')">'
    + '<span>改好了</span><span></span></div>'
    + '<div class="link" style="color:#F2363C" onclick="delAct(\\'' + id + '\\')">'
    + '<span>删掉</span><span class="h">已经记下的时段不动</span></div></div>'
  draw(); focusInput()
}
function saveAct(id) {
  var el = document.getElementById("si"), v = el ? el.value.trim() : ""
  if (v) { actOf(id).name = v; log("act.rename", v, id) }
  S.sheet = null; draw()
}
function delAct(id) {
  P.activities = P.activities.filter(function (x) { return x.id !== id })
  log("act.del", id)
  S.sheet = null; draw()
}
function newAct() {
  S.sheet = '<h3>新状态</h3>'
    + '<div class="card"><div class="addrow" style="border:0;padding:4px">'
    + '<input id="si" placeholder="比如「实习」"></div></div>'
    + '<div class="card"><div class="link" style="color:var(--green)" onclick="addAct()">'
    + '<span>加上</span><span></span></div></div>'
  draw(); focusInput()
}
function addAct() {
  var el = document.getElementById("si"), v = el ? el.value.trim() : ""
  if (v) {
    var id = "c" + Date.now()
    P.activities.push({ id: id, name: v, hex: P.palette[P.activities.length % P.palette.length] })
    log("act.add", v, id)
  }
  S.sheet = null; draw()
}
function nudge() {
  var opts = [45, 60, 90, 120, 180]
  var h = '<h3>隔多久问一次？</h3>'
    + '<div class="tip">超过这个时长没换状态就推一条通知，通知上直接能改。</div><div class="card">'
  for (var i = 0; i < opts.length; i++) {
    h += '<div class="link" onclick="setNudge(' + opts[i] + ')"><span>' + opts[i] + ' 分钟</span>'
      + '<span class="h">' + (P.nudge === opts[i] ? "现在是这个" : "") + '</span></div>'
  }
  h += '<div class="link" style="color:#F2363C" onclick="setNudge(0)"><span>关掉提醒</span><span></span></div>'
  S.sheet = h + '</div>'
  draw()
}
function setNudge(v) { P.nudge = v; log("nudge", v); S.sheet = null; draw() }
function wantExport() {
  log("export")
  S.sheet = '<h3>关掉窗口就会弹出保存框</h3>'
    + '<div class="tip">导出要用系统的「文件」选择器，它盖不到这个窗口上面，'
    + '所以得等这个窗口关掉。往下滑关掉就行。</div>'
  draw()
}
function alertSaved(msg) {
  S.sheet = '<h3>' + esc(msg) + '</h3><div class="tip">改动在关掉窗口时存盘。</div>'
  draw()
}

// ---------------------------------------------------------------- 倒数日
// 按「天」算不按 24 小时算：今晚 23:00 到明早 8:00 是「明天」，不是「还有 9 小时」。
// 每年重复的自动滚到下一次。这段跟脚本里的 untilDays 是同一套算法。
function cdDays(cd) {
  var m = String(cd.date || "").match(/^(\\d{4})-(\\d{2})-(\\d{2})$/)
  if (!m) return null
  var today = new Date(); today.setHours(0, 0, 0, 0)
  var target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  if (cd.yearly) {
    target = new Date(today.getFullYear(), Number(m[2]) - 1, Number(m[3]))
    if (target < today) target = new Date(today.getFullYear() + 1, Number(m[2]) - 1, Number(m[3]))
  }
  return { days: Math.round((target - today) / 86400000), when: target }
}
function cdSorted() {
  var out = []
  for (var i = 0; i < P.countdowns.length; i++) {
    var u = cdDays(P.countdowns[i])
    if (u) out.push({ cd: P.countdowns[i], days: u.days, when: u.when })
  }
  out.sort(function (a, b) {
    if ((a.days < 0) !== (b.days < 0)) return a.days < 0 ? 1 : -1
    return a.days < 0 ? b.days - a.days : a.days - b.days
  })
  return out
}
function cdList() {
  var list = cdSorted()
  var h = '<h3>倒数日</h3><div class="tip">记着的日子会显示在大号小组件右边。</div><div class="card">'
  if (!list.length) h += '<div class="empty">还没有记着的日子</div>'
  var W = ["日", "一", "二", "三", "四", "五", "六"]
  for (var i = 0; i < list.length; i++) {
    var x = list[i], d = x.when, past = x.days < 0
    h += '<div class="row" onclick="cdEdit(\\'' + x.cd.id + '\\')">'
      + '<i class="d" style="background:' + x.cd.hex + '"></i>'
      + '<span class="n">' + esc(x.cd.name) + '<br>'
      + '<span style="font-size:12.5px;color:var(--faint)">'
      + (past ? "已过 · " : "") + (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + W[d.getDay()]
      + (x.cd.yearly ? " · 每年" : "") + '</span></span>'
      + '<span class="v" style="font-size:19px;font-weight:700;color:'
      + (past ? "var(--faint)" : "var(--ink)") + '">'
      + (x.days === 0 ? "今天" : Math.abs(x.days) + " 天") + '</span>'
      + '<span class="chev">›</span></div>'
  }
  h += '<div class="link" style="color:var(--green)" onclick="cdEdit(null)">'
    + '<span>＋ 记一个日子</span><span></span></div>'
  S.sheet = h + '</div>'
  draw()
}
function cdEdit(id) {
  var cur = null
  for (var i = 0; i < P.countdowns.length; i++) if (P.countdowns[i].id === id) cur = P.countdowns[i]
  S.cdID = id
  S.cdYearly = cur ? !!cur.yearly : false
  var today = new Date()
  var iso = cur ? cur.date : today.getFullYear() + "-"
    + ("0" + (today.getMonth() + 1)).slice(-2) + "-" + ("0" + today.getDate()).slice(-2)
  var h = '<h3>' + (cur ? "改这个日子" : "记一个日子") + '</h3>'
    + '<div class="card"><div class="addrow" style="border:0;padding:4px">'
    + '<input id="cdName" placeholder="叫什么，比如「论文 deadline」" value="' + esc(cur ? cur.name : "") + '"></div>'
    + '<div class="addrow" style="padding:12px 4px 4px">'
    + '<input id="cdDate" type="date" value="' + iso + '" style="color:var(--ink)"></div>'
    + '<div class="link" onclick="toggleYearly()"><span>每年重复</span>'
    + '<span class="h" id="yearlyMark">' + (S.cdYearly ? "开着 ✓" : "关着") + '</span></div>'
    + '<div class="tip" style="margin:8px 4px 0">生日、纪念日这种开着，过完自动滚到明年。</div>'
    + '</div>'
    + '<div class="card"><div class="link" style="color:var(--green)" onclick="cdSave()">'
    + '<span>' + (cur ? "改好了" : "记下") + '</span><span></span></div>'
  if (cur) {
    h += '<div class="link" style="color:#F2363C" onclick="cdDel(\\'' + id + '\\')">'
      + '<span>删掉</span><span></span></div>'
  }
  S.sheet = h + '</div>'
  draw()
  setTimeout(function () { var e = document.getElementById("cdName"); if (e && !cur) e.focus() }, 140)
}
function toggleYearly() {
  S.cdYearly = !S.cdYearly
  var m = document.getElementById("yearlyMark")
  if (m) m.textContent = S.cdYearly ? "开着 ✓" : "关着"
}
function cdSave() {
  var name = (document.getElementById("cdName") || {}).value
  var date = (document.getElementById("cdDate") || {}).value
  name = (name || "").trim()
  if (!name || !date) return alertSheet("名字和日期都要填")
  if (S.cdID) {
    for (var i = 0; i < P.countdowns.length; i++) if (P.countdowns[i].id === S.cdID) {
      P.countdowns[i].name = name
      P.countdowns[i].date = date
      P.countdowns[i].yearly = S.cdYearly
    }
    log("cd.save", { name: name, date: date, yearly: S.cdYearly }, S.cdID)
  } else {
    var id = "d" + Date.now()
    var hex = nextHex()
    P.countdowns.push({ id: id, name: name, date: date, yearly: S.cdYearly, hex: hex })
    // 颜色一起记进去，回放时用同一个，不然 app 里和小组件上会对不上
    log("cd.add", { name: name, date: date, yearly: S.cdYearly, hex: hex }, id)
  }
  S.cdID = null
  cdList()
}
/** 挑一个还没被占用的颜色，撞色了两条看起来像一回事。 */
function nextHex() {
  var used = P.countdowns.map(function (c) { return c.hex })
  for (var i = 0; i < P.cdPalette.length; i++) {
    if (used.indexOf(P.cdPalette[i]) < 0) return P.cdPalette[i]
  }
  return P.cdPalette[P.countdowns.length % P.cdPalette.length]
}
function cdDel(id) {
  P.countdowns = P.countdowns.filter(function (x) { return x.id !== id })
  log("cd.del", id)
  cdList()
}

// ---------------------------------------------------------------- 弹层
function closeSheet() { S.sheet = null; S.pending = null; draw() }
function tapOut(e) { if (e.target.id === "sheet") closeSheet() }
function focusInput() {
  var el = document.getElementById("si")
  if (el) setTimeout(function () { el.focus(); el.select() }, 140)
}
</script>
`
