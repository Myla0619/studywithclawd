// ClawdStudy — a desktop study supervisor.
//
// Today's task list, a focus countdown per task, and a plushie that watches you
// do it. Resting is gated on the countdown finishing; giving up costs a second
// confirmation and goes on today's record.
//
// Build: swiftc -O -o clawd ClawdStudy.swift ~/.claude/shared/Clawd.swift -framework AppKit
//
// Clawd itself is the shared pixel sprite in ~/.claude/shared/Clawd.swift; the
// panel chrome below is this app's own.

import AppKit

// MARK: - Palette

let kOrange  = NSColor(srgbRed: 0.851, green: 0.467, blue: 0.341, alpha: 1)
let kOrangeD = NSColor(srgbRed: 0.706, green: 0.353, blue: 0.239, alpha: 1)
let kCream   = NSColor(srgbRed: 0.976, green: 0.949, blue: 0.910, alpha: 1)
let kInk     = NSColor(srgbRed: 0.169, green: 0.129, blue: 0.098, alpha: 1)
let kPink    = NSColor(srgbRed: 0.941, green: 0.549, blue: 0.502, alpha: 0.55)
let kGold    = NSColor(srgbRed: 1.000, green: 0.816, blue: 0.365, alpha: 1)
let kPanel   = NSColor(srgbRed: 0.106, green: 0.106, blue: 0.125, alpha: 0.97)
let kEdge    = NSColor(white: 1, alpha: 0.10)
let kGreen   = NSColor(srgbRed: 0.290, green: 0.720, blue: 0.450, alpha: 1)
let kRed     = NSColor(srgbRed: 0.851, green: 0.365, blue: 0.353, alpha: 1)
let kText    = NSColor(white: 0.95, alpha: 1)
let kDim     = NSColor(white: 0.95, alpha: 0.45)
let kDesk    = NSColor(srgbRed: 0.376, green: 0.298, blue: 0.235, alpha: 1)
let kDeskEdge = NSColor(srgbRed: 0.278, green: 0.216, blue: 0.169, alpha: 1)

// MARK: - Drawing primitives

@inline(__always) func fillRound(_ c: CGContext, _ r: CGRect, _ rad: CGFloat, _ col: NSColor) {
    c.addPath(CGPath(roundedRect: r, cornerWidth: rad, cornerHeight: rad, transform: nil))
    c.setFillColor(col.cgColor)
    c.fillPath()
}

@inline(__always) func strokeRound(_ c: CGContext, _ r: CGRect, _ rad: CGFloat,
                                   _ col: NSColor, _ w: CGFloat = 1) {
    c.addPath(CGPath(roundedRect: r, cornerWidth: rad, cornerHeight: rad, transform: nil))
    c.setStrokeColor(col.cgColor)
    c.setLineWidth(w)
    c.strokePath()
}

@inline(__always) func fillOval(_ c: CGContext, _ r: CGRect, _ col: NSColor) {
    c.setFillColor(col.cgColor)
    c.fillEllipse(in: r)
}

@inline(__always) func limb(_ c: CGContext, _ a: CGPoint, _ b: CGPoint,
                            _ w: CGFloat, _ col: NSColor) {
    c.setLineCap(.round)
    c.setLineWidth(w)
    c.setStrokeColor(col.cgColor)
    c.move(to: a)
    c.addLine(to: b)
    c.strokePath()
}

func sunburst(_ c: CGContext, at p: CGPoint, radius R: CGFloat, rotation: CGFloat, _ col: NSColor) {
    c.saveGState()
    c.translateBy(x: p.x, y: p.y)
    c.rotate(by: rotation)
    c.setFillColor(col.cgColor)
    for i in 0..<11 {
        let len = R * (i % 2 == 0 ? 1.0 : 0.68)
        let w = R * 0.19
        c.saveGState()
        c.rotate(by: CGFloat(i) / 11 * .pi * 2)
        c.addPath(CGPath(roundedRect: CGRect(x: -w / 2, y: R * 0.10, width: w, height: len),
                         cornerWidth: w / 2, cornerHeight: w / 2, transform: nil))
        c.fillPath()
        c.restoreGState()
    }
    c.restoreGState()
}

func sparkle(_ c: CGContext, at p: CGPoint, size s: CGFloat, _ col: NSColor) {
    guard s > 0.4 else { return }
    let path = CGMutablePath()
    let w = s * 0.26
    path.move(to: CGPoint(x: p.x, y: p.y + s))
    path.addQuadCurve(to: CGPoint(x: p.x + s, y: p.y), control: CGPoint(x: p.x + w, y: p.y + w))
    path.addQuadCurve(to: CGPoint(x: p.x, y: p.y - s), control: CGPoint(x: p.x + w, y: p.y - w))
    path.addQuadCurve(to: CGPoint(x: p.x - s, y: p.y), control: CGPoint(x: p.x - w, y: p.y - w))
    path.addQuadCurve(to: CGPoint(x: p.x, y: p.y + s), control: CGPoint(x: p.x - w, y: p.y + w))
    path.closeSubpath()
    c.addPath(path)
    c.setFillColor(col.cgColor)
    c.fillPath()
}

enum Align { case left, center, right }

@discardableResult
func text(_ s: String, at p: CGPoint, size: CGFloat = 12, weight: NSFont.Weight = .regular,
          color: NSColor = kText, align: Align = .left, mono: Bool = false) -> CGFloat {
    let f = mono ? NSFont.monospacedDigitSystemFont(ofSize: size, weight: weight)
                 : NSFont.systemFont(ofSize: size, weight: weight)
    let a = NSAttributedString(string: s, attributes: [.font: f, .foregroundColor: color])
    let w = a.size().width
    var x = p.x
    switch align {
    case .left:   break
    case .center: x -= w / 2
    case .right:  x -= w
    }
    a.draw(at: CGPoint(x: x, y: p.y))
    return w
}

func truncate(_ s: String, _ n: Int) -> String {
    s.count > n ? String(s.prefix(n - 1)) + "…" : s
}

func mmss(_ sec: Int) -> String {
    let s = max(0, sec)
    return String(format: "%d:%02d", s / 60, s % 60)
}

// MARK: - Model

struct StudyTask: Codable, Equatable {
    var id: String
    var title: String
    var done: Bool
    var focusedSec: Int
}

struct DayLog: Codable {
    var date: String
    var tasks: [StudyTask]
    var giveups: Int                 // still recorded, deliberately never displayed
    var longestSec: Int?             // optional so older files still decode
}

/// Built once — a fresh DateFormatter per frame is surprisingly expensive.
private let dayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

func todayKey() -> String { dayFormatter.string(from: Date()) }

final class Store {
    private let root = NSString(string: "~/.claude/clawd").expandingTildeInPath
    private(set) var day: DayLog

    init() {
        day = DayLog(date: todayKey(), tasks: [], giveups: 0, longestSec: 0)
        try? FileManager.default.createDirectory(atPath: root + "/days",
                                                 withIntermediateDirectories: true)
        load()
        regenerateSummary()
    }

    private func path(_ date: String) -> String { root + "/days/" + date + ".json" }

    private func load() {
        let key = todayKey()
        if let d = FileManager.default.contents(atPath: path(key)),
           let log = try? JSONDecoder().decode(DayLog.self, from: d) {
            day = log
            return
        }
        // First run of a new day: carry unfinished work forward, leave the rest behind.
        var carried: [StudyTask] = []
        if let prev = mostRecentLog(before: key) {
            carried = prev.tasks.filter { !$0.done }.map {
                StudyTask(id: UUID().uuidString, title: $0.title, done: false, focusedSec: 0)
            }
        }
        day = DayLog(date: key, tasks: carried, giveups: 0, longestSec: 0)
        save()
    }

