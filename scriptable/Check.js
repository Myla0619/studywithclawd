// 「跑了 install 但没变化」的时候跑这个。
//
// 要分清两件事：文件在磁盘上是不是新的，和 importModule 实际加载到的是不是新的。
// 前者旧 = 下载/写入没成功；前者新后者旧 = Scriptable 在吃模块缓存，划掉重开就行。
// 顺带把本机和 iCloud 两个目录都列出来——写到 A 目录、列表读 B 目录是踩过的坑。

const rows = []
const say = (t, sub) => rows.push([t, sub || ""])

const here = module.filename
say("这个脚本所在目录", here.slice(0, here.lastIndexOf("/")))

const dirs = []
const loc = FileManager.local()
dirs.push(["本机", loc, loc.documentsDirectory()])
try {
  const ic = FileManager.iCloud()
  const d = ic.documentsDirectory()
  if (d !== loc.documentsDirectory()) dirs.push(["iCloud", ic, d])
} catch (e) { say("没有 iCloud 目录", e.message) }

for (const [label, f, d] of dirs) {
  say("── " + label + " ──", d)
  let names = []
  try { names = f.listContents(d) } catch (e) { say("列不出来", e.message); continue }

  const js = names.filter(n => n.endsWith(".js"))
  if (!js.length) say("（这个目录里没有 .js）")
  for (const n of js) {
    let info = ""
    try {
      const txt = f.readString(f.joinPath(d, n))
      info = Math.round(txt.length / 1024) + " KB"
      const m = txt.match(/const VERSION = "([^"]*)"/)
      if (m) info += " · 版本 " + m[1]
      // 认得出新旧的特征：统计页和清单是这一版才有的
      if (n === "MylaDay.js") {
        info += txt.indexOf("showStats") >= 0 ? " · 有统计页" : " · 没有统计页（旧的）"
        info += txt.indexOf("addTodos") >= 0 ? " · 有清单" : " · 没有清单（旧的）"
      }
      if (n === "MylaDayCore.js") {
        info += txt.indexOf("drawDonut") >= 0 ? " · 有占比圆盘" : " · 没有占比圆盘（旧的）"
      }
    } catch (e) { info = "读不出来：" + e.message }
    say(n, info)
  }

  const json = names.filter(n => n.indexOf("myladay") === 0)
  say("记录文件", json.length ? json.join("、") : "（还没有）")
}

// 磁盘上是新的、这里还是旧的 = 模块缓存，把 Scriptable 从后台划掉再开
try {
  const C = importModule("MylaDayCore")
  say("importModule 实际拿到的版本", C.VERSION || "（这一版没有版本号，是旧的）")
  say("拿到的有没有 drawDonut", typeof C.drawDonut === "function" ? "有" : "没有（旧的）")
} catch (e) {
  say("importModule 失败", e.message)
}

const t = new UITable()
t.showSeparators = true
for (const [title, sub] of rows) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  r.height = sub ? 58 : 40
  const c = r.addText(title, sub)
  c.titleFont = Font.systemFont(15)
  c.subtitleFont = Font.systemFont(12)
  t.addRow(r)
}
await t.present(true)
