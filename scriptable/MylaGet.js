// 装 / 修 Myla。先验证再写：四个源各拿一遍，把每个源实际返回的版本号列出来，
// 只写对得上的那个。装不上的时候，这张单子直接告诉你是哪一环出问题。
//
// 为什么要这么啰嗦：用户那边反复出现「跑了安装脚本但还是旧版」，而我这边测四个源
// 全是新的。差别只能出在手机上——iOS 的 URL 缓存、iCloud 目录没下载下来、
// 或者文件写到了 A 目录而脚本列表读的是 B 目录。这三样这里都会报出来。

const REPO = "Myla0619/studywithclawd"
const FILES = ["MylaCore.js", "MylaView.js", "Myla.js", "MylaWidget.js", "MylaWhy.js"]

const here = module.filename
const dir = here.slice(0, here.lastIndexOf("/"))
const inICloud = dir.indexOf("Mobile Documents") >= 0 || dir.indexOf("iCloud") >= 0
const fm = inICloud ? FileManager.iCloud() : FileManager.local()

function get(url) {
  const r = new Request(url + (url.indexOf("?") < 0 ? "?" : "&") + "t=" + Date.now())
  // iOS 会缓存请求，加了时间戳还不够保险，再明确说一次不要缓存
  r.headers = { "Cache-Control": "no-cache", "Pragma": "no-cache", "User-Agent": "Myla" }
  r.timeoutInterval = 25
  return r.loadString()
}
const verOf = s => { const m = (s || "").match(/const VERSION = "([^"]*)"/); return m ? m[1] : null }

// ---- 先问最新 commit（问不到也不要紧，下面还有三个源）
let sha = null
let apiNote = ""
try {
  const r = new Request("https://api.github.com/repos/" + REPO + "/commits/main")
  r.headers = { "User-Agent": "Myla" }
  r.timeoutInterval = 15
  sha = (await r.loadJSON()).sha
} catch (e) { apiNote = "问不到最新 commit：" + e.message }

const SOURCES = []
if (sha) {
  SOURCES.push(["GitHub " + sha.slice(0, 7), "https://raw.githubusercontent.com/" + REPO + "/" + sha + "/scriptable/"])
  SOURCES.push(["jsDelivr " + sha.slice(0, 7), "https://cdn.jsdelivr.net/gh/" + REPO + "@" + sha + "/scriptable/"])
}
SOURCES.push(["GitHub main", "https://raw.githubusercontent.com/" + REPO + "/main/scriptable/"])
SOURCES.push(["jsDelivr main", "https://cdn.jsdelivr.net/gh/" + REPO + "@main/scriptable/"])

// ---- 每个源先只拿 MylaCore.js，看它给的是哪一版，然后挑版本号最大的那个源。
// 不写死期望版本：写死的话我每发一版，你手里这份就过期了。
// 版本号是 20260812-0155 这种格式，字符串比大小就是比新旧。
const probe = []
const found = []
for (const [label, base] of SOURCES) {
  try {
    const v = verOf(await get(base + "MylaCore.js"))
    probe.push([label, v || "读不出版本", v])
    if (v) found.push({ label, base, v })
  } catch (e) { probe.push([label, "失败：" + e.message, null]) }
}
const newest = found.reduce((a, b) => (!a || b.v > a.v ? b : a), null)
const good = newest
for (const row of probe) {
  row[1] = row[1] + (newest && row[2] === newest.v ? "  ✅" : row[2] ? "  ⚠️旧" : "")
}

// ---- 下载
const log = []
let bad = 0
if (!good) {
  bad = FILES.length
  log.push("四个源一个都没拿到，什么都没写。")
} else {
  for (const name of FILES) {
    try {
      const code = await get(good.base + name)
      if (!code || code.length < 400) throw new Error("内容太短")
      fm.writeString(fm.joinPath(dir, name), code)
      log.push("✅ " + name + "  " + Math.round(code.length / 1024) + " KB")
    } catch (e) { log.push("❌ " + name + "  " + e.message); bad++ }
  }
}

// ---- 回读核对（iCloud 上的文件可能还没下到本地，得先拉一下）
let onDisk = "读不到"
try {
  const p = fm.joinPath(dir, "MylaCore.js")
  if (inICloud && fm.downloadFileFromiCloud) await fm.downloadFileFromiCloud(p)
  onDisk = verOf(fm.readString(p)) || "读不到版本号"
} catch (e) { onDisk = "读不到：" + e.message }

// ---- 两个目录都列出来：写到 A、列表读 B 是踩过的坑
function listing(label, f) {
  try {
    const d = f.documentsDirectory()
    const js = f.listContents(d).filter(x => x.endsWith(".js"))
    return label + "（" + d.split("/").slice(-2).join("/") + "）：\n" + (js.join("、") || "（空）")
  } catch (e) { return label + "：读不到" }
}

const dataFiles = FileManager.local().listContents(FileManager.local().documentsDirectory())
  .filter(f => f.indexOf("myladay") === 0)

const a = new Alert()
a.title = bad ? "没装成"
  : (newest && onDisk === newest.v ? "装好了 · " + onDisk : "写完了但回读是 " + onDisk)
a.message = "各个源给的版本：\n" + probe.map(r => r[0] + " → " + r[1]).join("\n")
  + (apiNote ? "\n(" + apiNote + ")" : "")
  + "\n\n" + log.join("\n")
  + "\n\n写到：" + (inICloud ? "iCloud" : "本机") + "\n" + dir
  + "\n回读到的版本：" + onDisk
  + "\n\n" + listing("本机", FileManager.local())
  + (inICloud ? "\n\n" + listing("iCloud", FileManager.iCloud()) : "")
  + "\n\n你的记录（没动过）：\n" + (dataFiles.length ? dataFiles.join("、") : "（还没有）")
  + (bad ? "" : "\n\n退回列表下拉刷新，跑「Myla」。")
a.addAction("好")
await a.present()