    private func mostRecentLog(before key: String) -> DayLog? {
        let dir = root + "/days"
        let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? [])
            .filter { $0.hasSuffix(".json") && $0 < key + ".json" }
            .sorted()
        guard let last = files.last,
              let d = FileManager.default.contents(atPath: dir + "/" + last) else { return nil }
        return try? JSONDecoder().decode(DayLog.self, from: d)
    }

    func save() {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted]
        guard let d = try? e.encode(day) else { return }
        try? d.write(to: URL(fileURLWithPath: path(day.date)), options: .atomic)
    }

    /// One section per day, newest first, rebuilt from the day files so it can
    /// never drift out of sync with them.
    func regenerateSummary() {
        let dir = root + "/days"
        let files = ((try? FileManager.default.contentsOfDirectory(atPath: dir)) ?? [])
            .filter { $0.hasSuffix(".json") }
            .sorted(by: >)

        var out = "# Clawd 学习记录\n\n_每天一份，自动生成，别手改_\n"
        for f in files {
            guard let d = FileManager.default.contents(atPath: dir + "/" + f),
                  let log = try? JSONDecoder().decode(DayLog.self, from: d),
                  !log.tasks.isEmpty else { continue }

            let focus = log.tasks.reduce(0) { $0 + $1.focusedSec } / 60
            let done = log.tasks.filter(\.done).count
            let longest = (log.longestSec ?? 0) / 60

            out += "\n## \(log.date)\n\n"
            var line = "专注 \(focus) 分钟 · 完成 \(done)/\(log.tasks.count)"
            if longest > 0 { line += " · 最长 \(longest) 分钟" }
            out += line + "\n\n"
            // Same order as the panel: what is left first, finished underneath.
            for t in log.tasks.filter({ !$0.done }) + log.tasks.filter({ $0.done }) {
                let box = t.done ? "x" : " "
                let mins = t.focusedSec >= 60 ? "（\(t.focusedSec / 60) 分钟）" : ""
                out += "- [\(box)] \(t.title)\(mins)\n"
            }
        }
        try? out.write(toFile: root + "/summary.md", atomically: true, encoding: .utf8)
    }

    /// Returns true when the calendar day changed and the list was swapped out.
    func rolloverIfNeeded() -> Bool {
        guard day.date != todayKey() else { return false }
        load()
        regenerateSummary()          // yesterday gets written up before it scrolls away
        return true
    }

    func add(_ title: String) {
        let t = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        day.tasks.append(StudyTask(id: UUID().uuidString, title: String(t.prefix(60)),
                                   done: false, focusedSec: 0))
        save()
    }

    func toggleDone(_ id: String) {
        guard let i = day.tasks.firstIndex(where: { $0.id == id }) else { return }
        day.tasks[i].done.toggle()
        save()
    }

    func setDone(_ id: String, _ v: Bool) {
        guard let i = day.tasks.firstIndex(where: { $0.id == id }) else { return }
        day.tasks[i].done = v
        save()
    }

    func remove(_ id: String) {
        day.tasks.removeAll { $0.id == id }
        save()
    }

    func addFocus(_ id: String, _ sec: Int) {
        guard sec > 0, let i = day.tasks.firstIndex(where: { $0.id == id }) else { return }
        day.tasks[i].focusedSec += sec
        save()
    }

    /// Counts up whatever you actually did. Never counts down.
    func recordSitting(_ sec: Int) {
        guard sec > 0 else { return }
        day.longestSec = max(day.longestSec ?? 0, sec)
        save()
    }

    func recordGiveup() {
        day.giveups += 1
        save()
    }

    func task(_ id: String) -> StudyTask? { day.tasks.first { $0.id == id } }

    /// Finished work sinks to the bottom instead of vanishing — it still counts,
    /// it just stops competing for attention with what is left.
    var ordered: [StudyTask] {
        day.tasks.filter { !$0.done } + day.tasks.filter { $0.done }
    }
    var totalFocusSec: Int { day.tasks.reduce(0) { $0 + $1.focusedSec } }
    var doneCount: Int { day.tasks.filter(\.done).count }
    var longestSec: Int { day.longestSec ?? 0 }

    /// Two hours of focus today and Clawd bulks up. Counts total focus, so
    /// several short sittings get you there just as well as one long one.
    static let buffThresholdSec = 2 * 60 * 60
    var isBuff: Bool { totalFocusSec >= Store.buffThresholdSec }
}

// MARK: - Focus session

struct Session: Codable {
    var taskID: String
    var plannedMin: Int
    var startedAt: Date
    var endsAt: Date

    var remaining: Int { Int(endsAt.timeIntervalSinceNow.rounded(.up)) }
    var elapsedSec: Int { max(0, Int(Date().timeIntervalSince(startedAt))) }
    var isUp: Bool { remaining <= 0 }
}

/// Desk scenery on/off. Static art only — it adds nothing that moves.
enum Scene {
    static var enabled: Bool {
        !FileManager.default.fileExists(
            atPath: NSString(string: "~/.claude/clawd/no-scene").expandingTildeInPath)
    }
}

/// What Clawd holds while you are in a sitting.
enum Prop: String {
    case laptop     // studies alongside you — the body-doubling reading
    case whip       // supervises you — the other reading
    case none

    static func load() -> Prop {
        let f = NSString(string: "~/.claude/clawd/prop").expandingTildeInPath
        let raw = ((try? String(contentsOfFile: f, encoding: .utf8)) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return Prop(rawValue: raw) ?? .laptop
    }
}

enum Phase {
    case idle
    case picking(String)      // task id, choosing a duration
    case running(Session)
    case paused(Session)      // restored from disk; never resumes without a click
    case finished(Session)
    case stopped(Date)        // just stopped early — no sad face, no tally
}

// MARK: - Idle beats

/// Little one-off actions Clawd plays while supervising, so a 25 minute sitting
/// is not one frozen pose. One fires every few seconds, picked at random.
enum Beat: CaseIterable {
    case blink2, lean, stretch, sip, tap, lookAway, doze, nod

    var dur: CGFloat {
        switch self {
        case .blink2:   return 0.7
        case .lean:     return 1.8
        case .stretch:  return 1.5
        case .sip:      return 2.4
        case .tap:      return 1.2
        case .lookAway: return 2.0
        case .doze:     return 3.2
        case .nod:      return 1.0
        }
    }
}

// MARK: - Hit testing

enum Hit {
    case toggleDone(String)
    case startTask(String)
    case deleteTask(String)
    case pickMinutes(Int)
    case cancelPick
    case giveUp
    case rest
    case again
    case collapse
    case expand
    case resume
    case discard
    case hide
    case unhide
    case quitApp
}

// MARK: - View

final class ClawdView: NSView {
    var store: Store!

    var phase: Phase = .idle
    var collapsed = false
    var edge = false   // 贴边最小化：只剩边框上一个小舌头
    var t: CGFloat = 0
    var gaze = CGPoint.zero
    var listOffset = 0
    var cheerAt: CGFloat = -999

    /// Off by default. Looping motion beside something you are reading is the
    /// first thing ADHD design guidance says to drop.
    var animate = false
    var prop: Prop = .laptop

    fileprivate var beat: Beat?
    fileprivate var beatAt: CGFloat = 0
    private var nextBeat: CGFloat = 3
    private var lastBeat: Beat?

    var onHit: ((Hit) -> Void)?
    var onDragEnd: ((NSPoint) -> Void)?

    private var hits: [(CGRect, Hit)] = []
    private var dragAnchor = CGPoint.zero
    private var winAnchor = CGPoint.zero
    private var dragging = false

    let field = NSTextField()

    let rowH: CGFloat = 30
    let maxRows = 6
    let pad: CGFloat = 14

    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for e: NSEvent?) -> Bool { true }
    override var isFlipped: Bool { false }

    /// Runs one beat at a time, with a random gap in between.
    func stepBeats() {
        // Beats fire on their own during a sitting — they are occasional one-offs,
        // not the looping ambient motion that `animate` controls.
        // 贴纸态不能当死物：待命/暂停/歇着也偶尔眨眼、张望、打个瞌睡。
        // 展开面板保持原来的克制（只有专注时动），那是特意为 ADHD 收敛过的。
        var lively = collapsed
        if case .running = phase { lively = true }
        guard lively else {
            beat = nil
            nextBeat = t + 4
            return
        }
        if let b = beat {
            if t - beatAt >= b.dur {
                beat = nil
                // Sparse by default; `motion on` makes it lively.
                nextBeat = t + (animate ? CGFloat.random(in: 2.0...5.0)
                                        : CGFloat.random(in: 8.0...20.0))
            }
            return
        }
        guard t >= nextBeat else { return }
        var pick = Beat.allCases.randomElement()!
        if pick == lastBeat { pick = Beat.allCases.randomElement()! }   // avoid repeats
        beat = pick
        lastBeat = pick
        beatAt = t
        if ProcessInfo.processInfo.environment["CLAWD_TRACE"] != nil {
            FileHandle.standardError.write("beat: \(pick)\n".data(using: .utf8)!)
        }
    }

    /// Force a beat for the offscreen preview.
    func debugBeat(_ b: Beat, at p: CGFloat) {
        beat = b
        beatAt = t - p
    }

    // MARK: Geometry

    /// Height the expanded panel needs for the current phase and task count.
    func neededHeight() -> CGFloat {
        if edge { return 88 }
        if collapsed { return 150 }        // 桌子带 + 状态条
        var h: CGFloat = 0
        h += 24            // header
        h += 116           // clawd
        h += 26            // status pill
        h += phasePanelHeight()
        h += 26            // list header
        h += rowH * CGFloat(min(max(store.day.tasks.count, 1), maxRows))
        if store.day.tasks.count > maxRows { h += 16 }
        h += 38            // input
        h += 24            // footer
        h += pad
        return h
    }

