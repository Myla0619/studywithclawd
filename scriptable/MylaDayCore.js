// Myla 的一天 — 共用核心：数据读写 + 圆盘绘制 + Clawd
//
// 两个脚本（主脚本和小组件）都 importModule 这一个文件，所以圆盘只有一份实现，
// 不会两边画得不一样。
//
// Scriptable 的 Path 没有 addArc，所有弧线都用多边形逼近；步数按弧长给，
// 肉眼看不出折线。

const fm = FileManager.local()
const DATA = fm.joinPath(fm.documentsDirectory(), "myladay.json")

// ---------------------------------------------------------------- 数据

const DEFAULT_ACTIVITIES = [
  { id: "sleep",    name: "睡觉",  hex: "#476BE1" },
  { id: "class",    name: "上课",  hex: "#B05AE2" },
  { id: "study",    name: "学习",  hex: "#F99243" },
  { id: "research", name: "科研",  hex: "#3AD9AA" },
  { id: "eat",      name: "吃饭",  hex: "#FAD338" },
  { id: "commute",  name: "通勤",  hex: "#40BBE7" },
  { id: "sport",    name: "运动",  hex: "#7DD73C" },
  { id: "rest",     name: "休息",  hex: "#F566AD" },
  { id: "phone",    name: "刷手机", hex: "#F2363C" },
  { id: "other",    name: "其他",  hex: "#C4A582" }
]

function load() {
  if (!fm.fileExists(DATA)) return { activities: DEFAULT_ACTIVITIES, days: {} }
  try {
    const d = JSON.parse(fm.readString(DATA))
    if (!d.activities || !d.activities.length) d.activities = DEFAULT_ACTIVITIES
    if (!d.days) d.days = {}
    return d
  } catch (e) {
    return { activities: DEFAULT_ACTIVITIES, days: {} }
  }
}

function save(d) { fm.writeString(DATA, JSON.stringify(d)) }

