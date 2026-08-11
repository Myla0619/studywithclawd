// 引导脚本：把正式文件拉到 Scriptable 的脚本目录。以后更新也跑这个。
//
// 两个踩过的坑，这里都堵上了：
//
// 1) 写到「当前这个脚本所在的目录」，而不是写死 FileManager.local()。
//    Scriptable 的脚本可能存在本地，也可能存在 iCloud，两个是不同的文件夹；
//    写错地方文件确实落盘了，但脚本列表里死活不出现。module.filename 跟着走一定没错。
//
// 2) 所有下载钉在一个具体 commit 上。用分支名（main / @main）时各家 CDN
//    缓存时长不一样，jsDelivr 的 @main 能陈到发几个小时前的文件——只要 GitHub
//    那边有一次超时回落到它，就会拿回一份旧代码，而且看起来一切正常。
//    所以先问 GitHub 最新 commit 是哪个，再按 sha 取。

const REPO = "Myla0619/studywithclawd"
const FILES = ["MylaDayCore.js", "MylaDayHTML.js", "MylaDay.js",
               "MylaDayWidget.js", "Diag.js", "Check.js"]

const here = module.filename
const dir = here.slice(0, here.lastIndexOf("/"))
const inICloud = dir.indexOf("Mobile Documents") >= 0 || dir.indexOf("iCloud") >= 0
const fm = inICloud ? FileManager.iCloud() : FileManager.local()

// ---- 先问最新 commit
let sha = null
try {
  const r = new Request("https://api.github.com/repos/" + REPO + "/commits/main")
  r.headers = { "User-Agent": "MylaDay" }      // GitHub API 不带 UA 直接 403
  r.timeoutInterval = 20
  sha = (await r.loadJSON()).sha
} catch (e) { /* 拿不到就退回分支名 */ }

const SOURCES = []
if (sha) {
  SOURCES.push(["GitHub " + sha.slice(0, 7),
    "https://raw.githubusercontent.com/" + REPO + "/" + sha + "/scriptable/"])
  SOURCES.push(["jsDelivr " + sha.slice(0, 7),
    "https://cdn.jsdelivr.net/gh/" + REPO + "@" + sha + "/scriptable/"])
}
SOURCES.push(["GitHub main",
  "https://raw.githubusercontent.com/" + REPO + "/main/scriptable/"])

// ---- 下载
const log = []
let failed = 0

for (const name of FILES) {
  let saved = false
  for (const [label, base] of SOURCES) {
    try {
      const req = new Request(base + name + "?t=" + Date.now())
      req.timeoutInterval = 20
      const code = await req.loadString()
      if (!code || code.length < 400) throw new Error("内容太短")
      fm.writeString(fm.joinPath(dir, name), code)
      log.push("✅ " + name + "  " + Math.round(code.length / 1024) + " KB  (" + label + ")")
      saved = true
      break
    } catch (e) {
      log.push("… " + name + " 从 " + label + " 失败：" + e.message)
    }
  }
  if (!saved) failed++
}

// ---- 回读核对：装完之后手机上实际是哪一版
// 只覆盖上面列的那几个脚本名，数据文件（myladay*.json）一律不碰
let version = "读不到"
let webview = false
try {
  const core = fm.readString(fm.joinPath(dir, "MylaDayCore.js"))
  const m = core.match(/const VERSION = "([^"]*)"/)
  if (m) version = m[1]
  webview = fm.readString(fm.joinPath(dir, "MylaDay.js")).indexOf("new WebView") >= 0
} catch (e) { /* 下面会报 */ }

const listed = fm.listContents(dir).filter(f => f.endsWith(".js"))
const missing = FILES.filter(f => listed.indexOf(f) < 0)
const dataFiles = FileManager.local().listContents(FileManager.local().documentsDirectory())
  .filter(f => f.indexOf("myladay") === 0)

const a = new Alert()
a.title = failed || missing.length ? "没装全" : "装好了 · " + version
a.message = log.join("\n")
  + "\n\n装到了：" + (inICloud ? "iCloud" : "本机") + "脚本目录\n" + dir
  + "\n\n目录里现在有：\n" + (listed.length ? listed.join("、") : "（空）")
  + (missing.length ? "\n\n⚠️ 少了：" + missing.join("、") : "")
  + "\n\n界面：" + (webview ? "WebView 版 ✓" : "⚠️ 还是老的 UITable 版")
  + "\n\n你的记录（没有被动过）：\n"
  + (dataFiles.length ? dataFiles.join("、") : "（还没有记录）")
  + (failed || missing.length ? "" : "\n\n把 Scriptable 从后台划掉再开，然后跑 MylaDay。")
a.addAction("好")
await a.present()
