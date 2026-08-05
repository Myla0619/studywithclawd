// ClaudePet — a tiny desktop companion that mirrors what Claude Code is doing.
// Reads ~/.claude/pet/state (one word per line) and animates accordingly.
//
// Build: swiftc -O -o claude-pet ClaudePet.swift ~/.claude/shared/Clawd.swift -framework AppKit

import AppKit

// MARK: - Palette

let cOrange  = NSColor(srgbRed: 0.851, green: 0.467, blue: 0.341, alpha: 1.0)
let cOrangeD = NSColor(srgbRed: 0.706, green: 0.353, blue: 0.239, alpha: 1.0)
let cCream   = NSColor(srgbRed: 0.976, green: 0.949, blue: 0.910, alpha: 1.0)
let cInk     = NSColor(srgbRed: 0.169, green: 0.129, blue: 0.098, alpha: 1.0)
let cPink    = NSColor(srgbRed: 0.941, green: 0.549, blue: 0.502, alpha: 0.55)
let cPaper   = NSColor(srgbRed: 0.988, green: 0.984, blue: 0.976, alpha: 1.0)
let cSlate   = NSColor(srgbRed: 0.204, green: 0.220, blue: 0.259, alpha: 1.0)
let cGold    = NSColor(srgbRed: 1.000, green: 0.816, blue: 0.365, alpha: 1.0)

// MARK: - Drawing helpers

@inline(__always) func fillRound(_ ctx: CGContext, _ r: CGRect, _ rad: CGFloat, _ c: NSColor) {
    ctx.addPath(CGPath(roundedRect: r, cornerWidth: rad, cornerHeight: rad, transform: nil))
    ctx.setFillColor(c.cgColor)
    ctx.fillPath()
}

@inline(__always) func fillOval(_ ctx: CGContext, _ r: CGRect, _ c: NSColor) {
    ctx.setFillColor(c.cgColor)
    ctx.fillEllipse(in: r)
}

@inline(__always) func limb(_ ctx: CGContext, _ a: CGPoint, _ b: CGPoint, _ w: CGFloat, _ c: NSColor) {
    ctx.setLineCap(.round)
    ctx.setLineWidth(w)
    ctx.setStrokeColor(c.cgColor)
    ctx.move(to: a)
    ctx.addLine(to: b)
    ctx.strokePath()
}

/// The Claude sunburst, used as the pet's head tuft. Spins while it works.
func sunburst(_ ctx: CGContext, at p: CGPoint, radius R: CGFloat, rotation: CGFloat, _ c: NSColor) {
    let spokes = 11
    ctx.saveGState()
    ctx.translateBy(x: p.x, y: p.y)
    ctx.rotate(by: rotation)
    ctx.setFillColor(c.cgColor)
    for i in 0..<spokes {
        let a = CGFloat(i) / CGFloat(spokes) * .pi * 2
        let len = R * (i % 2 == 0 ? 1.0 : 0.68)
        let w = R * 0.19
        ctx.saveGState()
        ctx.rotate(by: a)
        ctx.addPath(CGPath(roundedRect: CGRect(x: -w / 2, y: R * 0.10, width: w, height: len),
                           cornerWidth: w / 2, cornerHeight: w / 2, transform: nil))
        ctx.fillPath()
        ctx.restoreGState()
    }
    ctx.restoreGState()
}

/// Four-point twinkle.
func sparkle(_ ctx: CGContext, at p: CGPoint, size s: CGFloat, _ c: NSColor) {
    guard s > 0.4 else { return }
    let path = CGMutablePath()
    let waist = s * 0.26
    path.move(to: CGPoint(x: p.x, y: p.y + s))
    path.addQuadCurve(to: CGPoint(x: p.x + s, y: p.y), control: CGPoint(x: p.x + waist, y: p.y + waist))
    path.addQuadCurve(to: CGPoint(x: p.x, y: p.y - s), control: CGPoint(x: p.x + waist, y: p.y - waist))
    path.addQuadCurve(to: CGPoint(x: p.x - s, y: p.y), control: CGPoint(x: p.x - waist, y: p.y - waist))
    path.addQuadCurve(to: CGPoint(x: p.x, y: p.y + s), control: CGPoint(x: p.x - waist, y: p.y + waist))
    path.closeSubpath()
    ctx.addPath(path)
    ctx.setFillColor(c.cgColor)
    ctx.fillPath()
}