    /// Must match exactly what drawPhasePanel consumes, or the panel clips.
    private func phasePanelHeight() -> CGFloat {
        switch phase {
        case .idle, .stopped: return 30          // 30
        case .paused:         return 84
        case .picking:        return 74          // 24 title + 30 buttons + 20 cancel
        case .running:        return 104         // 22 + 38 countdown + 14 bar + 30 buttons
        case .finished:       return 96          // 22 + 34 + 40
        }
    }

    // MARK: Draw

    override func draw(_ dirty: NSRect) {
        guard let c = NSGraphicsContext.current?.cgContext else { return }
        c.clear(bounds)
        hits.removeAll()

        // Edge is the smallest it gets: a little tab on the screen border.
        // 用户点名要的：缩到最小也必须在边框上看得见——彻底消失过一次就找不回来了。
        if edge { drawEdgeTab(c); return }
        // Collapsed is a sticker: no card, just Clawd and one line.
        if collapsed { drawCollapsed(c); return }

        fillRound(c, bounds.insetBy(dx: 1, dy: 1), 18, kPanel)
        strokeRound(c, bounds.insetBy(dx: 1, dy: 1), 18, kEdge)

        var y = bounds.height - pad - 14

        // Header
        text("Clawd 陪你学", at: CGPoint(x: pad, y: y), size: 11.5, weight: .semibold, color: kDim)
        let cr = CGRect(x: bounds.width - pad - 22, y: y - 4, width: 22, height: 20)
        text("—", at: CGPoint(x: cr.midX, y: y - 1), size: 13, weight: .bold,
             color: kDim, align: .center)
        hits.append((cr, .collapse))
        y -= 18

        // Clawd
        drawClawd(c, cx: bounds.midX, baseY: y - 104, scale: 1.0)
        y -= 116

        // Status pill
        let (label, tint) = statusLine()
        pill(c, label, cx: bounds.midX, cy: y + 4, bg: tint)
        y -= 26

        y = drawPhasePanel(c, top: y)

        // List header
        let n = store.day.tasks.count
        text("今天要做的", at: CGPoint(x: pad, y: y - 14), size: 11, weight: .semibold, color: kDim)
        text("\(store.doneCount)/\(n)", at: CGPoint(x: bounds.width - pad, y: y - 14),
             size: 11, weight: .semibold, color: kDim, align: .right)
        y -= 26

        // Rows
        if n == 0 {
            text("还没有任务，下面加一条 ↓", at: CGPoint(x: bounds.midX, y: y - 20),
                 size: 11.5, color: NSColor(white: 0.95, alpha: 0.3), align: .center)
            y -= rowH
        } else {
            let maxOff = max(0, n - maxRows)
            listOffset = min(listOffset, maxOff)
            let slice = Array(store.ordered.dropFirst(listOffset).prefix(maxRows))
            for task in slice {
                drawRow(c, task, top: y)
                y -= rowH
            }
            if n > maxRows {
                let more = n - listOffset - slice.count
                let hint = more > 0 ? "下面还有 \(more) 项 · 滚轮翻" : "滚轮往回翻"
                text(hint, at: CGPoint(x: bounds.midX, y: y - 12), size: 9.5,
                     color: NSColor(white: 0.95, alpha: 0.28), align: .center)
                y -= 16
            }
        }

        // Input field. The chrome is drawn here so it also shows in offscreen renders;
        // the NSTextField itself sits on top with no background of its own.
        y -= 8
        let fr = CGRect(x: pad, y: y - 22, width: bounds.width - pad * 2, height: 24)
        fillRound(c, fr, 7, NSColor(white: 1, alpha: 0.07))
        if field.stringValue.isEmpty && window?.firstResponder !== field.currentEditor() {
            var ph = "加一项今天要做的…"
            if case .picking = phase { ph = "或直接输入分钟数，回车开始" }
            text(ph, at: CGPoint(x: fr.minX + 8, y: fr.midY - 6), size: 11.5,
                 color: NSColor(white: 0.95, alpha: 0.28))
        }
        if field.frame != fr { field.frame = fr }
        y -= 38

        // Footer
        // Effort adds up; nothing here subtracts. Give-ups are recorded in the
        // JSON but never shown — a running failure count is the exact pattern
        // ADHD guidance says drives people to abandon the app.
        let mins = store.totalFocusSec / 60
        var foot = "完成 \(store.doneCount) · 专注 \(mins) 分钟"
        if store.longestSec >= 60 { foot += " · 最长 \(store.longestSec / 60) 分钟" }
        if store.isBuff { foot += " · 强壮形态" }
        text(foot, at: CGPoint(x: bounds.midX, y: y - 4), size: 10,
             color: NSColor(white: 0.95, alpha: 0.35), align: .center)
    }

