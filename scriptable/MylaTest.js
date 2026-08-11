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

// ---------------------------------------------------------------- 页面通道
// 关键实验：连发三次跳转，其中一次轮询挂在中间。
// 真 app 原来就是「跳转 + 轮询」并存的——如果 ping1 到了而 ping2/3 没到，
// 就证明挂起的 evaluateJavaScript 会把桥堵死，吃掉后面的跳转。

const PAGE = `
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font:17px -apple-system;background:#131017;color:#F6F1EC;padding:24px;margin:0}
 h2{font-size:19px;margin:0 0 6px}
 p{color:#9a9298;font-size:14px;line-height:1.5;margin:0 0 20px}
 b{display:block;background:#1E1A24;border-radius:14px;padding:16px;margin-bottom:12px;font-weight:400}
</style>
<h2>正在连发三条消息</h2>
<p>0.5 秒、1.5 秒、2.5 秒各一条。等三秒之后往下滑关掉这一页。</p>
<b id="s">发送中…</b>
<script>
 window.__got = []
 function send(n) {
   try { location.href = "myladay://ping?v=p" + n } catch (e) {}
   window.__got.push(n)
   document.getElementById("s").textContent = "已发出 " + window.__got.join("、")
 }
 setTimeout(function(){ send(1) }, 500)
 setTimeout(function(){ send(2) }, 1500)
 setTimeout(function(){ send(3) }, 2500)
</script>`

const wv = new WebView()
await wv.loadHTML(PAGE)

const arrived = []
wv.shouldAllowRequest = req => {
  const u = (req && req.url) || ""
  if (u.indexOf("myladay://") === 0) {
    arrived.push(u.slice(u.indexOf("v=") + 2))
    return false
  }
  return true
}

// 故意在 ping1 和 ping2 之间发起一次轮询（对已弹出的页面调 evaluateJavaScript）。
// 真 app 原来每两秒就来一次这个。它要是把桥堵死，ping2/ping3 就到不了。
const presented = wv.present(true)
let pollState = "还挂着（没兑现也没报错）"
setTimeoutLike(1000).then(() => {
  wv.evaluateJavaScript("1+1")
    .then(v => { pollState = "返回了 " + v })
    .catch(e => { pollState = "报错：" + e.message })
})
await presented

results.push(["② 三连发（中间夹一次轮询）",
  arrived.length === 3 ? "✅ 三条都到了：" + arrived.join("、")
  : arrived.length ? "⚠️ 只到了 " + arrived.join("、") + " —— 轮询把桥堵死了，后面的被吃掉"
  : "❌ 一条都没到"])
results.push(["  轮询那一下的下场", pollState])

let after = "❌ 读不到"
try {
  const v = await wv.evaluateJavaScript("JSON.stringify(window.__got || [])")
  after = v ? "✅ 读到了 " + v : "❌ 返回空"
} catch (e) { after = "❌ " + e.message }
results.push(["③ 关窗口后读页面变量", after])

function setTimeoutLike(ms) { return new Promise(r => Timer.schedule(ms, false, r)) }

// ---------------------------------------------------------------- 结论
const okAll = arrived.length === 3
const okSome = arrived.length > 0
let verdict
if (okAll) verdict = "三条都到 —— 通道没问题。app 还存不住的话把这张图发我，那就是别的地方。"
else if (okSome) verdict = "只到了一部分 —— 轮询会堵死桥，删掉轮询的版本（20260812-0403 及以后）应该就好了。"
else verdict = "一条都没到 —— 连单发都不行了，把这张图发我。"

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
