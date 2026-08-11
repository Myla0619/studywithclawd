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
const Data = { fromPNG: () => ({ toBase64String: () => "PNGSTUB" }) }
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
  constructor() { this.html = "" }
  async loadHTML(html, base) {
    this.html = html
    this.base = base
    if (html.indexOf("window.boot(") >= 0) {
      page = makePage()
      const call = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"))
      // 真的执行 boot(payload, true)
      const payloadJSON = call.slice(call.indexOf("(") + 1, call.lastIndexOf(", true)"))
      const payload = JSON.parse(payloadJSON)
      this.payload = payload
      pageState = { LOG: [], SEQ: 0, sid: payload.sid }
    }
  }
  async evaluateJavaScript(js) {
    if (js.indexOf("localStorage.getItem") >= 0) return store["myla_pending"] || null
    if (js.indexOf("localStorage.removeItem") >= 0) { delete store["myla_pending"]; return null }
    if (js.indexOf("window.LOG") >= 0) return JSON.stringify(pageState ? pageState.LOG : [])
    return null
  }
  async present() {
    // 用户在窗口里点了几下，然后关掉
    if (SCENARIO.actions) SCENARIO.actions()
    return "closed"
  }
  set shouldAllowRequest(fn) { this._sar = fn }
  get shouldAllowRequest() { return this._sar }
}
let pageState = null

class Alert {
  constructor() { this.actions = [] }
  addAction(t) { this.actions.push(t) }
  addCancelAction(t) { this.actions.push(t) }
  addDestructiveAction(t) { this.actions.push(t) }
  addTextField() {}
  textFieldValue() { return "" }
  async present() { alerts.push((this.title || "") + " | " + (this.message || "")); return 0 }
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
  Alert, Notification, Timer, Request, DocumentPicker, Script, config, args: {}
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

// 场景：开着窗口点三下（模拟 shouldAllowRequest 通道 + localStorage）
function actionsIn(wvGetter) {
  return () => {
    const acts = [["switch", "study"], ["todo.add", "重跑实验", "n1"], ["switch", "research"]]
    for (const [t, v, v2] of acts) {
      pageState.LOG.push({ i: pageState.SEQ++, sid: pageState.sid, t, v, v2, at: Date.now() })
    }
    store["myla_pending"] = JSON.stringify(pageState.LOG)
  }
}

console.log("整个 Myla.js 端到端跑一遍：\n")

disk = {}; store = {}
await runMyla("① 第一次用（没有任何数据）", {})

const C = readModule("MylaCore.js")
const tk = C.dayKey()

disk = {}; store = {}
await runMyla("② 窗口里点三下再关掉", { actions: actionsIn() })
let d = C.load()
console.log("     → 段：" + (d.days[tk] || []).map(s => C.activityOf(d, s.a).name).join(">")
  + " ｜ 清单：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空"))

// ③ 上划杀进程：只有 localStorage 留下来，下次启动应该捞回来
disk = {}; store = {}
const before = JSON.stringify(disk)
SCENARIO = { actions: actionsIn() }
;(function killApp() {
  // 手动模拟：页面写了 localStorage，但脚本一行落盘代码都没跑
  pageState = { LOG: [], SEQ: 0, sid: "killed-session" }
  const acts = [["switch", "study"], ["todo.add", "被杀之前加的", "n9"]]
  for (const [t, v, v2] of acts) {
    pageState.LOG.push({ i: pageState.SEQ++, sid: "killed-session", t, v, v2, at: Date.now() })
  }
  store["myla_pending"] = JSON.stringify(pageState.LOG)
})()
await runMyla("③ 上划杀进程后再打开", {})
d = C.load()
console.log("     → 段：" + (d.days[tk] || []).map(s => C.activityOf(d, s.a).name).join(">")
  + " ｜ 清单：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空"))
console.log("     → 残留清掉了吗：" + (store["myla_pending"] ? "❌ 还在" : "清了 ✓"))

// ④ 再打开一次，不该重复执行
await runMyla("④ 紧接着再打开一次", {})
d = C.load()
console.log("     → 清单：" + ((d.todos[tk] || []).map(x => x.text).join("、") || "空")
  + "（不该变多）")

console.log("\n弹过的窗：" + (alerts.filter(Boolean).join(" / ") || "（没有）"))
console.log("\n全部跑通 ✅")