/// Little heart, for when you pat it.
func heart(_ ctx: CGContext, at p: CGPoint, size s: CGFloat, _ c: NSColor) {
    guard s > 0.3 else { return }
    ctx.setFillColor(c.cgColor)
    ctx.fillEllipse(in: CGRect(x: p.x - s, y: p.y, width: s, height: s))
    ctx.fillEllipse(in: CGRect(x: p.x, y: p.y, width: s, height: s))
    let path = CGMutablePath()
    path.move(to: CGPoint(x: p.x - s * 0.92, y: p.y + s * 0.42))
    path.addLine(to: CGPoint(x: p.x + s * 0.92, y: p.y + s * 0.42))
    path.addLine(to: CGPoint(x: p.x, y: p.y - s * 0.85))
    path.closeSubpath()
    ctx.addPath(path)
    ctx.fillPath()
}

func label(_ text: String, at center: CGPoint, bg: NSColor,
           size: CGFloat = 10.5, weight: NSFont.Weight = .semibold,
           fg: NSColor = .white, padX: CGFloat = 8, padY: CGFloat = 4) {
    let font = NSFont.systemFont(ofSize: size, weight: weight)
    let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: fg]
    let s = NSAttributedString(string: text, attributes: attrs)
    let sz = s.size()
    let pill = CGRect(x: center.x - sz.width / 2 - padX, y: center.y - sz.height / 2 - padY,
                      width: sz.width + padX * 2, height: sz.height + padY * 2)
    guard let ctx = NSGraphicsContext.current?.cgContext else { return }
    fillRound(ctx, pill, pill.height / 2, bg)
    s.draw(at: CGPoint(x: center.x - sz.width / 2, y: center.y - sz.height / 2))
}

// MARK: - State

enum PetState: String {
    case idle, working, done, waiting
}

// MARK: - View

final class PetView: NSView {
    private(set) var state: PetState = .idle
    var t: CGFloat = 0
    private var enteredAt: CGFloat = 0
    private var stateTime: CGFloat { t - enteredAt }

    // Live progress, mirrored from the files the hooks write.
    var activity = ""                // "改 keys.py"
    var progress: (done: Int, total: Int)?
    var steps = 0
    var elapsed: TimeInterval = 0

    /// Off by default: looping motion in the corner of the eye is exactly what
    /// ADHD guidance says to avoid. State changes still show, they just do not repeat.
    var animate = false

    // Interaction
    var gaze = CGPoint.zero          // -1...1, where the cursor is relative to the pet
    var hovering = false
    private(set) var isDragging = false
    private var dragTilt: CGFloat = 0
    private var patAt: CGFloat = -999
    private var patLine = ""
    private var dragAnchor = CGPoint.zero
    private var winAnchor = CGPoint.zero
    private var dragMoved = false
    private var lastDragX: CGFloat = 0

    var onMoved: ((CGPoint) -> Void)?
    var onHide: (() -> Void)?
    var onReset: (() -> Void)?
    var onQuit: (() -> Void)?

    private let patLines = ["嘿嘿", "在的在的", "别戳啦", "干嘛呀", "再摸一下", "摸鱼中"]

    /// Only this area swallows clicks; everything else stays click-through.
    var hitRegion: CGRect {
        CGRect(x: bounds.midX - 38, y: 4, width: 76, height: 68)
    }

    func setState(_ s: PetState) {
        state = s
        enteredAt = t
    }

    /// Internal transition: the celebration settles back down on its own.
    func tick(_ dt: CGFloat) {
        t += dt
        if state == .done && stateTime > 7.0 { setState(.idle) }
        dragTilt *= 0.85
        needsDisplay = true
    }

    override var isOpaque: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    // MARK: Mouse

    override func mouseDown(with e: NSEvent) {
        dragAnchor = NSEvent.mouseLocation
        winAnchor = window?.frame.origin ?? .zero
        lastDragX = dragAnchor.x
        dragMoved = false
    }

