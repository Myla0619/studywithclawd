// 「怎么老是变成休息」——把真实记录摊开看。
//
// 只读，不改任何东西。
//
// 要看的是：那些休息是几点冒出来的、隔多久出现一次、标的是谁切的。
//   · 每隔固定时长冒一次（比如 90 分钟）→ 是提醒通知上的按钮被点到了
//   · 标着「自动」→ 有东西在带参数启动这个脚本
//   · 标着「你」但你没点过 → 那就是我的存盘逻辑有问题
//   · 每天 00:00 那一段延续前一天 → 是跨零点接续，本来就该这样

const C = importModule("MylaDayCore")

const fm = FileManager.local()
const dir = module.filename.slice(0, module.filename.lastIndexOf("/"))
const rows = []
const say = (t, sub) => rows.push([t, sub || ""])

// ---- 手机上装的是哪一版
let onDisk = "读不到"
let ui = "?"
try {
  const core = fm.readString(fm.joinPath(dir, "MylaDayCore.js"))
  const m = core.match(/const VERSION = "([^"]*)"/)
  if (m) onDisk = m[1]
  const main = fm.readString(fm.joinPath(dir, "MylaDay.js"))
  ui = main.indexOf("window.LOG") >= 0 ? "WebView（关窗口时存盘）"
     : main.indexOf("new WebView") >= 0 ? "WebView（旧的，来回通信那版）"
     : "老的 UITable 版"
} catch (e) {}
say("文件里的版本", onDisk)
say("importModule 拿到的", C.VERSION || "（旧的，没有版本号）")
say("界面是哪一版", ui)

// ---- 数据
const data = C.load()          // 故意不 rollover，看原始的
say("每段有没有记来源", hasBy(data) ? "有（新版）" : "没有（这些段是旧版记的）")
say("自动切换保护", data.autoGrace === undefined ? "（旧数据，没这个设置）"
  : data.autoGrace < 0 ? "完全不接受" : data.autoGrace === 0 ? "不保护" : data.autoGrace + " 分钟")
if (data.lastAuto) {
  say("最近一次带参数启动",
    new Date(data.lastAuto.at).toLocaleString() + " · " + (data.lastAuto.name || "?")
    + " · " + (data.lastAuto.ok === false ? "被挡了：" + data.lastAuto.why : "生效了"))
} else {
  say("最近一次带参数启动", "没有记录 —— 说明没有东西在带参数启动这个脚本")
}

// ---- 最近三天的每一段
for (let back = 0; back < 3; back++) {
  const d = new Date(Date.now() - back * 86400000)
  const key = C.dayKey(d)
  const segs = data.days[key] || []
  say("── " + key + (back === 0 ? "（今天）" : ""), segs.length + " 段")
  let prevRestStart = null
  for (const s of segs) {
    const a = C.activityOf(data, s.a)
    const len = C.duration(s, Date.now())
    let note = s.by === "auto" ? "自动切的" : s.by === "me" ? "你切的" : "旧数据，没记来源"
    // 休息之间隔多久 —— 固定间隔就是通知按钮的嫌疑
    if (s.a === "rest" || a.name === "休息") {
      if (prevRestStart != null) note += " · 距上一段休息 " + Math.round((s.s - prevRestStart) / 60) + " 分钟"
      prevRestStart = s.s
    }
    say("  " + C.clock(s.s) + " – " + (s.e == null ? "现在" : C.clock(s.e)) + "  " + a.name,
        C.hhmm(len) + " · " + note)
  }
}

// ---- 待发的通知（提醒的按钮是最大嫌疑）
const pending = await Notification.allPending()
const mine = pending.filter(n => n.identifier.indexOf("myladay") === 0)
say("待发的提醒通知", mine.length ? mine.length + " 条" : "没有")
for (const n of mine) {
  say("  " + (n.title || ""), n.nextTriggerDate ? "会在 " + n.nextTriggerDate.toLocaleString() + " 弹" : "")
}
say("提醒间隔", data.nudgeMinutes === 0 ? "关着" : (data.nudgeMinutes || 90) + " 分钟",)

function hasBy(d) {
  for (const k in d.days) for (const s of d.days[k]) if (s.by) return true
  return false
}

const t = new UITable()
t.showSeparators = true
for (const [title, sub] of rows) {
  const r = new UITableRow()
  r.dismissOnSelect = false
  r.height = sub ? 54 : 38
  const c = r.addText(title, sub)
  c.titleFont = Font.systemFont(14)
  c.subtitleFont = Font.systemFont(12)
  t.addRow(r)
}
await t.present(true)
