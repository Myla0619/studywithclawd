// Clawd — pixel sprite, shared by the Claude Code progress pet and the study
// supervisor so the two stay the same character.
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
        "M": NSColor(srgbRed: 0.937, green: 0.933, blue: 0.918, alpha: 1),   // mug
        "K": NSColor(srgbRed: 0.376, green: 0.235, blue: 0.157, alpha: 1),   // coffee
        "z": NSColor(srgbRed: 0.780, green: 0.843, blue: 0.925, alpha: 1),   // sleepy Z
        "l": ClawdColor.shade,
        "@": ClawdColor.eye,
        "D": ClawdColor.dark,
        "B": ClawdColor.darker,
        "G": ClawdColor.code,
        "g": ClawdColor.gold,
        "C": ClawdColor.cloth,
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

    /// 4 x 5 bicep, drawn on either side. An overlay rather than a whole new
    /// body, so it composes with every pose.
    static func arm(left: Bool) -> Sprite {
        Sprite(rows: left ? ["..##", ".###", "####", ".###", "..##"]
                          : ["##..", "###.", "####", "###.", "##.."],
               map: buffPalette)
    }

    /// Blocky body, four stubby legs, eyes as plain squares — no mouth.
    /// Poses are separate sprites so the pixel grid never gets scaled.
    static func body(_ face: ClawdFace, pose: ClawdPose = .normal,
                     buff: Bool = false) -> Sprite {
        var rows: [String]
        let e0: Int                      // top eye row

        switch pose {
        case .normal:
            rows = ["....######....", "..##########..", ".############.",
                    "##############", "##############", "##############",
                    "##############", "##############",
                    ".ll.ll..ll.ll.", ".ll.ll..ll.ll."]
            e0 = 3
        case .tall:
            rows = ["....######....", "..##########..", ".############.",
                    "##############", "##############", "##############",
                    "##############", "##############", "##############",
                    "##############",
                    ".ll.ll..ll.ll.", ".ll.ll..ll.ll."]
            e0 = 4
        case .squat:
            rows = ["...########...", ".############.", "##############",
                    "##############", "##############", "##############",
                    ".ll.ll..ll.ll.", ".ll.ll..ll.ll."]
            e0 = 2
        }
        let e1 = e0 + 1

        func stamp(_ r: Int, _ cols: [Int]) {
            guard r >= 0, r < rows.count else { return }
            var ch = Array(rows[r])
            for c in cols where c >= 0 && c < ch.count { ch[c] = "@" }
            rows[r] = String(ch)
        }

        switch face {
        case .open:      stamp(e0, [3, 4, 9, 10]); stamp(e1, [3, 4, 9, 10])
        case .blink:     stamp(e1, [2, 3, 4, 5, 8, 9, 10, 11])   // lids shut
        case .narrow:    stamp(e1, [3, 4, 9, 10])
        case .happy:     stamp(e0, [4, 5, 8, 9]);  stamp(e1, [3, 4, 9, 10])
        case .sad:       stamp(e1, [3, 4, 9, 10]); stamp(e1 + 1, [3, 4, 9, 10])
        case .lookLeft:  stamp(e0, [2, 3, 8, 9]);  stamp(e1, [2, 3, 8, 9])
        case .lookRight: stamp(e0, [4, 5, 10, 11]); stamp(e1, [4, 5, 10, 11])
        case .wide:      stamp(e0 - 1, [3, 4, 9, 10]); stamp(e0, [3, 4, 9, 10])
                         stamp(e1, [3, 4, 9, 10])
        }
        return Sprite(rows: rows, map: buff ? buffPalette : palette)
    }

    /// 13 x 8 laptop showing </>, drawn in front of Clawd while it works.
    static let laptop = Sprite(rows: [
        "DDDDDDDDDDDDD",
        "D..G...G.G..D",
        "D.G....G..G.D",
        "DG....G....GD",
        "D.G..G....G.D",
        "D..G.G...G..D",
        "DDDDDDDDDDDDD",
        "BBBBBBBBBBBBB"
    ], map: palette)

    /// 13 x 8 laptop with lines of notes, for when it studies alongside you.
    static let studyLaptop = Sprite(rows: [
        "DDDDDDDDDDDDD",
        "D.WWWWWWW...D",
        "D.WWWW......D",
        "D.WWWWWWWW..D",
        "D.WWWWW.....D",
        "D.WWWWWWW...D",
        "DDDDDDDDDDDDD",
        "BBBBBBBBBBBBB"
    ], map: palette)

    /// 12 x 6 whip, mid-crack. Two cells thick so the lash reads at this size.
    static let whip = Sprite(rows: [
        "..........ww",
        "........ww..",
        "......ww....",
        "....ww......",
        "hhhww.......",
        "hhh........."
    ], map: palette)

    /// 5 x 5 gold twinkle.
    static let sparkle = Sprite(rows: [
        "..g..",
        "..g..",
        "ggggg",
        "..g..",
        "..g.."
    ], map: palette)

    /// 5 x 5 mug of coffee.
    static let cup = Sprite(rows: [
        "MMMM.",
        "MKKMM",
        "MKKM.",
        "MKKMM",
        "MMMM."
    ], map: palette)

    /// 3 x 3 Z, stacked at a few sizes when it nods off.
    static let zed = Sprite(rows: ["zzz", ".z.", "zzz"], map: palette)

    /// 2 x 5 exclamation, for the moment it catches itself dozing.
    static let bang = Sprite(rows: ["gg", "gg", "gg", "..", "gg"], map: palette)

    /// 5 x 7 question mark, for when it needs an answer from you.
    static let question = Sprite(rows: [
        ".ggg.",
        "g...g",
        "...g.",
        "..g..",
        "..g..",
        ".....",
        "..g.."
    ], map: palette)
}
