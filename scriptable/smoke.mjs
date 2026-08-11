// 冒烟测试：把整个 Myla.js 用打桩的 Scriptable API 真跑一遍。
//
// 之前一直只抽单个函数出来测，所以「const SID 声明在入口之后」这种错——
// 语法全对、抽出来的函数也全对，但整个文件一跑就 TDZ 报错——一次都没被拦住。
// 这里跑完整流程：读数据 → 组 payload → 开窗口 → 五条通道送操作 → 落盘 → 关窗口。
//
// 用法：node smoke.mjs

import fs from "fs"
import path from "path"
import os from "os"

const DIR = path.join(os.homedir(), "studywithclawd/scriptable")
let disk = {}
let store = {}                       // 假的 localStorage
const alerts = []
const notes = []

// ---------------------------------------------------------------- 打桩
class Size { constructor(w, h) { this.width = w; this.height = h } }
class Rect { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h }) } }
class Point { constructor(x, y) { this.x = x; this.y = y } }
class Color { constructor(h, a) { this.hex = h; this.alpha = a } static dynamic(a) { return a } }
class Font {
  static systemFont(s) { return { s } } static boldSystemFont(s) { return { s } }
  static semiboldSystemFont(s) { return { s } }
}
class Path { addLines() {} closeSubpath() {} addRoundedRect() {} }
class DrawContext {
  constructor() { this.size = new Size(1, 1) }
  setFillColor() {} setStrokeColor() {} setLineWidth() {} setTextColor() {} setFont() {}
  setTextAlignedCenter() {} setTextAlignedLeft() {} setTextAlignedRight() {}
  fillRect() {} fillEllipse() {} addPath() {} fillPath() {} strokePath() {} drawTextInRect() {}
  getImage() { return { __img: true } }
}
const Data = {
  fromPNG: () => ({ toBase64String: () => "PNGSTUB" }),
  fromBase64String: b64 => {
    const buf = Buffer.from(b64, "base64")
    // Scriptable 遇到非法 base64 会抛，这里也得抛，不然测不出真实行为
    if (buf.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) {
      throw new Error("不是合法的 base64")
    }
    return { toRawString: () => buf.toString("utf8") }
  }
}
const FileManager = {
  local: () => FM, iCloud: () => FM
}
const FM = {
  documentsDirectory: () => "/docs",
  joinPath: (a, b) => path.join(a, b),
  fileExists: p => p in disk,
  readString: p => { if (!(p in disk)) throw new Error("no such file " + p); return disk[p] },
  writeString: (p, s) => { disk[p] = s },
  remove: p => { delete disk[p] },
  copy: (a, b) => { disk[b] = disk[a] },
  move: (a, b) => { disk[b] = disk[a]; delete disk[a] },
  listContents: () => Object.keys(disk).map(p => path.basename(p)),
  downloadFileFromiCloud: async () => {}
}

// 页面：真的把 MylaView 的 <script> 跑起来，这样测的是真实的页面逻辑
function makePageReal(wv) {
  const view = readModule("MylaView.js")
  const html = view.HTML
  const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"))

  const els = {}
  const mkEl = () => ({ value: "", textContent: "", innerHTML: "", className: "", style: {},
                        focus() {}, select() {}, insertAdjacentHTML() {} })
  const document = {
    getElementById: id => (els[id] || (els[id] = mkEl())),
    querySelectorAll: () => [],
    addEventListener: () => {},
    visibilityState: "visible"
  }
  const location = {}
  let href = ""
  Object.defineProperty(location, "href", {
    get: () => href,
    set: v => {                       // 页面发起跳转 —— 正是真机上的第 ① 条通道
      href = v
      if (SCENARIO.noSar) return      // 模拟这条通道在真机上一次都送不到
      if (wv && wv.shouldAllowRequest) wv.shouldAllowRequest({ url: v })
    }
  })
  const store = wv.__store
  const window = {
    addEventListener: () => {},
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v },
      removeItem: k => { delete store[k] }
    }
  }
  const fn = new Function("window", "document", "location", "localStorage", "setTimeout", "Math",
    js + "\nreturn { boot: window.boot, log: log, LOG: LOG, cdSave: cdSave, S: S }")
  const api = fn(window, document, location, window.localStorage, f => f(), Math)
  api.els = els
  api.doc = document
  return api
}

function makePage() {
  const view = readModule("MylaView.js")
  const html = view.HTML
  const js = html.slice(html.indexOf("<script>") + 8, html.lastIndexOf("</script>"))
  const doc = {
    getElementById: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    visibilityState: "visible"
  }
  const win = {
    addEventListener: () => {},
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = v },
      removeItem: k => { delete store[k] }
    },
    location: { href: "" }
  }
  const fn = new Function("window", "document", "localStorage", "location", "setTimeout",
    js + "\nreturn { boot: window.boot, api: this }")
  const ctx = Object.create(null)
  const out = fn.call(ctx, win, doc, win.localStorage, win.location, (f) => f())
  return { win, doc, run: out, js }
}

