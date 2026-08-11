// The same 28-cell Clawd as the macOS apps, redrawn for SwiftUI so the phone
// and the desktop are recognisably the same character.

import SwiftUI

struct ClawdPixel: View {
    /// Size of one pixel cell in points.
    var cell: CGFloat = 3
    /// Overrides the body colour — handy for tinting to the current activity.
    var tint: Color? = nil
    var blink: Bool = false

    private static let rows: [String] = [
        "..........########..........",
        ".......##############.......",
        ".....##################.....",
        "....####################....",
        "...######################...",
        "..########################..",
        ".##########################.",
        "######@@@@########@@@@######",
        "######@@@@########@@@@######",
        "######@@@@########@@@@######",
        "######@@@@########@@@@######",
        "############################",
        "############################",
        "############################",
        "############################",
        "############################",
        "..lll...lll......lll...lll..",
        "..lll...lll......lll...lll..",
        "..lll...lll......lll...lll..",
        "..lll...lll......lll...lll.."
    ]

    private static let blinkRows: [String] = {
        var r = rows
        let open = "######@@@@########@@@@######"
        let flat = "############################"
        for i in 7...9 where r[i] == open { r[i] = flat }
        r[10] = "####@@@@@@@@####@@@@@@@@####"
        return r
    }()

    var body: some View {
        let rows = blink ? Self.blinkRows : Self.rows
        let w = CGFloat(rows[0].count) * cell
        let h = CGFloat(rows.count) * cell

        Canvas { ctx, _ in
            let body = tint ?? Color(hex: "D06749")
            let shade = Color(hex: "B0523A")
            let eye = Color(hex: "141110")
            for (r, row) in rows.enumerated() {
                for (i, ch) in row.enumerated() {
                    let color: Color
                    switch ch {
                    case "#": color = body
                    case "l": color = shade
                    case "@": color = eye
                    default: continue
                    }
                    ctx.fill(
                        Path(CGRect(x: CGFloat(i) * cell, y: CGFloat(r) * cell,
                                    width: cell, height: cell)),
                        with: .color(color))
                }
            }
        }
        .frame(width: w, height: h)
    }
}