    override func mouseDragged(with e: NSEvent) {
        guard let w = window else { return }
        let now = NSEvent.mouseLocation
        let dx = now.x - dragAnchor.x
        let dy = now.y - dragAnchor.y
        if !dragMoved && (abs(dx) > 3 || abs(dy) > 3) {
            dragMoved = true
            isDragging = true
        }
        guard dragMoved else { return }
        // Swing away from the direction of travel, like something held by the scruff.
        dragTilt = max(-0.35, min(0.35, dragTilt - (now.x - lastDragX) * 0.012))
        lastDragX = now.x
        w.setFrameOrigin(CGPoint(x: winAnchor.x + dx, y: winAnchor.y + dy))
    }

    override func mouseUp(with e: NSEvent) {
        if dragMoved {
            isDragging = false
            if let o = window?.frame.origin { onMoved?(o) }
        } else {
            patAt = t
            patLine = patLines.randomElement() ?? "嘿嘿"
        }
        dragMoved = false
    }

    override func rightMouseDown(with e: NSEvent) {
        let menu = NSMenu()
        menu.addItem(withTitle: "隐藏（pet.sh show 唤回）",
                     action: #selector(menuHide), keyEquivalent: "").target = self
        menu.addItem(withTitle: "回到右上角",
                     action: #selector(menuReset), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "退出宠物",
                     action: #selector(menuQuit), keyEquivalent: "").target = self
        NSMenu.popUpContextMenu(menu, with: e, for: self)
    }

    @objc private func menuHide()  { onHide?() }
    @objc private func menuReset() { onReset?() }
    @objc private func menuQuit()  { onQuit?() }

    /// Force interaction state for the offscreen contact sheet.
    func debugConfigure(hover: Bool = false, dragging: Bool = false,
                        tilt: CGFloat = 0, patAgo: CGFloat? = nil, gaze g: CGPoint = .zero,
                        act: String = "", prog: (Int, Int)? = nil,
                        step: Int = 0, secs: TimeInterval = 0) {
        hovering = hover
        isDragging = dragging
        dragTilt = tilt
        gaze = g
        activity = act
        progress = prog.map { (done: $0.0, total: $0.1) }
        steps = step
        elapsed = secs
        if let p = patAgo { patAt = t - p; patLine = "嘿嘿" }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.clear(bounds)

        let px: CGFloat = 3
        let cx = bounds.midX
        let groundY: CGFloat = 30

        // Motion is quantised to whole pixels so the sprite never blurs.
        var lift: CGFloat = 0
        let patT = t - patAt

        if animate {
            switch state {
            case .idle:    lift = (sin(t * 2.0) > 0.4) ? 1 : 0
            case .working: lift = (sin(t * 6.0) > 0) ? 1 : 0
            case .waiting: lift = (sin(t * 2.6) > 0.3) ? 1 : 0
            case .done:
                let st = stateTime
                lift = st < 1.5 ? (sin(st * 9) > 0 ? 2 : 0) : (sin(t * 2.2) > 0.4 ? 1 : 0)
            }
            if hovering && !isDragging && patT >= 0.7 { lift += 1 }
        } else if state == .done, stateTime < 1.2 {
            lift = sin(stateTime * 9) > 0 ? 2 : 0        // one short cheer, then still
        }

        // Direct responses to your own hand stay either way — they are feedback,
        // not ambient motion.
        if isDragging { lift += 2 }
        if patT < 0.7 { lift -= (sin(patT * 14) > 0) ? 1 : 0 }

        // Face
        var face: ClawdFace = .open
        if animate, t.truncatingRemainder(dividingBy: 3.4) < 0.13 { face = .blink }
        if state == .done && stateTime < 2.6 { face = .happy }
        if patT < 1.2 { face = .happy }
        if isDragging { face = .narrow }

        let body = ClawdSprites.body(face)
        let bodyW = CGFloat(body.w) * px
        let bodyH = CGFloat(body.h) * px

        // Working means a laptop in front, which widens the group.
        let showLaptop = (state == .working && !isDragging)
        let lap = ClawdSprites.laptop
        let lapW = CGFloat(lap.w) * px
        let groupW = showLaptop ? bodyW + lapW - px * 3 : bodyW
        let gx = ((cx - groupW / 2) / px).rounded() * px
        let by = groundY + lift * px

        // Contact shadow, in pixel steps too.
        ctx.setFillColor(NSColor(white: 0.05, alpha: lift > 0 ? 0.10 : 0.16).cgColor)
        ctx.fill(CGRect(x: gx + px, y: groundY - px, width: bodyW - px * 2, height: px))

        body.draw(ctx, at: CGPoint(x: gx, y: by), px: px)
        if showLaptop {
            lap.draw(ctx, at: CGPoint(x: gx + bodyW - px * 3, y: by), px: px)
        }
        if state == .waiting {
            ClawdSprites.question.draw(ctx,
                at: CGPoint(x: gx + bodyW - px * 2, y: by + bodyH - px * 2), px: px)
        }

        drawSparkles(ctx, cx: cx, top: by + bodyH, px: px)
        drawCaption(cx: cx)
    }

    /// Gold twinkles while it celebrates, plus one steady one whenever it is busy.
    private func drawSparkles(_ ctx: CGContext, cx: CGFloat, top: CGFloat, px: CGFloat) {
        let s = ClawdSprites.sparkle
        let sw = CGFloat(s.w) * px

        if animate, state == .working, sin(t * 3) > -0.3 {
            s.draw(ctx, at: CGPoint(x: cx + 24, y: top - px), px: px)
        }
        guard state == .done else { return }
        let st = stateTime
        guard st < (animate ? 2.4 : 1.2) else { return }
        for (i, dx) in [CGFloat(-30), 28, -18].enumerated() {
            // Still mode shows them steady rather than twinkling.
            if animate {
                let q = max(0, st - CGFloat(i) * 0.18)
                guard sin(q * 5.5) > 0 else { continue }
            }
            s.draw(ctx, at: CGPoint(x: cx + dx - sw / 2, y: top - px * CGFloat(1 + i)), px: px)
        }
    }

    /// One line under Clawd. That is the whole readout.
    private func drawCaption(cx: CGFloat) {
        let text: String
        let bg: NSColor

        if isDragging {
            label("哎哟——", at: CGPoint(x: cx, y: 14), bg: cOrangeD.withAlphaComponent(0.92))
            return
        }
        if t - patAt < 1.4 {
            label(patLine, at: CGPoint(x: cx, y: 14),
                  bg: NSColor(srgbRed: 0.84, green: 0.42, blue: 0.52, alpha: 0.92))
            return
        }

        switch state {
        case .idle:
            text = "待命中"
            bg = NSColor(srgbRed: 0.28, green: 0.28, blue: 0.30, alpha: 0.80)
        case .working:
            var s = activity.isEmpty ? "干活中" : activity
            if s.count > 9 { s = String(s.prefix(8)) + "…" }
            if let p = progress, p.total > 0 { s += " \(p.done)/\(p.total)" }
            text = s
            bg = cOrangeD.withAlphaComponent(0.94)
        case .waiting:
            text = "等你一句话"
            bg = NSColor(srgbRed: 0.85, green: 0.60, blue: 0.20, alpha: 0.94)
        case .done:
            // The finish line doubles as the report.
            var bits: [String] = []
            if steps > 0 { bits.append("\(steps) 步") }
            if elapsed >= 1 {
                let n = Int(elapsed.rounded())
                bits.append(n < 60 ? "\(n)s" : String(format: "%d:%02d", n / 60, n % 60))
            }
            text = bits.isEmpty ? "干完了" : bits.joined(separator: " · ")
            bg = NSColor(srgbRed: 0.20, green: 0.60, blue: 0.38, alpha: 0.94)
        }
        label(text, at: CGPoint(x: cx, y: 14), bg: bg)
    }
}

// MARK: - App

/// Borderless windows refuse key status by default, which would break the context menu.
final class PetWindow: NSWindow {
    override var canBecomeKey: Bool { true }
}

final class Controller: NSObject, NSApplicationDelegate {
    private var window: PetWindow!
    private var view: PetView!

    private let dir = NSString(string: "~/.claude/pet").expandingTildeInPath
    private var stateURL: URL { URL(fileURLWithPath: dir + "/state") }
    private var posURL: URL { URL(fileURLWithPath: dir + "/pos") }
    private var hiddenURL: URL { URL(fileURLWithPath: dir + "/hidden") }

    private let size = NSSize(width: 112, height: 76)
    private var lastRaw = ""
    private var lastSeen = Date()
    private var dumpSignal: DispatchSourceSignal?
    private var pollTick = 0

    func applicationDidFinishLaunching(_ n: Notification) {
        window = PetWindow(contentRect: NSRect(origin: defaultOrigin(), size: size),
                           styleMask: [.borderless], backing: .buffered, defer: false)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .statusBar
        window.ignoresMouseEvents = true   // flipped on only while the cursor is on the pet
        window.isMovableByWindowBackground = false
        window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]

        view = PetView(frame: NSRect(origin: .zero, size: size))
        view.wantsLayer = true
        view.onMoved = { [weak self] o in self?.savePosition(o) }
        view.onHide = { [weak self] in self?.setHidden(true) }
        view.onReset = { [weak self] in self?.resetPosition() }
        view.onQuit = { NSApp.terminate(nil) }
        window.contentView = view

        window.setFrameOrigin(savedOrigin() ?? defaultOrigin())
        // Stays out of sight until poll() finds a session that is actually busy.

        // Pixel motion is quantised to whole cells, so 10fps looks identical to 30
        // and costs a third as much. While hidden it does not animate at all.
        Timer.scheduledTimer(withTimeInterval: 1.0 / 10.0, repeats: true) { [weak self] _ in
            guard let self = self, self.window.isVisible else { return }
            self.view.tick(1.0 / 10.0)
            self.trackCursor()
        }
        Timer.scheduledTimer(withTimeInterval: 0.2, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            // Nothing on screen: a slower scan is plenty, it only has to notice
            // when a session picks up work again.
            self.pollTick += 1
            if !self.window.isVisible && self.pollTick % 3 != 0 { return }
            self.poll()
        }

        // `kill -USR1 <pid>` dumps the live frame — handy for checking that the
        // pet is actually reacting, without needing screen-recording rights.
        signal(SIGUSR1, SIG_IGN)
        let src = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        src.setEventHandler { [weak self] in self?.dumpFrame() }
        src.resume()
        dumpSignal = src

        poll()
    }

    private func dumpFrame() {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: rep)
        if let data = rep.representation(using: .png, properties: [:]) {
            try? data.write(to: URL(fileURLWithPath: dir + "/frame.png"))
        }
    }

