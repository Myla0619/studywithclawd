// The 24-hour dial. Midnight at the top, clockwise, one full turn per day.
// Shared by the app and the widget so both draw exactly the same picture.

import SwiftUI

struct Dial: View {
    var log: DayLog
    var activities: [Activity]
    var now: Date = Date()
    /// Ring thickness as a fraction of the radius.
    var thickness: CGFloat = 0.26
    var showTicks: Bool = true

    private func colorFor(_ id: String) -> Color {
        activities.first { $0.id == id }?.color ?? Color(hex: "6B6B70")
    }

    /// Fraction round the dial, 0 at midnight.
    private func turn(_ d: Date) -> Double {
        let s = d.timeIntervalSince(startOfDay(now))
        return min(1, max(0, s / 86_400))
    }

    var body: some View {
        Canvas { ctx, size in
            let side = min(size.width, size.height)
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let outer = side / 2
            let inner = outer * (1 - thickness)

            // Empty track — the part of the day not yet lived.
            ctx.stroke(
                Path { p in
                    p.addArc(center: c, radius: (outer + inner) / 2,
                             startAngle: .degrees(0), endAngle: .degrees(360), clockwise: false)
                },
                with: .color(.white.opacity(0.07)),
                lineWidth: outer - inner)

            for seg in log.segments {
                let a0 = turn(seg.start)
                let a1 = turn(seg.end ?? now)
                guard a1 > a0 else { continue }
                let path = ringSlice(center: c, inner: inner, outer: outer, from: a0, to: a1)
                ctx.fill(path, with: .color(colorFor(seg.activityID)))
            }

            if showTicks {
                for h in stride(from: 0, to: 24, by: 3) {
                    let ang = Angle.degrees(Double(h) / 24 * 360 - 90)
                    let r0 = inner - side * 0.012
                    let r1 = inner - side * 0.045
                    var p = Path()
                    p.move(to: CGPoint(x: c.x + cos(ang.radians) * r0,
                                       y: c.y + sin(ang.radians) * r0))
                    p.addLine(to: CGPoint(x: c.x + cos(ang.radians) * r1,
                                          y: c.y + sin(ang.radians) * r1))
                    ctx.stroke(p, with: .color(.white.opacity(h == 0 ? 0.45 : 0.18)),
                               lineWidth: side * 0.006)
                }
            }

            // A hairline at "now" so it is obvious where the day has got to.
            let nowAng = Angle.degrees(turn(now) * 360 - 90)
            var hand = Path()
            hand.move(to: CGPoint(x: c.x + cos(nowAng.radians) * (inner - side * 0.01),
                                  y: c.y + sin(nowAng.radians) * (inner - side * 0.01)))
            hand.addLine(to: CGPoint(x: c.x + cos(nowAng.radians) * (outer + side * 0.015),
                                     y: c.y + sin(nowAng.radians) * (outer + side * 0.015)))
            ctx.stroke(hand, with: .color(.white.opacity(0.8)), lineWidth: side * 0.008)
        }
        .aspectRatio(1, contentMode: .fit)
    }

    /// A filled wedge of the ring between two fractions of the day.
    private func ringSlice(center c: CGPoint, inner: CGFloat, outer: CGFloat,
                           from a0: Double, to a1: Double) -> Path {
        let s = Angle.degrees(a0 * 360 - 90)
        let e = Angle.degrees(a1 * 360 - 90)
        var p = Path()
        p.addArc(center: c, radius: outer, startAngle: s, endAngle: e, clockwise: false)
        p.addArc(center: c, radius: inner, startAngle: e, endAngle: s, clockwise: true)
        p.closeSubpath()
        return p
    }
}

// MARK: - Dial with Clawd in the middle

struct DialFace: View {
    var log: DayLog
    var activities: [Activity]
    var now: Date = Date()
    var compact: Bool = false

    private var current: (Activity, TimeInterval)? {
        guard let open = log.openSegment,
              let a = activities.first(where: { $0.id == open.activityID }) else { return nil }
        return (a, open.duration(now: now))
    }

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                Dial(log: log, activities: activities, now: now, showTicks: !compact)

                VStack(spacing: side * 0.02) {
                    ClawdDrawn(height: side * 0.30, tint: current?.0.color)
                    if let (a, secs) = current {
                        Text(a.name)
                            .font(.system(size: side * 0.075, weight: .semibold))
                            .foregroundStyle(.primary)
                        if !compact {
                            Text(hhmm(secs))
                                .font(.system(size: side * 0.055))
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        Text("还没开始")
                            .font(.system(size: side * 0.065))
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
    }
}
