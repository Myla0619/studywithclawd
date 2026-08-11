// 一次性引导脚本：把正式的三个文件拉到 Scriptable 本地目录。
// 以后我改了代码，你再跑一次这个就是更新，不用重新传文件。

const BASE = "https://raw.githubusercontent.com/Myla0619/studywithclawd/main/scriptable/"
const FILES = ["MylaDayCore.js", "MylaDay.js", "MylaDayWidget.js"]

const fm = FileManager.local()
const dir = fm.documentsDirectory()
let done = []

for (const name of FILES) {
  const code = await new Request(BASE + name).loadString()
  if (!code || code.length < 100) throw new Error("下载失败：" + name)
  fm.writeString(fm.joinPath(dir, name), code)
  done.push(`${name}（${Math.round(code.length / 1024)} KB）`)
}

const a = new Alert()
a.title = "装好了"
a.message = done.join("\n") +
  "\n\n回到脚本列表就能看到 MylaDay，点它开始用。\n" +
  "小组件：长按主屏 → 加 Scriptable 小组件 → 选 MylaDayWidget。"
a.addAction("好")
await a.present()