let page = null
class WebView {
  constructor() { this.html = ""; this.__store = store }
  async loadHTML(html, base) {
    this.html = html
    this.base = base
    if (html.indexOf("window.boot(") >= 0) {
      // 真的把页面代码跑起来，并真的 boot(payload, true)
      page = makePageReal(this)
      const call = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"))
      const payloadJSON = call.slice(call.indexOf("(") + 1, call.lastIndexOf(", true)"))
      this.payload = JSON.parse(payloadJSON)
      page.boot(this.payload, true)
    }
  }
  async evaluateJavaScript(js) {
    if (js.indexOf("localStorage.getItem") >= 0) {
      if (SCENARIO.noStorage) return null
      return store["myla_pending"] || null
    }
    if (js.indexOf("localStorage.removeItem") >= 0) { delete store["myla_pending"]; return null }
    if (js.indexOf("window.LOG") >= 0) {
      // 模拟「evaluateJavaScript 对已弹出的窗口不工作」：第②④条通道等于没有
      if (SCENARIO.noEval) throw new Error("这台机器上读不了")
      return JSON.stringify(page ? page.LOG : [])
    }
    return null
  }
  async present() {
    if (SCENARIO.actions) SCENARIO.actions(page)     // 在窗口里点几下
    return "closed"
  }
  set shouldAllowRequest(fn) { this._sar = fn }
  get shouldAllowRequest() { return this._sar }
}

// UITable：主界面现在走这条，onSelect 是脚本代码、点一下当场存盘。
// present() 里模拟用户点了哪几行。
class UITableCell {
  constructor(text) { this.text = text }
  rightAligned() { return this } leftAligned() { return this } centerAligned() { return this }
}
class UITableRow {
  constructor() { this.cells = [] }
  addText(t) { const c = new UITableCell(t); this.cells.push(c); return c }
  addImage() { const c = new UITableCell("[图]"); this.cells.push(c); return c }
  get text() { return this.cells.map(c => c.text).join(" ") }
}
class UITable {
  constructor() { this.rows = [] }
  addRow(r) { this.rows.push(r) }
  removeAllRows() { this.rows = [] }
  reload() {}
  async present() {
    if (SCENARIO.taps) await SCENARIO.taps(this)
    return null
  }
}

let ALERT_INPUT = []          // 弹窗里要填的内容
let ALERT_PICK = 0            // 点第几个按钮（-1 = 取消）
class Alert {
  constructor() { this.actions = [] ; this.fields = [] }
  addAction(t) { this.actions.push(t) }
  addCancelAction(t) { this.cancel = t }
  addDestructiveAction(t) { this.actions.push(t) }
  addTextField(ph, v) { this.fields.push(v === undefined ? "" : v) }
  textFieldValue(i) { return ALERT_INPUT[i] !== undefined ? ALERT_INPUT[i] : this.fields[i] }
  async present() {
    alerts.push((this.title || "") + " | " + (this.message || ""))
    return ALERT_PICK
  }
}
class Notification {
  constructor() {}
  static async allPending() { return [] }
  addAction(t) { notes.push(t) }
  setTriggerDate() {} schedule() {} remove() {}
}
Notification.allPending = async () => []
const Timer = { schedule: (ms, rep, cb) => setTimeout(cb, 0) }
const Request = class {
  constructor(u) { this.url = u; this.headers = {} }
  async loadJSON() { throw new Error("离线") }
  async loadString() { throw new Error("离线") }
}
const DocumentPicker = { exportFile: async () => {} }
const Script = { complete: () => {} }
const config = { runsInApp: true, runsInWidget: false }

// ---------------------------------------------------------------- 跑
const modules = {}
function readModule(name) {
  if (modules[name]) return modules[name]
  const src = fs.readFileSync(path.join(DIR, name), "utf8")
  const mod = { exports: {} }
  const fn = new Function("module", "exports", "importModule", ...Object.keys(GLOBALS),
    src + "\nreturn module.exports")
  modules[name] = fn(mod, mod.exports, n => readModule(n + ".js"), ...Object.values(GLOBALS))
  return modules[name]
}

const GLOBALS = {
  Size, Rect, Point, Color, Font, Path, DrawContext, Data, FileManager, WebView,
  UITable, UITableRow, Alert, Notification, Timer, Request, DocumentPicker, Script,
  config, args: {}
}

let SCENARIO = {}

