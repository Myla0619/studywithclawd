// 存盘通道体检。数据存不下来的时候跑这个。
//
// 页面和脚本之间只有三条路能把东西送回来，我全部押在前两条上，但一条都没在真机上验过：
//   ① shouldAllowRequest —— 页面发起跳转，脚本拦下来。窗口开着时唯一的实时通道。
//   ② 关窗口后 evaluateJavaScript 读页面变量。
//   ③ URL scheme —— 页面跳到 scriptable:///run?...，脚本带参数重跑一遍。最重但最像官方路。
//
// 再加一条最基本的：磁盘读写本身通不通。要是连这个都不行，前三条都白搭。
//
// 全程只写一个 myladay.selftest.json，不碰你的记录。

const C = importModule("MylaCore")

// URL scheme 那条路会带参数重新跑本脚本，回来先报喜
if (args.queryParameters && args.queryParameters.ping) {
  const a = new Alert()
  a.title = "③ URL scheme 通得过 ✅"
  a.message = "页面能通过 scriptable:///run 把东西送回脚本。\n\n这条路一定可用。"
  a.addAction("好")
  await a.present()
  Script.complete()
}

const fm = FileManager.local()
const TEST = fm.joinPath(fm.documentsDirectory(), "myladay.selftest.json")
const results = []

// ---------------------------------------------------------------- ① 磁盘
let diskNote
try {
  const stamp = "t" + Date.now()
  fm.writeString(TEST, JSON.stringify({ stamp }))
  const back = JSON.parse(fm.readString(TEST))
  diskNote = back.stamp === stamp ? "✅ 写得进也读得出" : "❌ 读回来的对不上"
} catch (e) { diskNote = "❌ " + e.message }
results.push(["① 磁盘读写", diskNote])

// 真实的 save/load 走一遍（原子写入那套）
let saveNote
try {
  const probe = C.load()
  const stamp = "s" + Date.now()
  probe.__selftest = stamp
  C.save(probe)
  const again = C.load()
  saveNote = again.__selftest === stamp ? "✅ 存得下来，下次读得到" : "❌ 存了但读不回来"
  delete again.__selftest
  C.save(again)
} catch (e) { saveNote = "❌ " + e.message }
results.push(["  真实的存盘流程", saveNote])

// ---------------------------------------------------------------- ② / ③ 页面通道
const PAGE = `
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:17px -apple-system;background:#131017;color:#F6F1EC;padding:24px;margin:0}
 h2{font-size:19px;margin:0 0 6px}
 p{color:#9a9298;font-size:14px;line-height:1.5;margin:0 0 20px}
 b{display:block;background:#1E1A24;border-radius:14px;padding:16px;margin-bottom:12px;font-weight:400}
 .g{color:#7DD73C}
</style>
<h2>正在测两条通道</h2>
<p>这一页会自己发一次消息给脚本。看完往下滑关掉就行。</p>
<b id="s1">① 实时通道：发送中…</b>
<b>② 关掉这一页之后，脚本会来读这里的变量</b>
<b id="s3" onclick="urlScheme()">③ 点这一行测 URL scheme（会重开一次本脚本）</b>
<script>
 window.__marker = "MARK" + Date.now()          // 关窗口后脚本来读这个
 setTimeout(function () {
   try {
     location.href = "myladay://ping?v=" + encodeURIComponent(window.__marker)
     document.getElementById("s1").innerHTML = '① 实时通道：<span class="g">已发出，等脚本确认</span>'
   } catch (e) {
     document.getElementById("s1").textContent = "① 实时通道：发不出去 " + e.message
   }
 }, 600)
 function urlScheme() {
   location.href = "scriptable:///run?scriptName=MylaTest&ping=1"
 }
</script>`

const wv = new WebView()
await wv.loadHTML(PAGE)

let live = "❌ 没收到（这条通道不工作）"
let liveMarker = null
try {
  wv.shouldAllowRequest = req => {
    const u = (req && req.url) || ""
    if (u.indexOf("myladay://") === 0) {
      live = "✅ 收到了"
      try { liveMarker = decodeURIComponent(u.split("v=")[1] || "") } catch (e) {}
      return false
    }
    return true
  }
} catch (e) { live = "❌ 这个版本没有 shouldAllowRequest：" + e.message }

await wv.present(true)
results.push(["② 实时通道 shouldAllowRequest", live])

let after = "❌ 读不到（这条通道不工作）"
try {
  const v = await wv.evaluateJavaScript("window.__marker")
  after = v ? "✅ 读到了 " + String(v).slice(0, 12) : "❌ 返回空"
} catch (e) { after = "❌ " + e.message }
results.push(["③ 关窗口后读页面变量", after])

if (liveMarker) results.push(["  两条通道拿到的是同一份吗", liveMarker.slice(0, 12)])

// ---------------------------------------------------------------- 结论
const ok1 = live.indexOf("✅") === 0
const ok2 = after.indexOf("✅") === 0
let verdict
if (ok1 && ok2) verdict = "两条都通 —— 那数据丢失是别的原因，把这张图发我"
else if (ok1) verdict = "只有实时通道通 —— 够用，我把兜底那条去掉"
else if (ok2) verdict = "只有关窗口那条通 —— 我把实时通道去掉"
else verdict = "两条都不通 —— 我改用 URL scheme（第 ③ 行那个，你点一下看能不能通）"

try { fm.remove(TEST) } catch (e) {}

const t = new UITable()
t.showSeparators = true
for (const [k, v] of results) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  r.height = 56
  const c = r.addText(k, v)
  c.titleFont = Font.systemFont(14)
  c.subtitleFont = Font.systemFont(13)
  t.addRow(r)
}
const head = new UITableRow()
head.isHeader = true
head.height = 70
head.addText("结论", verdict).subtitleFont = Font.systemFont(13)
t.addRow(head)
await t.present(true)
