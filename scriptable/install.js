// 引导脚本：把正式的三个文件拉到 Scriptable 本地目录。
// 以后更新也跑这个。
//
// 无论成功失败都会弹窗说明——上一版什么都不显示，跑完一片安静，
// 分不清是装好了还是没反应。

const FILES = ["MylaDayCore.js", "MylaDay.js", "MylaDayWidget.js"]
const SOURCES = [
  ["GitHub", "https://raw.githubusercontent.com/Myla0619/studywithclawd/main/scriptable/"],
  ["jsDelivr 镜像", "https://cdn.jsdelivr.net/gh/Myla0619/studywithclawd@main/scriptable/"]
]

const fm = FileManager.local()
const dir = fm.documentsDirectory()
const log = []
let failed = 0

for (const name of FILES) {
  let saved = false
  for (const [label, base] of SOURCES) {
    try {
      const req = new Request(base + name)
      req.timeoutInterval = 20
      const code = await req.loadString()
      if (!code || code.length < 500) throw new Error("内容太短，可能是错误页")

      const path = fm.joinPath(dir, name)
      fm.writeString(path, code)

      // 写完再读回来核对，避免"以为写成功了"
      const back = fm.readString(path)
      if (back.length !== code.length) throw new Error("写入后长度对不上")

      log.push(`✅ ${name}  ${Math.round(code.length / 1024)} KB  (${label})`)
      saved = true
      break
    } catch (e) {
      log.push(`… ${name} 从${label}失败：${e.message}`)
    }
  }
  if (!saved) failed++
}

// 顺带看看目录里到底有什么，importModule 找不到文件时这个最有用
const here = fm.listContents(dir).filter(f => f.endsWith(".js"))

const a = new Alert()
a.title = failed ? `有 ${failed} 个没装上` : "装好了"
a.message = log.join("\n")
  + "\n\n脚本目录里现在有：\n" + (here.length ? here.join("、") : "（空）")
  + (failed ? "\n\n三个文件必须都在，缺一个主脚本就跑不起来。"
            : "\n\n回脚本列表点 MylaDay 就能用。\n小组件：长按主屏 → ＋ → Scriptable → 选 MylaDayWidget。")
a.addAction("好")
await a.present()
