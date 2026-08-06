// Clawd — pixel sprite, shared by the Claude Code progress pet and the study
// supervisor so the two stay the same character.
//
// Drawn on a 28-wide grid (was 14). Same physical size on screen, four times the
// cells, so the silhouette steps come out half as coarse.
//
// Compile it alongside whichever app needs it:
//   swiftc -O -o claude-pet ClaudePet.swift ~/.claude/shared/Clawd.swift -framework AppKit

import AppKit

enum ClawdColor {
    static let body   = NSColor(srgbRed: 0.816, green: 0.404, blue: 0.286, alpha: 1)
    static let shade  = NSColor(srgbRed: 0.690, green: 0.322, blue: 0.216, alpha: 1)
    static let eye    = NSColor(srgbRed: 0.075, green: 0.067, blue: 0.067, alpha: 1)
    static let gold   = NSColor(srgbRed: 0.965, green: 0.702, blue: 0.196, alpha: 1)
    static let dark   = NSColor(srgbRed: 0.192, green: 0.204, blue: 0.220, alpha: 1)
    static let darker = NSColor(srgbRed: 0.106, green: 0.114, blue: 0.129, alpha: 1)
    static let code   = NSColor(srgbRed: 0.478, green: 0.769, blue: 0.396, alpha: 1)
    static let cloth  = NSColor(srgbRed: 0.639, green: 0.749, blue: 0.878, alpha: 1)
}

/// A sprite written as rows of characters and painted one square per cell.
struct Sprite {
    let rows: [String]
    let map: [Character: NSColor]

    var w: Int { rows.map(\.count).max() ?? 0 }
    var h: Int { rows.count }

    /// Bottom-left corner at `origin`, one cell per `px` points.
    /// Coordinates are snapped so cells never land on half pixels.
    func draw(_ c: CGContext, at origin: CGPoint, px: CGFloat) {
        let ox = (origin.x / px).rounded() * px
        let oy = (origin.y / px).rounded() * px
        for (r, row) in rows.enumerated() {
            let y = oy + CGFloat(h - 1 - r) * px
            for (i, ch) in row.enumerated() {
                guard let col = map[ch] else { continue }
                c.setFillColor(col.cgColor)
                c.fill(CGRect(x: ox + CGFloat(i) * px, y: y, width: px, height: px))
            }
        }
    }

    func size(px: CGFloat) -> CGSize { CGSize(width: CGFloat(w) * px, height: CGFloat(h) * px) }
}

// MARK: - Clawd

enum ClawdFace {
    case open       // two square eyes
    case narrow     // watching you
    case happy      // squinting with delight
    case sad
    case blink
    case lookLeft   // eyes drift off to one side
    case lookRight
    case wide       // caught out / startled
}

/// Squash and stretch, done the pixel-art way: separate sprites, not scaling.
enum ClawdPose { case normal, tall, squat }

enum ClawdSprites {

    static let palette: [Character: NSColor] = [
        "#": ClawdColor.body,
        "l": ClawdColor.shade,
        "@": ClawdColor.eye,
        "D": ClawdColor.dark,
        "B": ClawdColor.darker,
        "G": ClawdColor.code,
        "g": ClawdColor.gold,
        "C": ClawdColor.cloth,
        "M": NSColor(srgbRed: 0.937, green: 0.933, blue: 0.918, alpha: 1),   // mug
        "K": NSColor(srgbRed: 0.376, green: 0.235, blue: 0.157, alpha: 1),   // coffee
        "z": NSColor(srgbRed: 0.780, green: 0.843, blue: 0.925, alpha: 1),   // sleepy Z
        "W": NSColor(srgbRed: 0.827, green: 0.835, blue: 0.851, alpha: 1),   // text on screen
        "w": NSColor(srgbRed: 0.722, green: 0.549, blue: 0.353, alpha: 1),   // whip lash
        "h": NSColor(srgbRed: 0.361, green: 0.227, blue: 0.145, alpha: 1)    // whip handle
    ]

    /// Buff form: brighter body, darker legs — reads sharper at the same size.
    static let buffPalette: [Character: NSColor] = {
        var p = palette
        p["#"] = NSColor(srgbRed: 0.898, green: 0.451, blue: 0.298, alpha: 1)
        p["l"] = NSColor(srgbRed: 0.573, green: 0.251, blue: 0.157, alpha: 1)
        return p
    }()

    // 28 cells wide. The dome and the legs are fixed; only the straight middle
    // stretches per pose, which keeps all three poses on model.
    private static let dome = [
        "..........########..........",
        ".......##############.......",
        ".....##################.....",
        "....####################....",
        "...######################...",
        "..########################..",
        ".##########################."
    ]
    private static let slab = "############################"
    private static let legs = [
        "..lll...lll......lll...lll..",
        "..lll...lll......lll...lll..",
        "..lll...lll......lll...lll..",
        "..lll...lll......lll...lll.."
    ]

