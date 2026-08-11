// The hand-drawn Clawd — the round one with the sunburst tuft. The macOS apps
// use the pixel sprite; the phone gets this softer version because it is bigger
// on screen and can carry the curves.
//
// Geometry is in a 54 x 62 box centred on x = 0, feet at y = 0, then scaled.

import SwiftUI

struct ClawdDrawn: View {
    /// Height of the whole plushie in points.
    var height: CGFloat = 90
    var tint: Color? = nil
    var blink: Bool = false
    var happy: Bool = false

    private let boxW: CGFloat = 66      // arms stick out past the body
    private let boxH: CGFloat = 66

    var body: some View {
        Canvas { ctx, size in
            let s = size.height / boxH
            let cx = size.width / 2
            // Flip to a y-up space with the feet on the baseline.
            func P(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: cx + x * s, y: size.height - 4 * s - y * s)
            }
            func R(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
                CGRect(x: cx + x * s, y: size.height - 4 * s - (y + h) * s,
                       width: w * s, height: h * s)
            }

            let body = tint ?? Color(hex: "E88E68")
            let shade = (tint ?? Color(hex: "E88E68")).opacity(0.88)
            let cream = Color(hex: "FFFAF4")
            let ink = Color(hex: "5A4A44")

            // Feet
            ctx.fill(Path(ellipseIn: R(-18, -4, 15, 9)), with: .color(shade))
            ctx.fill(Path(ellipseIn: R(3, -4, 15, 9)), with: .color(shade))

            // Arms, behind the body
            for side in [CGFloat(-1), 1] {
                var p = Path()
                p.move(to: P(23 * side, 30))
                p.addLine(to: P(31 * side, 14))
                ctx.stroke(p, with: .color(body),
                           style: StrokeStyle(lineWidth: 8 * s, lineCap: .round))
                ctx.fill(Path(ellipseIn: R(31 * side - 4.5, 14 - 4.5, 9, 9)),
                         with: .color(shade))
            }

            // Body and belly
            ctx.fill(Path(roundedRect: R(-27, 0, 54, 48), cornerRadius: 19 * s),
                     with: .color(body))
            ctx.fill(Path(roundedRect: R(-15, 3, 30, 22), cornerRadius: 10 * s),
                     with: .color(cream))

            // Sunburst tuft
            var burst = Path()
            for i in 0..<11 {
                let a = CGFloat(i) / 11 * .pi * 2
                let len: CGFloat = i % 2 == 0 ? 11.5 : 7.8
                let w: CGFloat = 2.2
                let base = P(0, 50)
                let dir = CGPoint(x: sin(a), y: cos(a))
                let perp = CGPoint(x: dir.y, y: -dir.x)
                let p0 = CGPoint(x: base.x + dir.x * 1.2 * s - perp.x * w / 2 * s,
                                 y: base.y - dir.y * 1.2 * s + perp.y * w / 2 * s)
                let p1 = CGPoint(x: base.x + dir.x * 1.2 * s + perp.x * w / 2 * s,
                                 y: base.y - dir.y * 1.2 * s - perp.y * w / 2 * s)
                let p2 = CGPoint(x: base.x + dir.x * len * s + perp.x * w / 2 * s,
                                 y: base.y - dir.y * len * s - perp.y * w / 2 * s)
                let p3 = CGPoint(x: base.x + dir.x * len * s - perp.x * w / 2 * s,
                                 y: base.y - dir.y * len * s + perp.y * w / 2 * s)
                burst.move(to: p0); burst.addLine(to: p1)
                burst.addLine(to: p2); burst.addLine(to: p3); burst.closeSubpath()
            }
            ctx.fill(burst, with: .color(shade))

            // Cheeks
            let pink = Color(hex: "F09FB4").opacity(0.55)
            ctx.fill(Path(ellipseIn: R(-22, 27, 7, 5)), with: .color(pink))
            ctx.fill(Path(ellipseIn: R(15, 27, 7, 5)), with: .color(pink))

            // Eyes
            if happy {
                for side in [CGFloat(-1), 1] {
                    var e = Path()
                    e.addArc(center: P(9.5 * side, 34), radius: 4.5 * s,
                             startAngle: .degrees(200), endAngle: .degrees(340),
                             clockwise: false)
                    ctx.stroke(e, with: .color(ink),
                               style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
                }
            } else {
                let h: CGFloat = blink ? 1.8 : 8
                ctx.fill(Path(ellipseIn: R(-13.5, 36 - h / 2, 8, h)), with: .color(ink))
                ctx.fill(Path(ellipseIn: R(5.5, 36 - h / 2, 8, h)), with: .color(ink))
            }

            // Mouth
            var m = Path()
            m.addArc(center: P(0, 32), radius: (happy ? 7.5 : 5.5) * s,
                     startAngle: .degrees(20), endAngle: .degrees(160), clockwise: false)
            ctx.stroke(m, with: .color(ink),
                       style: StrokeStyle(lineWidth: 2 * s, lineCap: .round))
        }
        .frame(width: height * (boxW / boxH), height: height)
    }
}