function dayKey(date) {
  const d = date || new Date()
  const p = n => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function startOfDay(date) {
  const d = new Date(date || Date.now())
  d.setHours(0, 0, 0, 0)
  return d
}

function segments(data, key) { return data.days[key || dayKey()] || [] }

function openSegment(segs) {
  for (let i = segs.length - 1; i >= 0; i--) if (segs[i].e == null) return segs[i]
  return null
}

/** 跨零点：昨天还开着的那段在午夜切断，今天用同一个状态接上。 */
function rollover(data) {
  const today = dayKey()
  if ((data.days[today] || []).length) return data

  const y = new Date(Date.now() - 86400000)
  const yk = dayKey(y)
  const prev = data.days[yk] || []
  const open = openSegment(prev)
  if (!open) return data

  const midnight = Math.floor(startOfDay().getTime() / 1000)
  open.e = midnight
  data.days[today] = [{ id: uid(), a: open.a, s: midnight, e: null }]
  return data
}

/** 切状态：关掉当前那段，从这一刻开新的。24 小时不留空档。 */
function switchTo(data, activityID, when) {
  const t = Math.floor((when || Date.now()) / 1000)
  rollover(data)
  const key = dayKey(new Date(t * 1000))
  const segs = data.days[key] || (data.days[key] = [])
  const open = openSegment(segs)
  if (open) {
    if (open.a === activityID) return data      // 已经在这个状态了
    open.e = t
  }
  segs.push({ id: uid(), a: activityID, s: t, e: null })
  return data
}

/** 把一段从 when 切两半，后半段换成别的状态。用来修忘了切的时段。 */
function splitSegment(data, key, segID, when, laterID) {
  const segs = data.days[key] || []
  const i = segs.findIndex(s => s.id === segID)
  if (i < 0) return data
  const t = Math.floor(when / 1000)
  const old = segs[i]
  if (t <= old.s || (old.e != null && t >= old.e)) return data
  const tail = { id: uid(), a: laterID, s: t, e: old.e }
  segs[i].e = t
  segs.splice(i + 1, 0, tail)
  return data
}

function duration(seg, now) {
  const end = seg.e != null ? seg.e : Math.floor((now || Date.now()) / 1000)
  return Math.max(0, end - seg.s)
}

function totals(segs, now) {
  const out = {}
  for (const s of segs) out[s.a] = (out[s.a] || 0) + duration(s, now)
  return out
}

function uid() { return Math.random().toString(36).slice(2, 10) }

function hhmm(secs) {
  const m = Math.round(secs / 60)
  return m >= 60 ? `${Math.floor(m / 60)} 小时 ${m % 60} 分` : `${m} 分钟`
}

function clock(epochSecs) {
  const d = new Date(epochSecs * 1000)
  const p = n => String(n).padStart(2, "0")
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function activityOf(data, id) {
  return data.activities.find(a => a.id === id) ||
         { id: id, name: id, hex: "#6B6B70" }
}

// ---------------------------------------------------------------- 绘制

/** 圆环上一段扇形。角度用「一天的比例」表示，0 = 零点在正上方，顺时针。 */
function ringSlice(ctx, cx, cy, rIn, rOut, t0, t1, color, alpha) {
  const steps = Math.max(2, Math.ceil((t1 - t0) * 240))
  const pts = []
  const at = (t, r) => {
    const a = t * 2 * Math.PI - Math.PI / 2
    return new Point(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
  }
  for (let i = 0; i <= steps; i++) pts.push(at(t0 + (t1 - t0) * i / steps, rOut))
  for (let i = steps; i >= 0; i--) pts.push(at(t0 + (t1 - t0) * i / steps, rIn))
  const p = new Path()
  p.addLines(pts)
  p.closeSubpath()
  ctx.addPath(p)
  ctx.setFillColor(alpha === undefined ? new Color(color) : new Color(color, alpha))
  ctx.fillPath()
}

/**
 * 24 小时圆盘。size 是正方形边长（点）。
 * segs 是当天的时间段，now 是当前时间（毫秒）。
 */
function drawDial(data, segs, size, opts) {
  opts = opts || {}
  const now = opts.now || Date.now()
  const ctx = new DrawContext()
  ctx.size = new Size(size, size)
  ctx.opaque = false
  ctx.respectScreenScale = true

  // 自带底色：Scriptable 的表格会跟系统走浅色，透明底的话浅色文字和
  // 淡轨道全都看不见。画成一张自带深底的卡片，两种模式下长一样。
  if (opts.card !== false) {
    const card = new Path()
    card.addRoundedRect(new Rect(0, 0, size, size), size * 0.5, size * 0.5)
    ctx.addPath(card)
    ctx.setFillColor(new Color("#1B1720"))
    ctx.fillPath()
  }

  const cx = size / 2, cy = size / 2
  const rOut = size / 2 - 1
  const rIn = rOut * (1 - (opts.thickness || 0.26))
  const dayStart = startOfDay(new Date(now)).getTime() / 1000
  const turn = s => Math.min(1, Math.max(0, (s - dayStart) / 86400))

  // 还没到的时间：一圈暗轨道
  ringSlice(ctx, cx, cy, rIn, rOut, 0, 1, "#FFFFFF", 0.07)

  for (const seg of segs) {
    const t0 = turn(seg.s)
    const t1 = turn(seg.e != null ? seg.e : Math.floor(now / 1000))
    if (t1 <= t0) continue
    ringSlice(ctx, cx, cy, rIn, rOut, t0, t1, activityOf(data, seg.a).hex)
  }

  if (opts.ticks !== false) {
    for (let h = 0; h < 24; h += 3) {
      const a = (h / 24) * 2 * Math.PI - Math.PI / 2
      const r0 = rIn - size * 0.012, r1 = rIn - size * 0.045
      const p = new Path()
      p.addLines([
        new Point(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0),
        new Point(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1)
      ])
      ctx.addPath(p)
      ctx.setStrokeColor(new Color(h === 0 ? "#FFFFFF" : "#FFFFFF", h === 0 ? 0.45 : 0.18))
      ctx.setLineWidth(Math.max(1, size * 0.006))
      ctx.strokePath()
    }
  }

  // 「现在」那条细线
  const na = turn(Math.floor(now / 1000)) * 2 * Math.PI - Math.PI / 2
  const hand = new Path()
  hand.addLines([
    new Point(cx + Math.cos(na) * (rIn - size * 0.01), cy + Math.sin(na) * (rIn - size * 0.01)),
    new Point(cx + Math.cos(na) * (rOut + size * 0.012), cy + Math.sin(na) * (rOut + size * 0.012))
  ])
  ctx.addPath(hand)
  ctx.setStrokeColor(new Color("#FFFFFF", 0.85))
  ctx.setLineWidth(Math.max(1.5, size * 0.008))
  ctx.strokePath()

  const open = openSegment(segs)
  const cur = open ? activityOf(data, open.a) : null
  drawClawd(ctx, cx, cy + size * 0.010, size * 0.0042, cur ? cur.id : null)

  if (cur) {
    ctx.setTextAlignedCenter()
    ctx.setTextColor(new Color("#F6F1EC"))
    ctx.setFont(Font.boldSystemFont(size * 0.072))
    ctx.drawTextInRect(cur.name,
      new Rect(0, cy + size * 0.045, size, size * 0.10))
    if (opts.ticks !== false) {
      ctx.setTextColor(new Color("#FFFFFF", 0.5))
      ctx.setFont(Font.systemFont(size * 0.050))
      ctx.drawTextInRect("已经 " + hhmm(duration(open, now)),
        new Rect(0, cy + size * 0.140, size, size * 0.08))
    }
  }
  return ctx.getImage()
}

/** 一小段粗线，用一串圆点画出来 —— DrawContext 没有线帽也不能旋转。 */
function fatLine(ctx, x0, y0, x1, y1, w, color) {
  ctx.setFillColor(new Color(color))
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (w * 0.35)) + 1
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n
    ctx.fillEllipse(new Rect(x - w / 2, y - w / 2, w, w))
  }
}

/**
 * 圆滚滚那只 Clawd。k 是缩放，act 是当前状态 id —— 不同状态给不同动作。
 * 颜色固定用 Clawd 自己的橙，不跟着状态变。
 */
function drawClawd(ctx, cx, baseY, k, act, hexOverride) {
  const HEX = hexOverride || "#E88E68"
  const SH = shadeHex(HEX)
  const cream = "#FFFAF4", ink = "#5A4A44"
  const X = x => cx + x * k
  const Y = y => baseY - y * k
  const R = (x, y, w, h) => new Rect(X(x), Y(y + h), w * k, h * k)
  const fill = c => ctx.setFillColor(new Color(c))
  const poly = (pts, c) => {
    const q = new Path(); q.addLines(pts); q.closeSubpath()
    ctx.addPath(q); fill(c); ctx.fillPath()
  }

  // 每个状态：手的位置、脚要不要错开、眼睛怎么画、附带什么道具
  let handL = [-31, 14], handR = [31, 14]
  let stride = 0                      // 走路时两脚错开
  let eyes = "open"
  const props = []                    // 画在身体之后

  switch (act) {
    case "sleep":
      eyes = "shut"; handL = [-30, 10]; handR = [30, 10]
      props.push("zzz"); break
    case "class":
      handR = [30, 46]; break                       // 举手
    case "study":
      handL = [-13, 13]; handR = [13, 13]; props.push("book"); break
    case "research":
      handL = [-15, 11]; handR = [15, 11]; props.push("laptop"); break
    case "eat":
      handL = [-13, 11]; handR = [15, 20]; props.push("bowl"); break
    case "commute":
      stride = 5; handL = [-30, 20]; handR = [30, 8]; props.push("bag"); break
    case "sport":
      eyes = "happy"; handL = [-24, 46]; handR = [24, 46]
      props.push("dumbbell"); break
    case "rest":
      handR = [26, 22]; props.push("mug"); break
    case "phone":
      eyes = "down"; handL = [-9, 15]; handR = [9, 15]; props.push("phone"); break
  }

  // 脚
  fill(SH)
  ctx.fillEllipse(R(-18 - stride, -4, 15, 9))
  ctx.fillEllipse(R(3 + stride, -4, 15, 9))

  // 手臂（先画，压在身体下面）
  for (const [side, h] of [[-1, handL], [1, handR]]) {
    fatLine(ctx, X(23 * side), Y(30), X(h[0]), Y(h[1]), 8 * k, HEX)
    fill(SH); ctx.fillEllipse(R(h[0] - 4.5, h[1] - 4.5, 9, 9))
  }

  // 背包：画在身体后面才像背着
  if (props.includes("bag")) {
    let q = new Path()
    q.addRoundedRect(R(-33, 13, 15, 22), 5 * k, 5 * k)
    ctx.addPath(q); fill("#8B6F5E"); ctx.fillPath()
  }

  // 身体和肚皮
  let p = new Path(); p.addRoundedRect(R(-27, 0, 54, 48), 19 * k, 19 * k)
  ctx.addPath(p); fill(HEX); ctx.fillPath()
  p = new Path(); p.addRoundedRect(R(-15, 3, 30, 22), 10 * k, 10 * k)
  ctx.addPath(p); fill(cream); ctx.fillPath()

  // 星芒呆毛
  fill(SH)
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 2 * Math.PI
    const len = (i % 2 === 0 ? 11.5 : 7.8) * k, w = 1.1 * k
    const bx = X(0), by = Y(50)
    const dx = Math.sin(a), dy = -Math.cos(a)
    const px = -dy, py = dx
    const q = new Path()
    q.addLines([
      new Point(bx + dx * 1.2 * k - px * w, by + dy * 1.2 * k - py * w),
      new Point(bx + dx * 1.2 * k + px * w, by + dy * 1.2 * k + py * w),
      new Point(bx + dx * len + px * w, by + dy * len + py * w),
      new Point(bx + dx * len - px * w, by + dy * len - py * w)
    ])
    q.closeSubpath(); ctx.addPath(q); ctx.fillPath()
  }

  // 腮红
  fill("#F09FB4")
  ctx.setFillColor(new Color("#F09FB4", 0.55))
  ctx.fillEllipse(R(-22, 27, 7, 5)); ctx.fillEllipse(R(15, 27, 7, 5))

  // 眼睛
  fill(ink)
  if (eyes === "shut") {
    ctx.fillEllipse(R(-13.5, 35, 8, 1.8)); ctx.fillEllipse(R(5.5, 35, 8, 1.8))
  } else if (eyes === "down") {
    ctx.fillEllipse(R(-13.5, 32, 8, 4.5)); ctx.fillEllipse(R(5.5, 32, 8, 4.5))
  } else if (eyes === "happy") {
    for (const sx of [-9.5, 9.5]) {
      const arc = []
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (0.15 + 0.7 * i / 8)
        arc.push(new Point(X(sx) + Math.cos(a) * 4.5 * k, Y(34) - Math.sin(a) * 4.5 * k))
      }
      const q = new Path(); q.addLines(arc)
      ctx.addPath(q); ctx.setStrokeColor(new Color(ink)); ctx.setLineWidth(2 * k); ctx.strokePath()
    }
  } else {
    ctx.fillEllipse(R(-13.5, 32, 8, 8)); ctx.fillEllipse(R(5.5, 32, 8, 8))
  }

  // 嘴
  if (eyes !== "shut") {
    const mouth = []
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (1.18 + (0.64 * i) / 10)
      mouth.push(new Point(X(0) + Math.cos(a) * 5.5 * k, Y(32) - Math.sin(a) * 5.5 * k))
    }
    const m = new Path(); m.addLines(mouth)
    ctx.addPath(m); ctx.setStrokeColor(new Color(ink)); ctx.setLineWidth(2 * k); ctx.strokePath()
  }

  // 道具，画在最前面
  const holding = props.some(x => ["book", "laptop", "phone", "bowl"].includes(x))
  for (const prop of props) {
    if (prop === "book") {
      let q = new Path(); q.addRoundedRect(R(-15, 6, 30, 15), 2 * k, 2 * k)
      ctx.addPath(q); fill("#F2363C"); ctx.fillPath()
      fill("#FFFAF4")
      for (let i = 0; i < 3; i++) ctx.fillEllipse(R(-11, 16 - i * 4, 22, 1.6))
    }
    if (prop === "laptop") {
      let q = new Path(); q.addRoundedRect(R(-17, 5, 34, 19), 2 * k, 2 * k)
      ctx.addPath(q); fill("#3A3F47"); ctx.fillPath()
      fill("#3AD9AA")
      for (const [dx, w2, dy] of [[0, 16, 19], [0, 9, 15], [0, 21, 11], [0, 13, 7]])
        ctx.fillEllipse(R(-13 + dx, dy, w2, 1.8))
    }
    if (prop === "bowl") {
      poly([new Point(X(-14), Y(17)), new Point(X(14), Y(17)),
            new Point(X(9), Y(4)), new Point(X(-9), Y(4))], "#40BBE7")
      fill("#FAD338"); ctx.fillEllipse(R(-14, 15.5, 28, 5))   // 碗里的饭
      fill("#7FB4CC"); ctx.fillEllipse(R(-14.5, 16.5, 29, 2.5)) // 碗沿
    }
    if (prop === "mug") {
      let q = new Path(); q.addRoundedRect(R(22, 16, 12, 13), 2 * k, 2 * k)
      ctx.addPath(q); fill("#FFFAF4"); ctx.fillPath()
      fill("#8B6F5E"); ctx.fillEllipse(R(23.5, 25, 9, 3))
    }
    if (prop === "phone") {
      let q = new Path(); q.addRoundedRect(R(-7, 9, 14, 21), 2.5 * k, 2.5 * k)
      ctx.addPath(q); fill("#3A3F47"); ctx.fillPath()
      q = new Path(); q.addRoundedRect(R(-5.5, 11, 11, 17), 1.5 * k, 1.5 * k)
      ctx.addPath(q); fill("#40BBE7"); ctx.fillPath()
    }
    if (prop === "dumbbell") {
      fill("#6B6F76")
      ctx.fillEllipse(R(-30, 42, 9, 9)); ctx.fillEllipse(R(21, 42, 9, 9))
      ctx.fillEllipse(R(-22, 45, 44, 3))
    }
    if (prop === "strap") { /* 占位，实际在下面画 */ }
    if (prop === "zzz") {
      fill("#40BBE7")
      const zs = [[20, 52, 4], [27, 60, 5.5], [35, 69, 7]]
      for (const [zx, zy, zw] of zs) {
        ctx.fillEllipse(R(zx, zy + zw * 0.75, zw, 1.6))
        ctx.fillEllipse(R(zx, zy, zw, 1.6))
        poly([new Point(X(zx + zw), Y(zy + zw * 0.75)), new Point(X(zx + zw * 0.75), Y(zy + zw * 0.75)),
              new Point(X(zx), Y(zy + 1.6)), new Point(X(zx + zw * 0.25), Y(zy + 1.6))], "#40BBE7")
      }
    }
  }

  // 背包带：斜挎过胸口，这样背包才像背着而不是放在旁边
  if (props.includes("bag")) {
    fatLine(ctx, X(-20), Y(40), X(6), Y(14), 3 * k, SH)
  }

  // 抱着东西时，手补画在道具之上
  if (holding) {
    fill(SH)
    ctx.fillEllipse(R(handL[0] - 4.5, handL[1] - 4.5, 9, 9))
    ctx.fillEllipse(R(handR[0] - 4.5, handR[1] - 4.5, 9, 9))
  }
}

/** 同色系但更深一档，用于脚和呆毛。 */
function shadeHex(hex) {
  const h = hex.replace("#", "")
  const n = parseInt(h, 16)
  const f = 0.86
  const r = Math.round(((n >> 16) & 255) * f)
  const g = Math.round(((n >> 8) & 255) * f)
  const b = Math.round((n & 255) * f)
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("")
}

module.exports = {
  load, save, dayKey, startOfDay, segments, openSegment, rollover,
  switchTo, splitSegment, duration, totals, hhmm, clock, activityOf,
  drawDial, drawClawd, DEFAULT_ACTIVITIES, DATA
}
