// Myla 的一天 — 视图层。
//
// 这个文件只有长相，一行业务逻辑都没有。页面收到 render(payload) 就画，
// 用户点了什么就 post 回脚本，脚本改完数据再 render 一次。
//
// 所有图（圆盘、柱状、占比环）都是脚本那边用 DrawContext 画好、转成 base64 传过来的，
// 页面只负责 <img> 摆位置。这样绘制代码仍然只有 MylaDayCore 一份，小组件和这里画的是同一个。
//
// 页面里的 JS 一律不用反引号和 ${}，因为整个文件是被模板字符串包着的。

module.exports.HTML = `
<!DOCTYPE html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<style>
:root {
  --bg: #F2EEE9;
  --card: #FFFFFF;
  --ink: #2A2622;
  --dim: rgba(42,38,34,.5);
  --faint: rgba(42,38,34,.28);
  --line: rgba(42,38,34,.08);
  --fill: rgba(42,38,34,.05);
  --bar: rgba(255,255,255,.82);
  --green: #58C04A;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #131017;
    --card: #1E1A24;
    --ink: #F6F1EC;
    --dim: rgba(246,241,236,.5);
    --faint: rgba(246,241,236,.28);
    --line: rgba(246,241,236,.09);
    --fill: rgba(246,241,236,.07);
    --bar: rgba(30,26,36,.82);
    --green: #7DD73C;
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
html, body {
  background: var(--bg); color: var(--ink);
  font: 400 17px/1.4 -apple-system, "SF Pro Text", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}
body { padding-bottom: calc(70px + env(safe-area-inset-bottom)); }

/* ---------------------------------------------------------------- 骨架 */
header {
  padding: calc(env(safe-area-inset-top) + 14px) 20px 6px;
}
h1 { font: 700 30px/1.2 -apple-system, system-ui; letter-spacing: -.5px; }
header .sub { color: var(--dim); font-size: 14px; margin-top: 3px; }
main { padding: 8px 16px 24px; }

.card {
  background: var(--card); border-radius: 20px; padding: 16px;
  margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
.card.tight { padding: 8px 6px; }
.card h2 {
  font: 600 13px/1 -apple-system, system-ui; letter-spacing: .3px;
  color: var(--dim); text-transform: none; margin: 2px 4px 12px;
}

/* ---------------------------------------------------------------- 底部 tab */
nav {
  position: fixed; left: 0; right: 0; bottom: 0; display: flex;
  background: var(--bar); backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-top: .5px solid var(--line);
  padding-bottom: env(safe-area-inset-bottom);
}
nav button {
  flex: 1; background: none; border: 0; color: var(--faint);
  font: 500 11px/1 -apple-system, system-ui; padding: 9px 0 7px;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
}
nav button .g { font-size: 21px; line-height: 1; }
nav button.on { color: var(--ink); }

/* ---------------------------------------------------------------- 圆盘 */
.dial { display: block; width: 100%; max-width: 310px; margin: 4px auto 0; border-radius: 26px;
  box-shadow: 0 8px 24px rgba(0,0,0,.14); }

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
.todo .x { color: var(--faint); font-size: 19px; padding: 0 4px; flex: none; }
.addrow { display: flex; align-items: center; gap: 10px; padding: 12px 4px 4px; border-top: .5px solid var(--line); }
.addrow input {
  flex: 1; border: 0; background: none; color: var(--ink);
  font: 400 16px -apple-system, system-ui; outline: none;
}
.addrow input::placeholder { color: var(--faint); }
.addrow .plus { color: var(--green); font-size: 21px; line-height: 1; }
.carry { text-align: center; color: var(--dim); font-size: 14px; padding: 12px 4px 2px; border-top: .5px solid var(--line); }

/* ---------------------------------------------------------------- 切换器 */
.seg {
  display: flex; background: var(--fill); border-radius: 11px; padding: 2.5px; gap: 2px;
  margin-bottom: 10px;
}
.seg button {
  flex: 1; border: 0; background: none; color: var(--dim); border-radius: 8.5px;
  font: 500 14px -apple-system, system-ui; padding: 7px 0;
}
.seg button.on {
  background: var(--card); color: var(--ink); font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,.12);
}

/* ---------------------------------------------------------------- 统计列表 */
.chart { display: block; width: 100%; margin: 4px 0 2px; }
.chart.donut { max-width: 300px; margin: 0 auto; border-radius: 24px; }
.note { text-align: center; color: var(--faint); font-size: 12.5px; padding: 8px 0 2px; }
.row { display: flex; align-items: center; gap: 10px; padding: 13px 4px; border-top: .5px solid var(--line); }
.row:first-of-type { border-top: 0; }
.row .d { width: 10px; height: 10px; border-radius: 50%; flex: none; }
.row .n { flex: 1; font-size: 16px; min-width: 0; }
.row .p { font-size: 13px; color: var(--faint); width: 40px; flex: none; text-align: right; font-variant-numeric: tabular-nums; }
.row .v { font-size: 14px; color: var(--dim); text-align: right; white-space: nowrap; flex: none; font-variant-numeric: tabular-nums; }
.row .chev { color: var(--faint); font-size: 15px; }

.stat { display: flex; justify-content: space-between; align-items: baseline; padding: 11px 4px; border-top: .5px solid var(--line); }
.stat:first-of-type { border-top: 0; }
.stat .k { color: var(--dim); font-size: 14.5px; }
.stat .v { font-size: 16px; font-weight: 500; font-variant-numeric: tabular-nums; }

.warn { border-radius: 14px; padding: 12px 14px; font-size: 13.5px; line-height: 1.4; margin-bottom: 12px; }
.link { color: var(--dim); font-size: 15px; padding: 13px 4px; border-top: .5px solid var(--line); display: flex; justify-content: space-between; }
.link:first-of-type { border-top: 0; }
.empty { text-align: center; color: var(--faint); font-size: 14px; padding: 22px 0; }

/* ---------------------------------------------------------------- 弹层 */
.sheet {
  position: fixed; inset: 0; z-index: 20; display: none;
  background: rgba(0,0,0,.42); align-items: flex-end;
}
.sheet.open { display: flex; }
.sheet .inner {
  background: var(--bg); width: 100%; max-height: 88vh; overflow-y: auto;
  border-radius: 22px 22px 0 0; padding: 10px 16px calc(24px + env(safe-area-inset-bottom));
  animation: up .28s cubic-bezier(.32,.72,0,1);
}
@keyframes up { from { transform: translateY(100%) } }
.grip { width: 36px; height: 5px; border-radius: 3px; background: var(--faint); margin: 0 auto 14px; }
.sheet h3 { font: 700 22px/1.2 -apple-system, system-ui; margin: 0 4px 14px; }
</style>

<header>
  <h1 id="title">Myla 的一天</h1>
  <div class="sub" id="sub"></div>
</header>
<main id="view"></main>
<nav>
  <button id="tabToday" onclick="go('today')"><span class="g">◷</span>今天</button>
  <button id="tabStats" onclick="go('stats')"><span class="g">◔</span>统计</button>
  <button id="tabMore"  onclick="go('more')"><span class="g">⋯</span>别的</button>
</nav>
<div class="sheet" id="sheet" onclick="closeSheet(event)">
  <div class="inner" onclick="event.stopPropagation()">
    <div class="grip" onclick="closeSheet()"></div>
    <div id="sheetBody"></div>
  </div>
</div>

<script>
// ---------------------------------------------------------------- 通信
// 脚本那边跑 window.__wait(completion) 来等一条消息；页面这边点一下就发一条。
// 没人等的时候先排队，不会丢。
var P = null, send = null, queued = []

function post(msg) {
  if (send) { var f = send; send = null; f(JSON.stringify(msg)) }
  else queued.push(msg)
}
window.__wait = function (completion) {
  if (queued.length) completion(JSON.stringify(queued.shift()))
  else send = completion
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
function go(tab) { post({ t: "tab", v: tab }) }

// ---------------------------------------------------------------- 画
window.render = function (payload) {
  P = payload
  var v = document.getElementById("view")
  document.getElementById("sub").textContent = P.sub || ""
  var tabs = { today: "tabToday", stats: "tabStats", more: "tabMore" }
  for (var k in tabs) document.getElementById(tabs[k]).className = (k === P.tab ? "on" : "")

  if (P.tab === "today") v.innerHTML = viewToday()
  else if (P.tab === "stats") v.innerHTML = viewStats()
  else v.innerHTML = viewMore()

  if (P.sheet) openSheet(P.sheet)
  else document.getElementById("sheet").className = "sheet"
}

function warnHTML() {
  if (!P.warn) return ""
  return '<div class="warn" style="background:' + P.warn.hex + '22;color:' + P.warn.hex + '">'
    + esc(P.warn.text) + '</div>'
}

function viewToday() {
  var h = warnHTML()

  // 圆盘自带深色圆角卡片，外面不用再套一层。中间也已经写了当前状态和已经多久，
  // 底下不再重复一遍。
  h += '<img class="dial" src="' + P.dial + '">'
    + '<div class="note" style="padding-bottom:14px">' + esc(P.acc) + '</div>'

  if (P.split) {
    h += '<div class="card" onclick="post({t:\\'split\\'})" style="color:#F99243;font-size:14.5px">'
      + '✂︎ ' + esc(P.split) + '</div>'
  }

  h += '<div class="card"><h2>现在在做</h2><div class="grid">'
  for (var i = 0; i < P.acts.length; i++) {
    var a = P.acts[i]
    h += '<div class="act' + (a.on ? " on" : "") + '"'
      + (a.on ? ' style="color:' + a.hex + '"' : "")
      + ' onclick="post({t:\\'switch\\',v:\\'' + a.id + '\\'})">'
      + '<i class="d" style="background:' + a.hex + '"></i>'
      + '<span class="n"' + (a.on ? ' style="color:var(--ink)"' : "") + '>' + esc(a.name) + '</span>'
      + (a.len ? '<span class="t">' + esc(a.len) + '</span>' : "")
      + '</div>'
  }
  h += '</div></div>'

  h += '<div class="card"><h2>' + esc(P.todoTitle) + '</h2>'
  for (var j = 0; j < P.todos.length; j++) {
    var it = P.todos[j]
    h += '<div class="todo' + (it.done ? " done" : "") + '">'
      + '<div class="box" onclick="post({t:\\'todo.toggle\\',v:\\'' + it.id + '\\'})">' + (it.done ? "✓" : "") + '</div>'
      + '<div class="txt" onclick="post({t:\\'todo.edit\\',v:\\'' + it.id + '\\'})">' + esc(it.text) + '</div>'
      + (it.at ? '<div class="at">' + esc(it.at) + '</div>' : "")
      + '</div>'
  }
  h += '<div class="addrow"><span class="plus">＋</span>'
    + '<input id="newTodo" placeholder="加一条" enterkeyhint="done"'
    + ' onkeydown="if(event.key===\\'Enter\\'){addTodo();event.preventDefault()}"'
    + ' onblur="addTodo()"></div>'
  if (!P.todos.length && P.carry) {
    h += '<div class="carry" onclick="post({t:\\'todo.carry\\'})">昨天还剩 ' + P.carry + ' 条，搬过来？</div>'
  }
  h += '</div>'
  return h
}

function addTodo() {
  var el = document.getElementById("newTodo")
  if (!el) return
  var v = el.value.trim()
  el.value = ""
  if (v) post({ t: "todo.add", v: v })
}

function viewStats() {
  var h = '<div class="card tight">'
  h += '<div style="padding:4px 6px 0">' + seg(P.spans, P.span, "span") + seg(P.charts, P.chart, "chart") + '</div>'
  h += '<img class="chart' + (P.chart === "dial" ? " donut" : "") + '" src="' + P.chartImg + '">'
  h += '<div class="note">' + esc(P.note) + '</div></div>'

  h += '<div class="card"><h2>点开看单项</h2>'
  if (!P.rows.length) h += '<div class="empty">这段时间还没有记录</div>'
  for (var i = 0; i < P.rows.length; i++) {
    var r = P.rows[i]
    h += '<div class="row" onclick="post({t:\\'detail\\',v:\\'' + r.id + '\\'})">'
      + '<i class="d" style="background:' + r.hex + '"></i>'
      + '<span class="n">' + esc(r.name) + '</span>'
      + '<span class="p">' + esc(r.pct) + '</span>'
      + '<span class="v">' + esc(r.len) + '</span>'
      + '<span class="chev">›</span></div>'
  }
  h += '</div>'
  return h
}

function seg(opts, cur, key) {
  var h = '<div class="seg">'
  for (var i = 0; i < opts.length; i++) {
    h += '<button class="' + (opts[i][1] === cur ? "on" : "") + '"'
      + ' onclick="post({t:\\'' + key + '\\',v:' + JSON.stringify(opts[i][1]) + '})">'
      + esc(opts[i][0]) + '</button>'
  }
  return h + '</div>'
}

function viewMore() {
  var h = '<div class="card">'
  for (var i = 0; i < P.links.length; i++) {
    h += '<div class="link" onclick="post({t:\\'' + P.links[i].t + '\\'})">'
      + '<span>' + esc(P.links[i].label) + '</span>'
      + '<span style="color:var(--faint)">' + esc(P.links[i].hint || "") + ' ›</span></div>'
  }
  h += '</div><div class="note">版本 ' + esc(P.version) + '</div>'
  return h
}

// ---------------------------------------------------------------- 弹层
function openSheet(s) {
  var b = document.getElementById("sheetBody")
  var h = '<h3>' + esc(s.title) + '</h3>'

  if (s.kind === "detail") {
    h += '<div class="card tight"><img class="chart" src="' + s.img + '">'
      + '<div class="note">' + esc(s.note) + '</div></div>'
    h += '<div class="card">'
    for (var i = 0; i < s.stats.length; i++) {
      h += '<div class="stat"><span class="k">' + esc(s.stats[i][0]) + '</span>'
        + '<span class="v">' + esc(s.stats[i][1]) + '</span></div>'
    }
    h += '</div>'
    if (s.spans && s.spans.length) {
      h += '<div class="card"><h2>今天的时段（点一段可以拆开）</h2>'
      for (var j = 0; j < s.spans.length; j++) {
        h += '<div class="row" onclick="post({t:\\'split.seg\\',v:\\'' + s.spans[j].id + '\\'})">'
          + '<span class="n" style="color:' + s.hex + '">' + esc(s.spans[j].when) + '</span>'
          + '<span class="v">' + esc(s.spans[j].len) + '</span></div>'
      }
      h += '</div>'
    }
  }

  if (s.kind === "list") {
    h += '<div class="card">'
    for (var k = 0; k < s.items.length; k++) {
      h += '<div class="link" onclick="post({t:\\'' + s.act + '\\',v:' + JSON.stringify(s.items[k].v) + '})">'
        + '<span' + (s.items[k].hex ? ' style="color:' + s.items[k].hex + '"' : "") + '>'
        + esc(s.items[k].label) + '</span>'
        + '<span style="color:var(--faint)">' + esc(s.items[k].hint || "") + '</span></div>'
    }
    h += '</div>'
  }

  if (s.kind === "input") {
    h += '<div class="card"><div class="addrow" style="border:0;padding:4px">'
      + '<input id="sheetInput" placeholder="' + esc(s.placeholder || "") + '"'
      + ' value="' + esc(s.value || "") + '" enterkeyhint="done"'
      + ' onkeydown="if(event.key===\\'Enter\\'){sheetOK();event.preventDefault()}"></div></div>'
    h += '<div class="card"><div class="link" onclick="sheetOK()" style="color:var(--green)">'
      + '<span>' + esc(s.ok || "好了") + '</span><span></span></div>'
    if (s.destructive) {
      h += '<div class="link" onclick="post({t:\\'' + s.destructive + '\\',v:' + JSON.stringify(s.value2) + '})"'
        + ' style="color:#F2363C"><span>删掉</span><span></span></div>'
    }
    h += '</div>'
  }

  b.innerHTML = h
  document.getElementById("sheet").className = "sheet open"
  var inp = document.getElementById("sheetInput")
  if (inp) setTimeout(function () { inp.focus() }, 120)
}

function sheetOK() {
  var inp = document.getElementById("sheetInput")
  post({ t: P.sheet.submit, v: inp ? inp.value.trim() : "", v2: P.sheet.value2 })
}

function closeSheet(e) {
  if (e && e.target && e.target.id !== "sheet") return
  document.getElementById("sheet").className = "sheet"
  post({ t: "close" })
}
</script>
`
