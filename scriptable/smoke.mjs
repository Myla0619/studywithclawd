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
  drawImageInRect() {} drawImageAtPoint() {}
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
    return { toRawString: () => buf.toString("latin1") }
  }
}
const FileManager = {
  local: () => FM, iCloud: () => FM
}
const FM = {
  documentsDirectory: () => "/docs",
  readImage: p => { if (!(p in disk)) throw new Error("no image"); return { __img: true, size: { width: 480, height: 480 } } },
  writeImage: (p, img) => { disk[p] = "IMG" },
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
    // 只在第一次展示时模拟点击。表关掉之后会重新打开，再点一次就是死循环。
    if (SCENARIO.taps && !SCENARIO.__tapped) {
      SCENARIO.__tapped = true
      await SCENARIO.taps(this)
    }
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
  setTriggerDate() {}
  schedule() { notes.push((this.title || "") + " | " + (this.body || "")) }
  remove() {}
}
Notification.allPending = async () => []
const Timer = { schedule: (ms, rep, cb) => setTimeout(cb, 0) }
const Request = class {
  constructor(u) { this.url = u; this.headers = {} }
  async loadJSON() { throw new Error("离线") }
  async loadString() { throw new Error("离线") }
}
const DocumentPicker = { exportFile: async () => {} }
const Device = {
  isUsingDarkAppearance: () => true,
  screenSize: () => new Size(390, 844)
}
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
  UITable, UITableRow, Alert, Notification, Timer, Request, DocumentPicker, Device,
  Script, config, args: {}
}

let SCENARIO = {}

async function runMyla(label, scenario) {
  SCENARIO = scenario || {}
  alerts.length = 0
  for (const k of Object.keys(modules)) delete modules[k]
  const src = fs.readFileSync(path.join(DIR, "Myla.js"), "utf8")
  const vals = Object.values(GLOBALS).slice()
  const argIdx = Object.keys(GLOBALS).indexOf("args")
  vals[argIdx] = SCENARIO.args || {}
  const fn = new Function("importModule", ...Object.keys(GLOBALS),
    "return (async () => {\n" + src + "\n})()")
  try { await fn(n => readModule(n + ".js"), ...vals) }
  catch (e) { if (e.message !== "__done__") throw e }
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
    const label = (r.__label || "") + " " + r.text
    if (label.indexOf(text) >= 0 && r.onSelect) { await r.onSelect(); return true }
  }
  throw new Error("界面上找不到「" + text + "」这一行")
}

// ---- 主界面 UITable，所有写操作直接存盘
disk = {}; store = {}
disk["/docs/myladay.avatar.png"] = "IMG"     // 自定义中间形象：走画头像那条分支
await runMyla("② 点「学习」（中间是自定义形象）", { taps: async t => { await tapRow(t, "学习") } })
let d = C.load()
console.log("     → 段：" + (d.days[tk] || []).map(s => C.activityOf(d, s.a).name).join(">"))
if (!(d.days[tk] || []).some(s => s.a === "study")) { console.log("     ❌ 没存下来"); process.exit(1) }

ALERT_INPUT = ["写周报"]; ALERT_PICK = 0
await runMyla("③ 加中文待办（先关表再弹）", { taps: async t => { await tapRow(t, "加一条") } })
d = C.load()
console.log("     → 待办：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空"))
if ((d.todos[tk] || [])[0] && (d.todos[tk] || [])[0].text !== "写周报") {
  console.log("     ❌ 中文乱了"); process.exit(1)
}

ALERT_INPUT = ["论文 deadline · 中文", "2026-08-30"]; ALERT_PICK = 0
await runMyla("④ 记中文倒数日（先关表再弹）", { taps: async t => { await tapRow(t, "记一个日子") } })
d = C.load()
console.log("     → 倒数日：" + ((d.countdowns || []).map(c => c.name).join("、") || "空"))
if ((d.countdowns || [])[0] === undefined
    || d.countdowns[0].name !== "论文 deadline · 中文") {
  console.log("     ❌ 没存下来或中文乱了"); process.exit(1)
}
ALERT_INPUT = []; ALERT_PICK = 0

// ---- 上划杀进程：浏览器里的暂存下次启动捞回来
disk = {}; store = {}
store["myla_pending"] = JSON.stringify([
  { i: 0, sid: "killed", t: "switch", v: "study", at: Date.now() },
  { i: 1, sid: "killed", t: "todo.add", v: "被杀之前加的", v2: "n9", at: Date.now() }
])
await runMyla("⑤ 上划杀掉之后再打开", {})
d = C.load()
console.log("     → 段：" + (d.days[tk] || []).map(s => C.activityOf(d, s.a).name).join(">")
  + " ｜ 待办：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空"))
if (!(d.todos[tk] || []).length) { console.log("     ❌ 残留没捞回来"); process.exit(1) }

await runMyla("⑥ 紧接着再打开一次（不该翻倍）", {})
d = C.load()
console.log("     → 待办：" + (d.todos[tk] || []).map(x => x.text).join("、"))
if ((d.todos[tk] || []).length !== 1) { console.log("     ❌ 重复执行了"); process.exit(1) }

// ⑦ 微信复制 → 快捷指令进待办：拆条、去客套、去重
disk = {}; store = {}
notes.length = 0
await runMyla("⑦ 微信剪贴板进待办", {
  args: { shortcutParameter: "todo:好的\n记得把周报发给导师。\n3. 预约周五的组会教室\n哈哈哈" }
})
d = C.load()
const wt = (d.todos[tk] || []).map(x => x.text)
console.log("     → 收进来的：" + (wt.join("、") || "空"))
if (wt.length !== 2 || wt[0] !== "把周报发给导师" || wt[1] !== "预约周五的组会教室") {
  console.log("     ❌ 解析不对（该收 2 条：去掉客套和序号）"); process.exit(1)
}
console.log("     → 通知：" + (notes[notes.length-1] || "无"))
await runMyla("   同一段再发一次（不该重复）", {
  args: { shortcutParameter: "todo:记得把周报发给导师。" }
})
d = C.load()
if ((d.todos[tk] || []).length !== 2) { console.log("     ❌ 重复添加了"); process.exit(1) }
console.log("     ✓ 拆条、去客套、去重都对")

console.log("\n弹过的窗：" + (alerts.filter(Boolean).join(" / ") || "（没有）"))
console.log("\n全部跑通 ✅")