    /// Sticker-sized: Clawd plus one line, same footprint as the Claude Code pet.
    /// 贴边小舌头：Clawd 的橙色圆角条，上面一张迷你脸；倒计时跑着的话
    /// 左侧一条细进度线，扫一眼就知道还剩多少。
    private func drawEdgeTab(_ c: CGContext) {
        let body = NSColor(red: 0.91, green: 0.56, blue: 0.41, alpha: 1)      // Clawd 橙
        let dark = NSColor(red: 0.55, green: 0.32, blue: 0.22, alpha: 1)
        // 只圆左边两个角，右边贴着屏幕边
        let r: CGFloat = 10
        let b = bounds.insetBy(dx: 0, dy: 1)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: b.maxX, y: b.minY))
        path.addLine(to: CGPoint(x: b.minX + r, y: b.minY))
        path.addQuadCurve(to: CGPoint(x: b.minX, y: b.minY + r), control: CGPoint(x: b.minX, y: b.minY))
        path.addLine(to: CGPoint(x: b.minX, y: b.maxY - r))
        path.addQuadCurve(to: CGPoint(x: b.minX + r, y: b.maxY), control: CGPoint(x: b.minX, y: b.maxY))
        path.addLine(to: CGPoint(x: b.maxX, y: b.maxY))
        path.closeSubpath()
        c.addPath(path)
        c.setFillColor(body.cgColor)
        c.fillPath()

        // 迷你脸：两只方眼睛 + 白肚皮
        let eyeY = b.maxY - 22
        c.setFillColor(dark.cgColor)
        c.fill(CGRect(x: b.minX + 6, y: eyeY, width: 4, height: 5))
        c.fill(CGRect(x: b.minX + 15, y: eyeY, width: 4, height: 5))
        c.setFillColor(NSColor(red: 1, green: 0.98, blue: 0.96, alpha: 1).cgColor)
        let belly = CGRect(x: b.midX - 6, y: eyeY - 20, width: 12, height: 12)
        c.fillEllipse(in: belly)

        // 倒计时进度：左沿一条细线，从满慢慢缩短
        if case .running(let ses) = phase {
            let frac = max(0, min(1, CGFloat(ses.remaining) / CGFloat(max(ses.plannedMin * 60, 1))))
            c.setFillColor(NSColor.white.withAlphaComponent(0.85).cgColor)
            c.fill(CGRect(x: b.minX + 2, y: b.minY + 6,
                          width: 2.5, height: (b.height - 12) * frac))
        }
        hits.append((bounds, .unhide))
    }

    private func drawCollapsed(_ c: CGContext) {
        // 收起 = 只留「陪你一起」这条桌子带：台灯、书、电脑、绿植、Clawd 坐在架子后面，
        // 砍掉清单和计时按钮。用户指着运行面板顶端那一条说「缩小了也要有这个」。
        drawClawd(c, cx: bounds.midX, baseY: 42, scale: 1.0)   // px = 3，跟全面板同一套场景
        let (line, tint) = collapsedLine()
        pill(c, line, cx: bounds.midX, cy: 16, bg: tint)
    }

    private func collapsedLine() -> (String, NSColor) {
        switch phase {
        case .running(let s): return (mmss(s.remaining), kOrangeD.withAlphaComponent(0.94))
        case .finished:       return ("时间到", kGreen)
        case .paused:         return ("暂停中", NSColor(white: 0.3, alpha: 0.85))
        case .picking:        return ("学多久", kOrangeD.withAlphaComponent(0.94))
        case .stopped:        return ("歇会儿", NSColor(white: 0.32, alpha: 0.88))
        case .idle:           return ("待命中", NSColor(white: 0.28, alpha: 0.85))
        }
    }

    private func statusLine() -> (String, NSColor) {
        switch phase {
        case .idle:
            return store.day.tasks.isEmpty ? ("先列个清单吧", NSColor(white: 0.3, alpha: 0.85))
                                           : ("选一项，点 ▶ 开始", NSColor(white: 0.3, alpha: 0.85))
        case .paused:   return ("上次还没走完", NSColor(white: 0.3, alpha: 0.85))
        case .picking:  return ("学多久？", kOrangeD)
        case .running(let s):
            // The line follows whatever it is doing, so the panel is not one
            // frozen sentence for 25 minutes.
            if s.remaining <= 60 { return ("快到啦", kOrangeD) }
            guard let b = beat else { return ("陪你一起", kOrangeD) }
            switch b {
            case .sip:      return ("喝口咖啡", kOrangeD)
            case .stretch:  return ("伸个懒腰", kOrangeD)
            case .tap:      return ("呼——", kOrangeD)
            case .lookAway: return ("……", kOrangeD)
            case .lean:     return ("怎么样啦", kOrangeD)
            case .nod:      return ("嗯，继续", kOrangeD)
            case .doze:
                return (t - beatAt < 2.4) ? ("zzz…", NSColor(white: 0.34, alpha: 0.9))
                                          : ("我没走神！", kOrangeD)
            case .blink2:   return ("陪你一起", kOrangeD)
            }
        case .finished: return ("时间到！可以休息了", kGreen)
        case .stopped:  return ("停下也没关系", NSColor(white: 0.32, alpha: 0.88))
        }
    }

    private func pill(_ c: CGContext, _ s: String, cx: CGFloat, cy: CGFloat, bg: NSColor) {
        let f = NSFont.systemFont(ofSize: 10.5, weight: .semibold)
        let a = NSAttributedString(string: s, attributes: [.font: f, .foregroundColor: NSColor.white])
        let sz = a.size()
        let r = CGRect(x: cx - sz.width / 2 - 8, y: cy - sz.height / 2 - 3.5,
                       width: sz.width + 16, height: sz.height + 7)
        fillRound(c, r, r.height / 2, bg)
        a.draw(at: CGPoint(x: cx - sz.width / 2, y: cy - sz.height / 2))
    }

    /// A tappable button. Returns its rect.
    @discardableResult
    private func button(_ c: CGContext, _ title: String, _ r: CGRect, _ hit: Hit?,
                        bg: NSColor, fg: NSColor = .white, size: CGFloat = 11.5) -> CGRect {
        fillRound(c, r, 7, bg)
        text(title, at: CGPoint(x: r.midX, y: r.midY - size * 0.42), size: size,
             weight: .semibold, color: fg, align: .center)
        if let h = hit { hits.append((r, h)) }
        return r
    }

    private func drawPhasePanel(_ c: CGContext, top: CGFloat) -> CGFloat {
        let w = bounds.width - pad * 2
        var y = top

        switch phase {
        case .idle:
            text("每项任务旁边的 ▶ 可以设定专注时长",
                 at: CGPoint(x: bounds.midX, y: y - 20), size: 10.5,
                 color: NSColor(white: 0.95, alpha: 0.32), align: .center)
            y -= 30

        case .stopped:
            text("刚才那段也算数，想回来随时点 ▶",
                 at: CGPoint(x: bounds.midX, y: y - 20), size: 10.5,
                 color: NSColor(white: 0.95, alpha: 0.32), align: .center)
            y -= 30

        case .picking(let id):
            let name = store.task(id)?.title ?? ""
            text(truncate(name, 22), at: CGPoint(x: bounds.midX, y: y - 16), size: 11,
                 weight: .medium, color: kDim, align: .center)
            y -= 24
            let opts = [15, 25, 45, 60]
            let bw = (w - 6 * CGFloat(opts.count - 1)) / CGFloat(opts.count)
            for (i, m) in opts.enumerated() {
                let r = CGRect(x: pad + (bw + 6) * CGFloat(i), y: y - 26, width: bw, height: 26)
                button(c, "\(m)′", r, .pickMinutes(m), bg: NSColor(white: 1, alpha: 0.10))
            }
            y -= 30
            let cr = CGRect(x: bounds.midX - 24, y: y - 18, width: 48, height: 18)
            text("取消", at: CGPoint(x: bounds.midX, y: y - 15), size: 10,
                 color: NSColor(white: 0.95, alpha: 0.4), align: .center)
            hits.append((cr, .cancelPick))
            y -= 20

        case .running(let s):
            let name = store.task(s.taskID)?.title ?? ""
            text(truncate(name, 22), at: CGPoint(x: bounds.midX, y: y - 15), size: 11,
                 weight: .medium, color: kDim, align: .center)
            y -= 22
            text(mmss(s.remaining), at: CGPoint(x: bounds.midX, y: y - 30), size: 32,
                 weight: .bold, color: kText, align: .center, mono: true)
            y -= 38

            // Progress of this sitting.
            let total = max(1.0, s.endsAt.timeIntervalSince(s.startedAt))
            let ratio = CGFloat(max(0, min(1, 1 - s.endsAt.timeIntervalSinceNow / total)))
            let br = CGRect(x: pad, y: y - 5, width: w, height: 5)
            fillRound(c, br, 2.5, NSColor(white: 1, alpha: 0.12))
            if ratio > 0 {
                fillRound(c, CGRect(x: br.minX, y: br.minY, width: br.width * ratio, height: 5),
                          2.5, kOrange)
            }
            y -= 14

            let half = (w - 8) / 2
            button(c, "先停下", CGRect(x: pad, y: y - 26, width: half, height: 26), .giveUp,
                   bg: NSColor(white: 1, alpha: 0.08), fg: NSColor(white: 0.95, alpha: 0.55))
            // Locked until the countdown runs out — the whole point of the thing.
            button(c, "🔒 休息", CGRect(x: pad + half + 8, y: y - 26, width: half, height: 26),
                   nil, bg: NSColor(white: 1, alpha: 0.05), fg: NSColor(white: 0.95, alpha: 0.22))
            y -= 30

        case .finished(let s):
            let name = store.task(s.taskID)?.title ?? ""
            text(truncate(name, 22), at: CGPoint(x: bounds.midX, y: y - 15), size: 11,
                 weight: .medium, color: kDim, align: .center)
            y -= 22
            // A finished sitting is a finished sitting. Whether the task is done
            // is a separate call, and it is yours — tick the box in the list.
            text("这一段结束了 · 专注 \(s.plannedMin) 分钟",
                 at: CGPoint(x: bounds.midX, y: y - 20), size: 13, weight: .semibold,
                 color: kGreen, align: .center)
            y -= 32
            let half = (w - 8) / 2
            button(c, "休息一下", CGRect(x: pad, y: y - 26, width: half, height: 26),
                   .rest, bg: kOrangeD)
            button(c, "再来一段", CGRect(x: pad + half + 8, y: y - 26, width: half, height: 26),
                   .again, bg: NSColor(white: 1, alpha: 0.10))
            y -= 42

        case .paused(let s):
            let name = store.task(s.taskID)?.title ?? ""
            text(truncate(name, 22), at: CGPoint(x: bounds.midX, y: y - 15), size: 11,
                 weight: .medium, color: kDim, align: .center)
            y -= 22
            text("还剩 \(mmss(s.remaining))，要接着来吗？",
                 at: CGPoint(x: bounds.midX, y: y - 20), size: 12, color: kDim, align: .center)
            y -= 30
            let h2 = (w - 8) / 2
            button(c, "继续", CGRect(x: pad, y: y - 26, width: h2, height: 26),
                   .resume, bg: kOrangeD)
            button(c, "算了", CGRect(x: pad + h2 + 8, y: y - 26, width: h2, height: 26),
                   .discard, bg: NSColor(white: 1, alpha: 0.08),
                   fg: NSColor(white: 0.95, alpha: 0.55))
            y -= 32
        }
        return y
    }

    private func drawRow(_ c: CGContext, _ task: StudyTask, top: CGFloat) {
        let y = top - rowH
        let rowRect = CGRect(x: pad - 4, y: y, width: bounds.width - (pad - 4) * 2, height: rowH)

        var isCurrent = false
        switch phase {
        case .running(let s), .finished(let s), .paused(let s): isCurrent = s.taskID == task.id
        case .picking(let id): isCurrent = id == task.id
        default: break
        }
        if isCurrent {
            fillRound(c, rowRect.insetBy(dx: 0, dy: 2), 7, NSColor(white: 1, alpha: 0.07))
        }

        // Checkbox
        let box = CGRect(x: pad, y: y + rowH / 2 - 8, width: 16, height: 16)
        if task.done {
            fillRound(c, box, 5, kGreen)
            c.setLineCap(.round)
            c.setLineWidth(2)
            c.setStrokeColor(NSColor.white.cgColor)
            c.move(to: CGPoint(x: box.minX + 4, y: box.midY))
            c.addLine(to: CGPoint(x: box.midX - 0.5, y: box.minY + 4.5))
            c.addLine(to: CGPoint(x: box.maxX - 3.5, y: box.maxY - 4.5))
            c.strokePath()
        } else {
            strokeRound(c, box, 5, NSColor(white: 1, alpha: 0.30), 1.5)
        }
        hits.append((box.insetBy(dx: -5, dy: -5), .toggleDone(task.id)))

        // Title
        let titleColor = task.done ? NSColor(white: 0.95, alpha: 0.32) : kText
        let tx = pad + 24
        let shown = truncate(task.title, 17)
        text(shown, at: CGPoint(x: tx, y: y + rowH / 2 - 6), size: 12,
             weight: isCurrent ? .semibold : .regular, color: titleColor)
        if task.done {
            let wdt = NSAttributedString(string: shown, attributes: [
                .font: NSFont.systemFont(ofSize: 12)]).size().width
            c.setStrokeColor(NSColor(white: 0.95, alpha: 0.3).cgColor)
            c.setLineWidth(1)
            c.move(to: CGPoint(x: tx, y: y + rowH / 2 - 0.5))
            c.addLine(to: CGPoint(x: tx + wdt, y: y + rowH / 2 - 0.5))
            c.strokePath()
        }

        // Accumulated focus
        if task.focusedSec >= 60 {
            text("\(task.focusedSec / 60)′", at: CGPoint(x: bounds.width - pad - 46,
                                                        y: y + rowH / 2 - 5),
                 size: 10, color: NSColor(white: 0.95, alpha: 0.35), align: .right)
        }

        // Delete — disabled for the task currently on the clock.
        var locked = false
        if case .running(let s) = phase, s.taskID == task.id { locked = true }
        let del = CGRect(x: bounds.width - pad - 16, y: y + rowH / 2 - 8, width: 16, height: 16)
        text("✕", at: CGPoint(x: del.midX, y: del.midY - 5), size: 10,
             color: NSColor(white: 0.95, alpha: locked ? 0.10 : 0.28), align: .center)
        if !locked { hits.append((del.insetBy(dx: -3, dy: -4), .deleteTask(task.id))) }

        // Start
        if !task.done {
            let go = CGRect(x: bounds.width - pad - 40, y: y + rowH / 2 - 9, width: 18, height: 18)
            var busy = false
            if case .running = phase { busy = true }
            let col = busy ? NSColor(white: 0.95, alpha: 0.15) : kOrange
            text("▶", at: CGPoint(x: go.midX, y: go.midY - 6), size: 11,
                 color: col, align: .center)
            if !busy { hits.append((go.insetBy(dx: -4, dy: -4), .startTask(task.id))) }
        }
    }

    // MARK: Clawd

    /// Clawd, in pixels. Same sprite the Claude Code pet uses.
    private func drawClawd(_ c: CGContext, cx: CGFloat, baseY: CGFloat, scale: CGFloat) {
        // 28-cell grid: 3pt cells in the panel, 2pt in the sticker.
        let px: CGFloat = scale >= 0.9 ? 3 : 2

        var pose: ClawdPose = .normal
        var face: ClawdFace = .open
        var lift: CGFloat = 0
        var shiftX: CGFloat = 0
        var showCup = false, showZzz = false, showBang = false

        if animate || collapsed, t.truncatingRemainder(dividingBy: 3.4) < 0.13 { face = .blink }

        switch phase {
        case .idle, .picking:
            if animate { lift = sin(t * 2.0) > 0.4 ? 1 : 0 }
        case .running:
            face = .narrow
            if animate { lift = sin(t * 1.3) > 0.6 ? 1 : 0 }
        case .finished:
            face = .happy
            let st = t - cheerAt
            if animate {
                lift = st < 2.2 ? (sin(st * 7) > 0 ? 2 : 0) : (sin(t * 2.2) > 0.4 ? 1 : 0)
            } else if st < 1.2 {
                lift = sin(st * 7) > 0 ? 2 : 0          // one short cheer, then still
            }
        case .stopped:
            face = .open
            showCup = true                       // 歇会儿就真端杯子歇
        case .paused:
            face = .sad                          // 被打断了，蔫一点
        }

        // A random little action, so supervising is not one frozen pose.
        if let b = beat {
            let base = face
            let p = t - beatAt
            switch b {
            case .blink2:
                face = (p < 0.14 || (p > 0.30 && p < 0.44)) ? .blink : base
            case .lean:
                pose = (p > 0.25 && p < 1.5) ? .squat : .normal      // leans in at you
            case .stretch:
                if p < 0.35 { pose = .squat }
                else if p < 1.05 { pose = .tall; face = .blink }
            case .sip:
                showCup = true
                shiftX = (p > 0.5 && p < 1.9) ? 1 : 0
                face = (p > 0.6 && p < 1.7) ? .blink : base
            case .tap:
                lift = sin(p * 22) > 0 ? 1 : 0                        // impatient drumming
            case .lookAway:
                face = p < 0.6 ? .lookLeft : (p < 1.3 ? .lookRight : base)
            case .doze:
                if p < 2.4 {
                    showZzz = true
                    face = .blink
                } else {
                    showBang = true                                   // catches itself
                    face = .wide
                    lift = 2
                }
            case .nod:
                lift = (p > 0.25 && p < 0.6) ? 1 : 0
            }
        }

        // Last minute of a sitting: it cannot sit still.
        if animate, case .running(let s) = phase, s.remaining <= 60, beat == nil {
            lift = sin(t * 6) > 0 ? 1 : 0
            if Int(t * 2) % 7 == 0 { face = .wide }
        }

        let buff = store?.isBuff ?? false
        let scene = Scene.enabled          // 收起态也保留桌子带
        let body = ClawdSprites.body(face, pose: pose, buff: buff)
        let sz = body.size(px: px)
        let x = cx - sz.width / 2 + shiftX * px
        let y = baseY + lift * px

        if !scene {
            c.setFillColor(NSColor(white: 0, alpha: lift > 0 ? 0.12 : 0.20).cgColor)
            c.fill(CGRect(x: cx - sz.width / 2 + px * 2, y: baseY - px,
                          width: sz.width - px * 4, height: px))
        }

        body.draw(c, at: CGPoint(x: x, y: y), px: px)

        // Something in its hands while you work — otherwise it just sits there.
        if case .running = phase {
            switch prop {
            case .laptop:
                // Overlaps the body by 3 cells so both eyes stay clear of it.
                ClawdSprites.studyLaptop.draw(c, at: CGPoint(x: x + sz.width - px * 6, y: y),
                                              px: px)
            case .whip:
                ClawdSprites.whip.draw(c, at: CGPoint(x: x + sz.width - px * 6,
                                                      y: y + px * 2), px: px)
            case .none:
                break
            }
        }

        // The desk goes over Clawd's legs, which reads as sitting at it.
        var deskTop = baseY
        if scene {
            let left = pad, right = bounds.width - pad
            deskTop = baseY + px * 2
            c.setFillColor(kDesk.cgColor)
            c.fill(CGRect(x: left, y: deskTop - px * 3, width: right - left, height: px * 3))
            c.setFillColor(kDeskEdge.cgColor)
            c.fill(CGRect(x: left, y: deskTop - px * 4, width: right - left, height: px))

            ClawdSprites.lamp.draw(c, at: CGPoint(x: left + px * 2, y: deskTop), px: px)
            ClawdSprites.books.draw(c, at: CGPoint(x: left + px * 15, y: deskTop), px: px)
            ClawdSprites.plant.draw(c,
                at: CGPoint(x: right - CGFloat(ClawdSprites.plant.w) * px - px, y: deskTop), px: px)
        }

        // Earned biceps last, so the prop cannot cover them.
        if buff {
            let armY = y + sz.height * 0.42
            ClawdSprites.arm(left: true).draw(c, at: CGPoint(x: x - px * 6, y: armY), px: px)
            ClawdSprites.arm(left: false).draw(c, at: CGPoint(x: x + sz.width - px * 2, y: armY),
                                               px: px)
        }

        // Props show in both sizes now. The sticker has no headroom above the
        // body, so anything that would sit on top is moved out to the side.
        if showCup {
            ClawdSprites.cup.draw(c, at: CGPoint(x: x + sz.width - px * 8, y: baseY), px: px)
        }
        if showZzz {
            let p = t - beatAt
            for i in 0..<3 {
                let q = p - CGFloat(i) * 0.55
                guard q > 0 else { continue }
                let rise = min(CGFloat(4), (q * 4).rounded()) * px * 0.5
                let px2 = px * (i == 0 ? 0.7 : (i == 1 ? 1.0 : 1.3))
                let at = collapsed
                    ? CGPoint(x: x + sz.width - px * 4 + CGFloat(i) * px * 1.2,
                              y: y + sz.height - px * 12 + rise)
                    : CGPoint(x: x + sz.width - px * 6 + CGFloat(i) * px * 2.8,
                              y: y + sz.height - px * 2 + rise)
                ClawdSprites.zed.draw(c, at: at, px: px2)
            }
        }
        if showBang {
            let at = collapsed ? CGPoint(x: x + sz.width, y: y + sz.height - px * 12)
                               : CGPoint(x: x + sz.width - px * 2, y: y + sz.height)
            ClawdSprites.bang.draw(c, at: at, px: px)
        }

        if case .finished = phase {
            let s = ClawdSprites.sparkle
            let st = t - cheerAt
            guard st < (animate ? 2.6 : 1.2) else { return }
            for (i, d) in [CGPoint(x: -58, y: 40), CGPoint(x: 50, y: 26),
                           CGPoint(x: -40, y: 70), CGPoint(x: 42, y: 66)].enumerated() {
                if animate {
                    let q = max(0, st - CGFloat(i) * 0.16)
                    guard sin(q * 5.5) > 0 else { continue }
                }
                s.draw(c, at: CGPoint(x: cx + d.x, y: baseY + d.y), px: px * 0.7)
            }
        }
    }

    // MARK: Input

    override func mouseDown(with e: NSEvent) {
        let p = convert(e.locationInWindow, from: nil)

        if edge { onHit?(.unhide); return }        // 小舌头就一个功能：点了回来

        if collapsed {
            // Single click drags it; only a double click brings the panel back,
            // so repositioning never expands it by accident.
            if e.clickCount >= 2 { onHit?(.expand); return }
            dragAnchor = NSEvent.mouseLocation
            winAnchor = window?.frame.origin ?? .zero
            dragging = true
            return
        }

        // Header strip drags the window.
        if p.y > bounds.height - 34 {
            dragAnchor = NSEvent.mouseLocation
            winAnchor = window?.frame.origin ?? .zero
            dragging = true
        }
        for (r, h) in hits.reversed() where r.contains(p) {
            onHit?(h)
            return
        }
    }

    override func rightMouseDown(with e: NSEvent) {
        let menu = NSMenu()
        menu.addItem(withTitle: edge ? "回来" : "贴边收起（计时继续走）",
                     action: #selector(menuHide), keyEquivalent: "").target = self
        menu.addItem(withTitle: collapsed ? "展开" : "收起成贴纸",
                     action: #selector(menuFold), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出 Clawd",
                     action: #selector(menuQuit), keyEquivalent: "").target = self
        NSMenu.popUpContextMenu(menu, with: e, for: self)
    }

    @objc private func menuHide() { onHit?(edge ? .unhide : .hide) }
    @objc private func menuFold() { onHit?(collapsed ? .expand : .collapse) }
    @objc private func menuQuit() { onHit?(.quitApp) }

    override func mouseDragged(with e: NSEvent) {
        guard dragging, let w = window else { return }
        let now = NSEvent.mouseLocation
        w.setFrameOrigin(CGPoint(x: winAnchor.x + now.x - dragAnchor.x,
                                 y: winAnchor.y + now.y - dragAnchor.y))
    }

    override func mouseUp(with e: NSEvent) {
        if dragging, let o = window?.frame.origin { onDragEnd?(o) }
        dragging = false
    }

    override func scrollWheel(with e: NSEvent) {
        guard !collapsed, store.day.tasks.count > maxRows else { return }
        let maxOff = store.day.tasks.count - maxRows
        if e.scrollingDeltaY < -1 { listOffset = min(maxOff, listOffset + 1) }
        if e.scrollingDeltaY > 1 { listOffset = max(0, listOffset - 1) }
        needsDisplay = true
    }
}

// MARK: - Controller

final class ClawdWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

final class Clawd: NSObject, NSApplicationDelegate, NSTextFieldDelegate {
    private var window: ClawdWindow!
    private var view: ClawdView!
    private let store = Store()
    private let root = NSString(string: "~/.claude/clawd").expandingTildeInPath
    private var phase: Phase = .idle {
        didSet { view.phase = phase; resize(); view.needsDisplay = true }
    }
    private var dumpSignal: DispatchSourceSignal?
    private var rollTick = 0

    private var timerURL: URL { URL(fileURLWithPath: root + "/session.json") }
    private var posURL: URL { URL(fileURLWithPath: root + "/pos") }

    func applicationDidFinishLaunching(_ n: Notification) {
        window = ClawdWindow(contentRect: NSRect(x: 0, y: 0, width: 308, height: 480),
                             styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = true
        // Same level as the Claude Code pet. At .floating it kept getting buried
        // under whatever app was in front, which makes a companion useless.
        window.level = .statusBar
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]

        view = ClawdView(frame: window.contentLayoutRect)
        view.store = store
        view.wantsLayer = true
        view.onHit = { [weak self] h in self?.handle(h) }
        view.onDragEnd = { [weak self] _ in self?.clampOnScreen(); self?.savePos() }
        window.contentView = view

        // Task entry
        let f = view.field
        f.placeholderString = "加一项今天要做的…"
        f.font = NSFont.systemFont(ofSize: 12)
        f.textColor = kText
        f.drawsBackground = false
        f.isBezeled = false
        f.focusRingType = .none
        f.delegate = self
        f.target = self
        f.action = #selector(submitField)
        view.addSubview(f)

        restoreSession()
        view.collapsed = FileManager.default.fileExists(atPath: root + "/collapsed")
        resize()
        if FileManager.default.fileExists(atPath: root + "/hidden") { enterEdge() }
        if let tl = savedTopLeft() {
            window.setFrameOrigin(NSPoint(x: tl.x, y: tl.y - window.frame.height))
        } else {
            window.setFrameOrigin(defaultPos())
        }
        clampOnScreen()
        window.orderFrontRegardless()

        // 10fps: the sprite hops in whole pixels and the clock shows whole seconds,
        // so nothing here benefits from redrawing faster.
        Timer.scheduledTimer(withTimeInterval: 1.0 / 10.0, repeats: true) { [weak self] _ in
            self?.tick()
        }

        signal(SIGUSR1, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        src.setEventHandler { [weak self] in self?.dumpFrame() }
        src.resume()
        dumpSignal = src
    }

    // MARK: Loop

    private func tick() {
        // `clawd.sh find` drops this file when you cannot spot the panel:
        // expand it, put it back at the default corner, bring it to front.
        if FileManager.default.fileExists(atPath: root + "/find") {
            try? FileManager.default.removeItem(atPath: root + "/find")
            try? FileManager.default.removeItem(atPath: root + "/collapsed")
            try? FileManager.default.removeItem(atPath: root + "/hidden")
            view.collapsed = false
            view.edge = false
            resize()
            window.setFrameOrigin(defaultPos())
            clampOnScreen()
            savePos()
            window.orderFrontRegardless()
        }

        let wantHidden = FileManager.default.fileExists(atPath: root + "/hidden")
        if wantHidden != view.edge { wantHidden ? enterEdge() : exitEdge() }
        if !window.isVisible { window.orderFrontRegardless() }   // 任何状态都不许彻底消失

        view.t += 1.0 / 10.0
        view.animate = FileManager.default.fileExists(
            atPath: NSString(string: "~/.claude/shared/motion").expandingTildeInPath)
        view.prop = Prop.load()
        view.stepBeats()

        let m = NSEvent.mouseLocation
        let local = CGPoint(x: m.x - window.frame.minX, y: m.y - window.frame.minY)
        let c = CGPoint(x: view.bounds.midX, y: view.bounds.height - 80)
        view.gaze = CGPoint(x: max(-1, min(1, (local.x - c.x) / 120)),
                            y: max(-1, min(1, (local.y - c.y) / 120)))

        if case .running(let s) = phase, s.isUp { finish(s) }

        if case .stopped(let since) = phase, Date().timeIntervalSince(since) > 20 {
            phase = .idle
        }

        // Midnight can only arrive so fast; no need to ask ten times a second.
        rollTick += 1
        if rollTick % 10 == 0, store.rolloverIfNeeded() {
            phase = .idle
            view.listOffset = 0
        }

        view.needsDisplay = true
    }

    private func resize() {
        let h = view.neededHeight()
        let w: CGFloat = view.edge ? 26 : (view.collapsed ? 280 : 308)
        guard abs(window.frame.height - h) > 0.5 || abs(window.frame.width - w) > 0.5 else { return }

        // Keep the top-left corner put, so collapsing lands somewhere predictable.
        let left = window.frame.minX
        let top = window.frame.maxY
        window.setFrame(NSRect(x: left, y: top - h, width: w, height: h), display: true)
        view.frame = NSRect(x: 0, y: 0, width: w, height: h)
        view.field.isHidden = view.collapsed

        window.hasShadow = !(view.collapsed || view.edge)
        window.invalidateShadow()

        clampOnScreen()
    }

    /// Nothing may end up off-screen — resizing used to be able to push it out.
    private func clampOnScreen() {
        let screen = NSScreen.screens.first { $0.frame.intersects(window.frame) }
            ?? NSScreen.main ?? NSScreen.screens[0]
        let vf = screen.visibleFrame
        var o = window.frame.origin
        // 贴边模式就是要顶着屏幕右缘，不留 4px 缝
        if view.edge { o.x = vf.maxX - window.frame.width }
        else { o.x = min(max(o.x, vf.minX + 4), max(vf.minX + 4, vf.maxX - window.frame.width - 4)) }
        o.y = min(max(o.y, vf.minY + 4), max(vf.minY + 4, vf.maxY - window.frame.height - 4))
        if o != window.frame.origin { window.setFrameOrigin(o) }
    }

    // MARK: Actions

    private func handle(_ h: Hit) {
        switch h {
        case .toggleDone(let id):
            store.toggleDone(id)
            if case .running(let s) = phase, s.taskID == id { /* keep the clock going */ }

        case .deleteTask(let id):
            if case .running(let s) = phase, s.taskID == id { return }   // finish or give up first
            store.remove(id)

        case .startTask(let id):
            if case .running = phase { return }
            phase = .picking(id)

        case .cancelPick:
            phase = .idle

        case .pickMinutes(let m):
            if case .picking(let id) = phase { start(id, minutes: m) }

        case .giveUp:
            if case .running(let s) = phase { confirmGiveUp(s) }

        case .rest:
            if case .finished = phase { phase = .idle }

        case .again:
            if case .finished(let s) = phase { start(s.taskID, minutes: s.plannedMin) }

        case .resume:
            // Only ever starts from an explicit click — nothing auto-starts here.
            if case .paused(let s) = phase {
                phase = .running(s)
                saveSession(s)
            }

        case .discard:
            if case .paused = phase { clearSession(); phase = .idle }

        case .hide:
            // 最小也要看得见：不再整个消失（消失过一次就再也找不回来了），
            // 贴到屏幕右边框上当个小舌头。计时照走。
            FileManager.default.createFile(atPath: root + "/hidden", contents: nil)
            enterEdge()

        case .unhide:
            try? FileManager.default.removeItem(atPath: root + "/hidden")
            exitEdge()

        case .quitApp:
            NSApp.terminate(nil)

        case .collapse:
            view.collapsed = true
            FileManager.default.createFile(atPath: root + "/collapsed", contents: nil)
            resize()
            savePos()

        case .expand:
            view.collapsed = false
            try? FileManager.default.removeItem(atPath: root + "/collapsed")
            resize()
            savePos()
        }
        view.needsDisplay = true
    }

    private func start(_ id: String, minutes: Int) {
        let s = Session(taskID: id, plannedMin: minutes, startedAt: Date(),
                        endsAt: Date().addingTimeInterval(TimeInterval(minutes * 60)))
        phase = .running(s)
        saveSession(s)
    }

    private func finish(_ s: Session) {
        store.addFocus(s.taskID, s.plannedMin * 60)
        store.recordSitting(s.plannedMin * 60)
        view.cheerAt = view.t
        phase = .finished(s)
        clearSession()
        NSSound(named: NSSound.Name("Glass"))?.play()
        // Surfaces itself even if you hid it — this is the moment worth seeing.
        try? FileManager.default.removeItem(atPath: root + "/hidden")
        window.orderFrontRegardless()
    }

    private func confirmGiveUp(_ s: Session) {
        let name = store.task(s.taskID)?.title ?? "这项"
        NSApp.activate(ignoringOtherApps: true)
        let a = NSAlert()
        a.messageText = "先停下这一段？"
        a.informativeText = "「\(name)」还剩 \(mmss(s.remaining))。"
            + "已经专注的 \(max(1, s.elapsedSec / 60)) 分钟照样算数。"
        a.addButton(withTitle: "再来一会")     // default
        a.addButton(withTitle: "停下")
        guard a.runModal() == .alertSecondButtonReturn else { return }

        store.addFocus(s.taskID, s.elapsedSec)   // partial focus still counts
        store.recordSitting(s.elapsedSec)
        store.recordGiveup()                     // kept in the file, never shown
        clearSession()
        phase = .stopped(Date())
    }

    @objc private func submitField() {
        let raw = view.field.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        view.field.stringValue = ""
        guard !raw.isEmpty else { return }

        // While choosing a duration, a bare number is a custom minute count.
        if case .picking(let id) = phase, let m = Int(raw), m >= 1, m <= 600 {
            start(id, minutes: m)
            return
        }
        store.add(raw)
        resize()
        view.listOffset = max(0, store.day.tasks.count - view.maxRows)
        view.needsDisplay = true
    }

    func controlTextDidChange(_ obj: Notification) {}

    // MARK: Persistence

    private func saveSession(_ s: Session) {
        if let d = try? JSONEncoder().encode(s) { try? d.write(to: timerURL, options: .atomic) }
    }

    private func clearSession() { try? FileManager.default.removeItem(at: timerURL) }

    /// A countdown survives a restart — closing the app is not a way to skip it.
    private func restoreSession() {
        guard let d = try? Data(contentsOf: timerURL),
              let s = try? JSONDecoder().decode(Session.self, from: d),
              store.task(s.taskID) != nil else { clearSession(); return }
        if s.isUp {
            store.addFocus(s.taskID, s.plannedMin * 60)
            view.cheerAt = 0
            phase = .finished(s)
            clearSession()
        } else {
            // Waits for you to say so rather than picking up where it left off.
            phase = .paused(s)
        }
    }

    /// 进贴边：记住现在的位置，缩成小舌头吸到屏幕右缘（高度跟着原来的位置走）。
    private var edgeReturn: NSPoint?
    private func enterEdge() {
        if !view.edge { edgeReturn = NSPoint(x: window.frame.minX, y: window.frame.maxY) }
        view.edge = true
        resize()
        let screen = NSScreen.screens.first { $0.frame.intersects(window.frame) }
            ?? NSScreen.main ?? NSScreen.screens[0]
        let vf = screen.visibleFrame
        let top = min(max(window.frame.maxY, vf.minY + 120), vf.maxY - 8)
        window.setFrameOrigin(NSPoint(x: vf.maxX - window.frame.width,
                                      y: top - window.frame.height))
    }

    /// 出贴边：回到收起前的位置。
    private func exitEdge() {
        guard view.edge else { return }
        view.edge = false
        resize()
        if let r = edgeReturn {
            window.setFrameOrigin(NSPoint(x: r.x, y: r.y - window.frame.height))
        } else if let tl = savedTopLeft() {
            window.setFrameOrigin(NSPoint(x: tl.x, y: tl.y - window.frame.height))
        } else {
            window.setFrameOrigin(defaultPos())
        }
        clampOnScreen()
        window.orderFrontRegardless()
    }

    private func defaultPos() -> NSPoint {
        let vf = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        return NSPoint(x: vf.minX + 24, y: vf.maxY - window.frame.height - 8)
    }

    /// Returns the saved top-left corner, if it is still on a screen that exists.
    private func savedTopLeft() -> NSPoint? {
        guard let s = try? String(contentsOf: posURL, encoding: .utf8) else { return nil }
        let p = s.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ")
        guard p.count == 2, let x = Double(p[0]), let y = Double(p[1]) else { return nil }
        let pt = NSPoint(x: x, y: y)
        guard NSScreen.screens.contains(where: { $0.frame.contains(pt) }) else { return nil }
        return pt
    }

    /// Stored as the top-left corner, so a different panel height cannot shift it.
    private func savePos() {
        let topLeft = NSPoint(x: window.frame.minX, y: window.frame.maxY)
        try? "\(Int(topLeft.x)) \(Int(topLeft.y))".write(to: posURL, atomically: true,
                                                          encoding: .utf8)
    }

    private func dumpFrame() {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        if let d = rep.representation(using: .png, properties: [:]) {
            try? d.write(to: URL(fileURLWithPath: root + "/frame.png"))
        }
    }
}

// MARK: - Offscreen preview (verify every phase without clicking through them)

extension Store {
    func debugLoad(_ d: DayLog) { day = d }
}

func renderPanel(_ phase: Phase, collapsed: Bool, tasks: [StudyTask],
                 giveups: Int, t: CGFloat,
                 configure: ((ClawdView) -> Void)? = nil) -> NSImage {
    let store = Store()
    store.debugLoad(DayLog(date: todayKey(), tasks: tasks, giveups: giveups))

    let v = ClawdView(frame: NSRect(x: 0, y: 0, width: 308, height: 480))
    v.store = store
    v.phase = phase
    v.collapsed = collapsed
    v.t = t
    v.cheerAt = 0
    configure?(v)
    let w: CGFloat = collapsed ? 112 : 308
    let h = v.neededHeight()
    v.frame = NSRect(x: 0, y: 0, width: w, height: h)

    let size = NSSize(width: w, height: h)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                               pixelsWide: Int(w * 2), pixelsHigh: Int(h * 2),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    v.draw(v.bounds)
    NSGraphicsContext.restoreGraphicsState()

    let img = NSImage(size: size)
    img.addRepresentation(rep)
    return img
}

func renderSheet(to path: String) {
    let ids = (0..<5).map { "t\($0)" }
    let tasks = [
        StudyTask(id: ids[0], title: "看完 MedQA 那篇论文", done: true, focusedSec: 50 * 60),
        StudyTask(id: ids[1], title: "复现 expert system baseline", done: false, focusedSec: 25 * 60),
        StudyTask(id: ids[2], title: "写周报", done: false, focusedSec: 0),
        StudyTask(id: ids[3], title: "背 50 个单词", done: true, focusedSec: 15 * 60),
        StudyTask(id: ids[4], title: "整理实验数据", done: false, focusedSec: 0)
    ]
    let running = Session(taskID: ids[1], plannedMin: 25,
                          startedAt: Date().addingTimeInterval(-9 * 60),
                          endsAt: Date().addingTimeInterval(16 * 60 + 12))
    let finished = Session(taskID: ids[1], plannedMin: 25,
                           startedAt: Date().addingTimeInterval(-25 * 60), endsAt: Date())

    let cells: [(String, NSImage)] = [
        ("待命 · 选任务", renderPanel(.idle, collapsed: false, tasks: tasks, giveups: 0, t: 0.9)),
        ("选时长", renderPanel(.picking(ids[2]), collapsed: false, tasks: tasks, giveups: 0, t: 0.9)),
        ("陪着 · 抱电脑", renderPanel(.running(running), collapsed: false, tasks: tasks,
                                  giveups: 0, t: 0.9) { $0.prop = .laptop }),
        ("陪着 · 拿皮鞭", renderPanel(.running(running), collapsed: false, tasks: tasks,
                                  giveups: 0, t: 0.9) { $0.prop = .whip }),
        ("满 2 小时 · 强壮形态",
            renderPanel(.running(running), collapsed: false,
                        tasks: [StudyTask(id: "x", title: "复现 baseline",
                                          done: false, focusedSec: 2 * 60 * 60)],
                        giveups: 0, t: 0.9) { $0.prop = .laptop }),
        ("这一段结束了", renderPanel(.finished(finished), collapsed: false, tasks: tasks,
                                giveups: 1, t: 0.5)),
        ("重启后：等你确认", renderPanel(.paused(running), collapsed: false, tasks: tasks,
                                  giveups: 0, t: 0.9)),
        ("提前停下之后", renderPanel(.stopped(Date()), collapsed: false, tasks: tasks,
                             giveups: 2, t: 0.9)),
        ("收起·专注", renderPanel(.running(running), collapsed: true, tasks: tasks, giveups: 0, t: 0.9)),
        ("收起·待命", renderPanel(.idle, collapsed: true, tasks: tasks, giveups: 0, t: 0.9)),
        ("收起·待命张望", renderPanel(.idle, collapsed: true, tasks: tasks, giveups: 0, t: 5.0)
            { $0.debugBeat(.lookAway, at: 0.3) }),
        ("收起·打瞌睡", renderPanel(.idle, collapsed: true, tasks: tasks, giveups: 0, t: 9.0)
            { $0.debugBeat(.doze, at: 1.0) }),
        ("收起·喝一口", renderPanel(.running(running), collapsed: true, tasks: tasks, giveups: 0, t: 7.0)
            { $0.debugBeat(.sip, at: 1.0) }),
        ("收起·暂停", renderPanel(.paused(running), collapsed: true, tasks: tasks, giveups: 0, t: 0.9)),
        ("收起·歇会儿", renderPanel(.stopped(Date()), collapsed: true, tasks: tasks, giveups: 0, t: 0.9)),
        ("收起·时间到", renderPanel(.finished(finished), collapsed: true, tasks: tasks, giveups: 1, t: 0.5))
    ]

    let gap: CGFloat = 14, labelH: CGFloat = 20
    let W = cells.reduce(gap) { $0 + $1.1.size.width + gap }
    let H = (cells.map { $0.1.size.height }.max() ?? 400) + gap * 2 + labelH

    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * 2), pixelsHigh: Int(H * 2),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(srgbRed: 0.16, green: 0.17, blue: 0.20, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: W, height: H).fill()

    var x = gap
    for (name, img) in cells {
        let y = H - gap - img.size.height
        img.draw(at: NSPoint(x: x, y: y), from: .zero, operation: .sourceOver, fraction: 1)
        text(name, at: CGPoint(x: x + img.size.width / 2, y: y - 15), size: 11,
             weight: .medium, color: NSColor(white: 0.7, alpha: 1), align: .center)
        x += img.size.width + gap
    }
    NSGraphicsContext.restoreGraphicsState()
    if let d = rep.representation(using: .png, properties: [:]) {
        try? d.write(to: URL(fileURLWithPath: path))
    }
}

func renderBeats(to path: String) {
    let tasks = [StudyTask(id: "x", title: "复现 baseline", done: false, focusedSec: 0)]
    let sess = Session(taskID: "x", plannedMin: 25,
                       startedAt: Date().addingTimeInterval(-300),
                       endsAt: Date().addingTimeInterval(1200))

    let samples: [(String, Beat, CGFloat)] = [
        ("基础 · 眯眼", .blink2, 0.9),
        ("眨两下", .blink2, 0.05),
        ("凑近盯", .lean, 0.8),
        ("伸懒腰 ①", .stretch, 0.2),
        ("伸懒腰 ②", .stretch, 0.7),
        ("喝咖啡", .sip, 1.0),
        ("敲桌子", .tap, 0.1),
        ("眼神飘左", .lookAway, 0.3),
        ("眼神飘右", .lookAway, 0.9),
        ("打盹", .doze, 1.6),
        ("惊醒", .doze, 2.7),
        ("点头", .nod, 0.4)
    ]

    let wantCollapsed = CommandLine.arguments.contains("--collapsed")
    let cells: [(String, NSImage)] = samples.map { name, b, p in
        (name, renderPanel(.running(sess), collapsed: wantCollapsed, tasks: tasks,
                           giveups: 0, t: 6.0) { $0.debugBeat(b, at: p) })
    }

    // Only the character band at the top of the panel is interesting here.
    let band: CGFloat = wantCollapsed ? cells[0].1.size.height : 168
    let cols = 4, gap: CGFloat = 10, labelH: CGFloat = 18
    let cw = cells[0].1.size.width, ch = band
    let rows = (cells.count + cols - 1) / cols
    let W = (cw + gap) * CGFloat(cols) + gap
    let H = (ch + labelH + gap) * CGFloat(rows) + gap

    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(W * 2), pixelsHigh: Int(H * 2),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true,
                               isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    NSColor(srgbRed: 0.13, green: 0.14, blue: 0.16, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: W, height: H).fill()

    for (i, cell) in cells.enumerated() {
        let cx = gap + (cw + gap) * CGFloat(i % cols)
        let cy = H - gap - (ch + labelH + gap) * CGFloat(i / cols + 1) + labelH
        cell.1.draw(at: NSPoint(x: cx, y: cy),
                    from: NSRect(x: 0, y: cell.1.size.height - band, width: cw, height: band),
                    operation: .sourceOver, fraction: 1)
        text(cell.0, at: CGPoint(x: cx + cw / 2, y: cy - 14), size: 10.5,
             weight: .medium, color: NSColor(white: 0.72, alpha: 1), align: .center)
    }
    NSGraphicsContext.restoreGraphicsState()
    if let d = rep.representation(using: .png, properties: [:]) {
        try? d.write(to: URL(fileURLWithPath: path))
    }
}

/// Headless: drive the beat scheduler in memory and print what it picks.
/// No disk writes, no waiting — it simulates the clock.
func traceBeats(seconds: Double) {
    let v = ClawdView(frame: NSRect(x: 0, y: 0, width: 308, height: 400))
    v.store = Store()
    v.phase = .running(Session(taskID: "x", plannedMin: 25, startedAt: Date(),
                               endsAt: Date().addingTimeInterval(1500)))
    v.animate = FileManager.default.fileExists(
        atPath: NSString(string: "~/.claude/shared/motion").expandingTildeInPath)
    print(v.animate ? "(动画开启)" : "(静止模式)")
    var prev: Beat?
    var n = 0
    var counts: [String: Int] = [:]
    for _ in 0..<Int(seconds * 10) {
        v.t += 0.1
        v.stepBeats()
        if let b = v.beat, prev == nil {
            print(String(format: "%6.1fs  %@", Double(v.t), String(describing: b)))
            counts[String(describing: b), default: 0] += 1
            n += 1
        }
        prev = v.beat
    }
    print("— \(Int(seconds))s 内 \(n) 个动作，\(counts.count) 种：",
          counts.sorted { $0.value > $1.value }.map { "\($0.key)×\($0.value)" }.joined(separator: " "))
}

// MARK: - Entry

@main
enum ClawdApp {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)

        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--sheet"), i + 1 < args.count {
            renderSheet(to: args[i + 1])
            exit(0)
        }
        if let i = args.firstIndex(of: "--trace"), i + 1 < args.count {
            traceBeats(seconds: Double(args[i + 1]) ?? 60)
            exit(0)
        }
        if let i = args.firstIndex(of: "--beats"), i + 1 < args.count {
            renderBeats(to: args[i + 1])
            exit(0)
        }

        let clawd = Clawd()
        app.delegate = clawd
        app.run()
    }
}
