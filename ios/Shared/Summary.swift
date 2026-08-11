// Roll several days up into one set of totals, for the week / month views and
// for the per-activity detail sheet.

import Foundation

enum Span: String, CaseIterable, Identifiable {
    case week = "本周", month = "本月"
    var id: String { rawValue }
    var days: Int { self == .week ? 7 : 30 }
}

struct DaySlice: Identifiable {
    let id: String            // yyyy-MM-dd
    let date: Date
    let totals: [String: TimeInterval]
    var total: TimeInterval { totals.values.reduce(0, +) }
}

enum Summary {
    /// The last `days` days ending today, oldest first.
    static func slices(days: Int, now: Date = Date()) -> [DaySlice] {
        let cal = Calendar.current
        return (0..<days).reversed().compactMap { back in
            guard let d = cal.date(byAdding: .day, value: -back, to: now) else { return nil }
            let key = dayKey(d)
            let log = Store.load(key)
            guard !log.segments.isEmpty else { return nil }
            // Only the running day counts up to "now"; past days are already closed.
            let end = cal.isDate(d, inSameDayAs: now) ? now : cal.startOfDay(for: d).addingTimeInterval(86_400)
            return DaySlice(id: key, date: d, totals: log.totals(now: end))
        }
    }

    static func totals(_ slices: [DaySlice]) -> [String: TimeInterval] {
        var out: [String: TimeInterval] = [:]
        for s in slices { for (k, v) in s.totals { out[k, default: 0] += v } }
        return out
    }

    /// Every segment of one activity across a span, newest first.
    static func segments(of activityID: String, days: Int,
                         now: Date = Date()) -> [(day: String, seg: Segment)] {
        let cal = Calendar.current
        var out: [(String, Segment)] = []
        for back in 0..<days {
            guard let d = cal.date(byAdding: .day, value: -back, to: now) else { continue }
            let key = dayKey(d)
            for s in Store.load(key).segments where s.activityID == activityID {
                out.append((key, s))
            }
        }
        return out.sorted { $0.1.start > $1.1.start }
    }
}

let clockFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    return f
}()

func clock(_ d: Date) -> String { clockFormatter.string(from: d) }
