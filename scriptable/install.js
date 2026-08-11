// 引导脚本：把正式文件拉到 Scriptable 的脚本目录。以后更新也跑这个。
//
// 关键：写到「当前这个脚本所在的目录」，而不是写死 FileManager.local()。
// Scriptable 的脚本可能存在本地，也可能存在 iCloud，两个是不同的文件夹；
// 写错地方的话文件确实落盘了，但脚本列表里死活不出现。
// module.filename 是当前脚本的完整路径，跟着它走一定没错。

const FILES = ["MylaDayCore.js", "MylaDay.js", "MylaDayWidget.js", "Diag.js"]
const SOURCES = [
  ["GitHub", "https://raw.githubusercontent.com/Myla0619/studywithclawd/main/scriptable/"],
  ["jsDelivr 镜像", "https://cdn.jsdelivr.net/gh/Myla0619/studywithclawd@main/scriptable/"]
]

const here = module.filename
const dir = here.slice(0, here.lastIndexOf("/"))
const inICloud = dir.indexOf("Mobile Documents") >= 0 || dir.indexOf("iCloud") >= 0
const fm = inICloud ? FileManager.iCloud() : FileManager.local()

const log = []
let failed = 0

for (const name of FILES) {
  let saved = false
  for (const [label, base] of SOURCES) {
    try {
      const req = new Request(base + name)
      req.timeoutInterval = 20
      const code = await req.loadString()
      if (!code || code.length < 400) throw new Error("内容太短")

      const path = fm.joinPath(dir, name)
      fm.writeString(path, code)
      log.push(`✅ ${name}  ${Math.round(code.length / 1024)} KB  (${label})`)
      saved = true
      break
    } catch (e) {
      log.push(`… ${name} 从${label}失败：${e.message}`)
    }
  }
  if (!saved) failed++
}

// 只覆盖上面列的那几个脚本名，数据文件（myladay*.json）一律不碰
const listed = fm.listContents(dir).filter(f => f.endsWith(".js"))
const dataDir = FileManager.local().documentsDirectory()
const dataFiles = FileManager.local().listContents(dataDir)
  .filter(f => f.indexOf("myladay") === 0)

const a = new Alert()
a.title = failed ? `有 ${failed} 个没装上` : "装好了"
a.message = log.join("\n")
  + "\n\n装到了：" + (inICloud ? "iCloud" : "本机") + "脚本目录"
  + "\n" + dir
  + "\n\n这个目录里现在有：\n" + (listed.length ? listed.join("、") : "（空）")
  + "\n\n你的记录（没有被动过）：\n"
  + (dataFiles.length ? dataFiles.join("、") : "（还没有记录）")
  + (failed ? "" : "\n\n退回脚本列表下拉刷新，就能看到 MylaDay。")
a.addAction("好")
await a.present()