    // MARK: Hover / click-through

    /// The window only swallows clicks while the cursor is actually over the pet,
    /// so the rest of the corner stays usable.
    private func trackCursor() {
        guard let w = window, w.isVisible else { return }
        let m = NSEvent.mouseLocation
        let local = CGPoint(x: m.x - w.frame.minX, y: m.y - w.frame.minY)

        if !view.isDragging {
            let inside = view.hitRegion.contains(local)
            if w.ignoresMouseEvents == inside { w.ignoresMouseEvents = !inside }
            view.hovering = inside
        }

        // Gaze tracks the cursor anywhere on screen, not just inside the window.
        let c = CGPoint(x: view.bounds.midX, y: 92)
        view.gaze = CGPoint(x: max(-1, min(1, (local.x - c.x) / 90)),
                            y: max(-1, min(1, (local.y - c.y) / 90)))
    }

    // MARK: Position

    private func defaultOrigin() -> NSPoint {
        let vf = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        return NSPoint(x: vf.maxX - size.width - 16, y: vf.maxY - size.height - 4)
    }

    private func savedOrigin() -> NSPoint? {
        guard let s = try? String(contentsOf: posURL, encoding: .utf8) else { return nil }
        let p = s.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: " ")
        guard p.count == 2, let x = Double(p[0]), let y = Double(p[1]) else { return nil }
        // Only honor it if it still lands on a screen that exists today.
        let pt = NSPoint(x: x, y: y)
        let box = NSRect(origin: pt, size: size)
        guard NSScreen.screens.contains(where: { $0.frame.intersects(box) }) else { return nil }
        return pt
    }

    private func savePosition(_ o: NSPoint) {
        try? "\(Int(o.x)) \(Int(o.y))".write(to: posURL, atomically: true, encoding: .utf8)
    }

    private func resetPosition() {
        try? FileManager.default.removeItem(at: posURL)
        window.setFrameOrigin(defaultOrigin())
    }

    // MARK: Visibility

    /// Fade in and out rather than popping, since it now comes and goes on its own.
    private func setVisible(_ show: Bool) {
        guard show != window.isVisible else { return }
        if show {
            window.alphaValue = 0
            window.orderFrontRegardless()
            NSAnimationContext.runAnimationGroup { c in
                c.duration = 0.22
                window.animator().alphaValue = 1
            }
        } else {
            NSAnimationContext.runAnimationGroup({ c in
                c.duration = 0.22
                window.animator().alphaValue = 0
            }, completionHandler: { [weak self] in
                guard let w = self?.window, w.alphaValue < 0.05 else { return }
                w.orderOut(nil)
            })
        }
    }

    private func setHidden(_ hide: Bool) {
        if hide {
            FileManager.default.createFile(atPath: hiddenURL.path, contents: nil)
            setVisible(false)
        } else {
            try? FileManager.default.removeItem(at: hiddenURL)
        }
    }

    // MARK: State polling

    /// One Claude session's view of the world.
    private struct Snap {
        var id = ""
        var state: PetState = .idle
        var mtime = Date.distantPast
        var activity = ""
        var steps = 0
        var progress: (done: Int, total: Int)?
        var elapsed: TimeInterval = 0
        var proj = ""
    }

    private func readFile(_ path: String) -> String {
        ((try? String(contentsOfFile: path, encoding: .utf8)) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func loadSession(_ id: String, cutoff: Date) -> Snap? {
        let sd = dir + "/s/" + id
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: sd + "/state"),
              let m = attrs[.modificationDate] as? Date else { return nil }
        // Bail before touching the other files — most sessions here are long dead.
        guard m > cutoff else { return nil }

        var s = Snap()
        s.id = id
        s.mtime = m
        s.state = PetState(rawValue: readFile(sd + "/state")) ?? .idle
        s.activity = readFile(sd + "/activity")
        s.steps = Int(readFile(sd + "/step")) ?? 0
        s.proj = readFile(sd + "/proj")

        let p = readFile(sd + "/progress").split(separator: " ").compactMap { Int($0) }
        s.progress = (p.count == 2 && p[1] > 0) ? (done: p[0], total: p[1]) : nil

        if s.state == .done {
            s.elapsed = TimeInterval(readFile(sd + "/dur")) ?? 0
        } else if let since = TimeInterval(readFile(sd + "/since")) {
            s.elapsed = max(0, Date().timeIntervalSince1970 - since)
        }
        return s
    }

    /// Every session on this machine writes here. Follow the busiest one:
    /// actually working beats waiting on you, which beats a fresh finish.
    private func pickSession() -> (best: Snap?, live: Int, newest: Date) {
        let ids = (try? FileManager.default.contentsOfDirectory(atPath: dir + "/s")) ?? []
        let now = Date()
        let cutoff = now.addingTimeInterval(-1800)
        let live = ids.compactMap { loadSession($0, cutoff: cutoff) }

        func score(_ s: Snap) -> Int {
            switch s.state {
            case .working: return 3
            case .waiting: return 2
            case .done:    return now.timeIntervalSince(s.mtime) < 12 ? 1 : 0
            case .idle:    return 0
            }
        }
        let best = live.max {
            score($0) != score($1) ? score($0) < score($1) : $0.mtime < $1.mtime
        }
        return (best, live.count, live.map(\.mtime).max() ?? .distantPast)
    }

    private func poll() {
        if FileManager.default.fileExists(atPath: dir + "/quit") {
            try? FileManager.default.removeItem(atPath: dir + "/quit")
            NSApp.terminate(nil)
            return
        }

        let (best, _, newest) = pickSession()
        let s = best ?? Snap()

        // Re-trigger the animation when the winner or its state changes, but not
        // on every poll — `done` needs to settle to `idle` under its own timer.
        let key = s.id + "|" + s.state.rawValue
        if key != lastRaw {
            lastRaw = key
            view.setState(s.state)
        }

        view.activity = s.activity
        view.steps = s.steps
        view.progress = s.progress
        view.elapsed = s.elapsed

        // On-demand: only show up while some session is busy, then slip away.
        // `pet.sh hide` still forces it off regardless.
        view.animate = FileManager.default.fileExists(
            atPath: NSString(string: "~/.claude/shared/motion").expandingTildeInPath)
        let forcedOff = FileManager.default.fileExists(atPath: hiddenURL.path)
        setVisible(!forcedOff && view.state != .idle)

        // Don't linger for hours after every Claude session goes quiet.
        if newest != .distantPast, Date().timeIntervalSince(newest) > 3600 {
            NSApp.terminate(nil)
        }
    }
}