async function runMyla(label, scenario) {
  SCENARIO = scenario || {}
  alerts.length = 0
  for (const k of Object.keys(modules)) delete modules[k]
  const src = fs.readFileSync(path.join(DIR, "Myla.js"), "utf8")
  const fn = new Function("importModule", ...Object.keys(GLOBALS),
    "return (async () => {\n" + src + "\n})()")
  await fn(n => readModule(n + ".js"), ...Object.values(GLOBALS))
  console.log("  ✓ " + label + " 跑通了")
}

// 场景：在窗口里点三下。走的是页面里真实的 log()，所以会真的触发
// location.href 跳转（第 ① 条通道）和 localStorage 写入（第 ③ 条）。
function actionsIn() {
  return page => {
    page.log("switch", "study")
    page.log("todo.add", "重跑实验", "n1")
    page.log("switch", "research")
  }
}

console.log("整个 Myla.js 端到端跑一遍：\n")

disk = {}; store = {}
await runMyla("① 第一次用（没有任何数据）", {})

const C = readModule("MylaCore.js")
const tk = C.dayKey()

async function tapRow(table, text) {
  for (const r of table.rows) {
    if (r.text.indexOf(text) >= 0 && r.onSelect) { await r.onSelect(); return true }
  }
  throw new Error("界面上找不到「" + text + "」这一行")
}

// 会改数据的操作现在全在 UITable 里，点一下脚本当场存盘，中间不经过网页。
disk = {}; store = {}
await runMyla("② 点「学习」", { taps: async t => { await tapRow(t, "学习") } })
let d = C.load()
console.log("     → 段：" + (d.days[tk] || []).map(s => C.activityOf(d, s.a).name).join(">"))
if (!(d.days[tk] || []).some(s => s.a === "study")) { console.log("     ❌ 没存下来"); process.exit(1) }

ALERT_INPUT = ["写周报"]; ALERT_PICK = 0
await runMyla("③ 加一条待办", { taps: async t => { await tapRow(t, "加一条") } })
d = C.load()
console.log("     → 清单：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空"))
if (!(d.todos[tk] || []).length) { console.log("     ❌ 待办没存下来"); process.exit(1) }

ALERT_INPUT = ["论文 deadline", "2026-08-30"]; ALERT_PICK = 0
await runMyla("④ 记一个倒数日", { taps: async t => { await tapRow(t, "记一个日子") } })
d = C.load()
console.log("     → 倒数日：" + ((d.countdowns || []).map(c => c.name + " " + c.date).join("、") || "空"))
if (!(d.countdowns || []).length) { console.log("     ❌ 倒数日没存下来"); process.exit(1) }

ALERT_INPUT = ["论文答辩", "2026-09-01"]; ALERT_PICK = 0
await runMyla("⑤ 改那个倒数日", { taps: async t => { await tapRow(t, "论文 deadline") } })
d = C.load()
console.log("     → 改完：" + (d.countdowns || []).map(c => c.name + " " + c.date).join("、"))
if ((d.countdowns[0] || {}).name !== "论文答辩") { console.log("     ❌ 没改上"); process.exit(1) }

ALERT_PICK = 2                       // 删掉
await runMyla("⑥ 删掉它", { taps: async t => { await tapRow(t, "论文答辩") } })
d = C.load()
console.log("     → 剩下：" + ((d.countdowns || []).length) + " 个")
if ((d.countdowns || []).length) { console.log("     ❌ 没删掉"); process.exit(1) }
ALERT_PICK = 0; ALERT_INPUT = []

// 网页现在只负责看，里面不改数据，所以打开它不该影响任何东西
const beforeWeb = fs.existsSync ? JSON.stringify(C.load().days) : ""
await runMyla("⑦ 打开网页看圆盘（只读）", { taps: async t => { await tapRow(t, "看圆盘") } })
d = C.load()
console.log("     → 打开前后数据一样吗：" +
  (JSON.stringify(d.days) === beforeWeb ? "一样 ✓" : "❌ 变了"))

// 上一版留在浏览器里没落盘的东西，仍然要能捞回来
disk = {}; store = {}
store["myla_pending"] = JSON.stringify([
  { i: 0, sid: "old-session", t: "switch", v: "study", at: Date.now() },
  { i: 1, sid: "old-session", t: "todo.add", v: "网页里加的", v2: "n9", at: Date.now() }
])
await runMyla("⑧ 网页里的残留照样捞回来", {})
d = C.load()
console.log("     → 段：" + (d.days[tk] || []).map(s => C.activityOf(d, s.a).name).join(">")
  + " ｜ 清单：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空"))
if (!(d.todos[tk] || []).length) { console.log("     ❌ 残留没捞回来"); process.exit(1) }

console.log("\n弹过的窗：" + (alerts.filter(Boolean).join(" / ") || "（没有）"))
console.log("\n全部跑通 ✅")