    /// Blocky body, four stubby legs, eyes as plain squares — no mouth.
    static func body(_ face: ClawdFace, pose: ClawdPose = .normal,
                     buff: Bool = false) -> Sprite {
        let middle: Int
        let e0: Int                              // top eye row
        switch pose {
        case .normal: middle = 9;  e0 = 6
        case .tall:   middle = 13; e0 = 8
        case .squat:  middle = 5;  e0 = 5
        }
        var rows = dome + Array(repeating: slab, count: middle) + legs

        func stamp(_ r0: Int, _ r1: Int, _ cols: [Int]) {
            guard r0 <= r1 else { return }
            for r in r0...r1 where r >= 0 && r < rows.count {
                var ch = Array(rows[r])
                for c in cols where c >= 0 && c < ch.count { ch[c] = "@" }
                rows[r] = String(ch)
            }
        }
        let L = [6, 7, 8, 9], R = [18, 19, 20, 21]          // eye columns

        switch face {
        case .open:
            stamp(e0, e0 + 3, L + R)
        case .narrow:
            stamp(e0 + 2, e0 + 3, L + R)
        case .blink:
            stamp(e0 + 2, e0 + 3,
                  [4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19, 20, 21, 22, 23])
        case .happy:
            stamp(e0, e0 + 1, [8, 9, 10, 11, 16, 17, 18, 19])
            stamp(e0 + 2, e0 + 3, L + R)
        case .sad:
            stamp(e0 + 2, e0 + 5, L + R)
        case .lookLeft:
            stamp(e0, e0 + 3, [3, 4, 5, 6, 15, 16, 17, 18])
        case .lookRight:
            stamp(e0, e0 + 3, [9, 10, 11, 12, 21, 22, 23, 24])
        case .wide:
            stamp(e0 - 2, e0 + 3, L + R)
        }
        return Sprite(rows: rows, map: buff ? buffPalette : palette)
    }

    /// 8 x 10 bicep, drawn on either side. An overlay rather than a whole new
    /// body, so it composes with every pose.
    static func arm(left: Bool) -> Sprite {
        let r = ["...#####", "..######", ".#######", "########", "########",
                 "########", "########", ".#######", "..######", "...#####"]
        return Sprite(rows: left ? r : r.map { String($0.reversed()) }, map: buffPalette)
    }

    /// 26 x 16 laptop, lines of code on the screen.
    static let laptop = screen("G")

    /// Same machine, lines of notes — for when it studies alongside you.
    static let studyLaptop = screen("W")

    private static func screen(_ i: String) -> Sprite {
        Sprite(rows: [
            "DDDDDDDDDDDDDDDDDDDDDDDDDD",
            "DD......................DD",
            "DD..\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)............DD",
            "DD..\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)............DD",
            "DD......................DD",
            "DD..\(i)\(i)\(i)\(i)................DD",
            "DD..\(i)\(i)\(i)\(i)................DD",
            "DD......................DD",
            "DD..\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)........DD",
            "DD..\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)\(i)........DD",
            "DD......................DD",
            "DD..\(i)\(i)\(i)\(i)\(i)\(i)..............DD",
            "DD..\(i)\(i)\(i)\(i)\(i)\(i)..............DD",
            "DD......................DD",
            "DDDDDDDDDDDDDDDDDDDDDDDDDD",
            "BBBBBBBBBBBBBBBBBBBBBBBBBB"
        ], map: palette)
    }

    /// 24 x 12 whip, mid-crack.
    static let whip = Sprite(rows: [
        "......................ww",
        "....................ww..",
        "..................ww....",
        "................ww......",
        "..............ww........",
        "............ww..........",
        "..........ww............",
        "........ww..............",
        "......ww................",
        "hhhhww..................",
        "hhhh....................",
        "hhhh...................."
    ], map: palette)

    /// 10 x 10 gold twinkle.
    static let sparkle = Sprite(rows: [
        "....gg....",
        "....gg....",
        "....gg....",
        "....gg....",
        "gggggggggg",
        "gggggggggg",
        "....gg....",
        "....gg....",
        "....gg....",
        "....gg...."
    ], map: palette)

    /// 10 x 8 mug of coffee.
    static let cup = Sprite(rows: [
        "MMMMMMMM..",
        "MMKKKKMMMM",
        "MMKKKKMM.M",
        "MMKKKKMM.M",
        "MMKKKKMM.M",
        "MMKKKKMMMM",
        "MMMMMMMM..",
        "MMMMMMMM.."
    ], map: palette)

    /// 6 x 5 Z, stacked at a few sizes when it nods off.
    static let zed = Sprite(rows: [
        "zzzzzz",
        "....zz",
        "..zz..",
        "zz....",
        "zzzzzz"
    ], map: palette)

    /// 4 x 10 exclamation, for the moment it catches itself dozing.
    static let bang = Sprite(rows: [
        "gggg", "gggg", "gggg", "gggg", "gggg", "gggg",
        "....", "....", "gggg", "gggg"
    ], map: palette)

    /// 10 x 14 question mark, for when it needs an answer from you.
    static let question = Sprite(rows: [
        "..gggggg..",
        ".gg....gg.",
        "gg......gg",
        "gg......gg",
        "........gg",
        ".......gg.",
        ".....ggg..",
        "....ggg...",
        "....gg....",
        "....gg....",
        "..........",
        "..........",
        "....gg....",
        "....gg...."
    ], map: palette)
}