// MARK: - Offscreen contact sheet (for previewing frames without screen capture)

func renderCell(_ s: PetState, _ time: CGFloat, size: NSSize,
                configure: ((PetView) -> Void)? = nil) -> NSImage {
    let view = PetView(frame: NSRect(origin: .zero, size: size))
    view.t = 0
    view.setState(s)          // stamps enteredAt = 0
    view.t = time             // so stateTime == time
    configure?(view)

    let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                               pixelsWide: Int(size.width * 2), pixelsHigh: Int(size.height * 2),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = size
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    view.draw(view.bounds)
    NSGraphicsContext.restoreGraphicsState()

    let img = NSImage(size: size)
    img.addRepresentation(rep)
    return img
}

func renderContactSheet(to path: String) {
    let cell = NSSize(width: 112, height: 76)
    typealias Frame = (PetState, CGFloat, String, ((PetView) -> Void)?)
    let frames: [Frame] = [
        (.idle, 0.9, "idle", nil),
        (.working, 0.30, "无 todo：动作 + 步数 + 用时",
            { $0.debugConfigure(act: "改 keys.py", step: 12, secs: 83) }),
        (.working, 0.30, "有 todo：真实完成度",
            { $0.debugConfigure(act: "跑 pytest", prog: (3, 7), step: 41, secs: 372) }),
        (.working, 0.30, "长名字截断",
            { $0.debugConfigure(act: "调 search_library", step: 3, secs: 9) }),
        (.done, 0.55, "汇报：本轮总结",
            { $0.debugConfigure(prog: (7, 7), step: 58, secs: 494) }),
        (.waiting, 0.40, "waiting", nil),
        (.idle, 0.9, "hover + 看向右上", { $0.debugConfigure(hover: true, gaze: CGPoint(x: 1, y: 1)) }),
        (.idle, 0.9, "摸头 t+0.7", { $0.debugConfigure(patAgo: 0.7) }),
        (.working, 0.3, "拖拽中", { $0.debugConfigure(dragging: true, tilt: 0.28, act: "改 keys.py") })
    ]
    let cols = 3
    let rows = (frames.count + cols - 1) / cols
    let labelH: CGFloat = 18
    let W = cell.width * CGFloat(cols)
    let H = (cell.height + labelH) * CGFloat(rows)

    let rep = NSBitmapImageRep(bitmapDataPlanes: nil,
                               pixelsWide: Int(W * 2), pixelsHigh: Int(H * 2),
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    NSColor(srgbRed: 0.13, green: 0.13, blue: 0.15, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: W, height: H).fill()

    for (i, f) in frames.enumerated() {
        let col = i % cols
        let row = i / cols
        let x = CGFloat(col) * cell.width
        let y = H - CGFloat(row + 1) * (cell.height + labelH)
        renderCell(f.0, f.1, size: cell, configure: f.3)
            .draw(at: NSPoint(x: x, y: y + labelH), from: .zero, operation: .sourceOver, fraction: 1)
        let cap = NSAttributedString(string: f.2, attributes: [
            .font: NSFont.systemFont(ofSize: 10, weight: .medium),
            .foregroundColor: NSColor(white: 0.62, alpha: 1)
        ])
        cap.draw(at: NSPoint(x: x + 10, y: y + 3))
    }
    NSGraphicsContext.restoreGraphicsState()

    if let data = rep.representation(using: .png, properties: [:]) {
        try? data.write(to: URL(fileURLWithPath: path))
    }
}

// MARK: - Entry point

@main
enum PetApp {
    static func main() {
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)   // no Dock icon, no menu bar

        let args = CommandLine.arguments
        if let i = args.firstIndex(of: "--sheet"), i + 1 < args.count {
            renderContactSheet(to: args[i + 1])
            exit(0)
        }

        let controller = Controller()
        app.delegate = controller
        app.run()
    }
}
