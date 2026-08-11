// The day as a state machine: exactly one activity is running at any moment.
// Switching closes the previous segment and opens the next one at that instant,
// so the 24 hours are always fully accounted for with no gaps to fill in later.

import Foundation
import SwiftUI

// MARK: - Category

struct Activity: Codable, Identifiable, Hashable {
    var id: String
    var name: String
    var hex: String

    var color: Color { Color(hex: hex) }

    static let defaults: [Activity] = [
        Activity(id: "sleep",   name: "睡觉",  hex: "3B4A6B"),
        Activity(id: "class",   name: "上课",  hex: "7A5EA8"),
        Activity(id: "study",   name: "学习",  hex: "D06749"),
        Activity(id: "research", name: "科研", hex: "3F8F8A"),
        Activity(id: "eat",     name: "吃饭",  hex: "D4A03C"),
        Activity(id: "commute", name: "通勤",  hex: "5E7A94"),
        Activity(id: "sport",   name: "运动",  hex: "5D9856"),
        Activity(id: "rest",    name: "休息",  hex: "C98BA0"),
        Activity(id: "phone",   name: "刷手机", hex: "B85450"),
        Activity(id: "other",   name: "其他",  hex: "6B6B70")
    ]
}

// MARK: - Segment

struct Segment: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var activityID: String
    var start: Date
    var end: Date?                       // nil means it is the one running now

    func duration(now: Date = Date()) -> TimeInterval {
        max(0, (end ?? now).timeIntervalSince(start))
    }
}

// MARK: - A day

struct DayLog: Codable {
    var date: String                     // yyyy-MM-dd
    var segments: [Segment] = []

    var openSegment: Segment? { segments.last(where: { $0.end == nil }) }

    /// Seconds per activity, counting the running segment up to `now`.
    func totals(now: Date = Date()) -> [String: TimeInterval] {
        var out: [String: TimeInterval] = [:]
        for s in segments {
            out[s.activityID, default: 0] += s.duration(now: now)
        }
        return out
    }
}

let dayFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    return f
}()

func dayKey(_ d: Date = Date()) -> String { dayFormatter.string(from: d) }

func startOfDay(_ d: Date = Date()) -> Date {
    Calendar.current.startOfDay(for: d)
}

// MARK: - Storage

/// Shared with the widget through an App Group when one is available, and
/// silently falls back to the app's own defaults when it is not — the app still
/// works, the widget just shows a placeholder.
enum Store {
    static let appGroup = "group.com.myla.clawdday"

    static var defaults: UserDefaults {
        UserDefaults(suiteName: appGroup) ?? .standard
    }

    private static let logKey = "daylog."
    private static let activitiesKey = "activities"

    // MARK: Activities

    static func activities() -> [Activity] {
        guard let d = defaults.data(forKey: activitiesKey),
              let a = try? JSONDecoder().decode([Activity].self, from: d),
              !a.isEmpty else { return Activity.defaults }
        return a
    }

    static func saveActivities(_ a: [Activity]) {
        if let d = try? JSONEncoder().encode(a) { defaults.set(d, forKey: activitiesKey) }
    }

    static func activity(_ id: String) -> Activity? {
        activities().first { $0.id == id }
    }

    // MARK: Day log

    static func load(_ key: String = dayKey()) -> DayLog {
        guard let d = defaults.data(forKey: logKey + key),
              let log = try? JSONDecoder().decode(DayLog.self, from: d) else {
            return DayLog(date: key)
        }
        return log
    }

    static func save(_ log: DayLog) {
        if let d = try? JSONEncoder().encode(log) {
            defaults.set(d, forKey: logKey + log.date)
        }
    }

    /// Switch the running activity. Closes whatever was open at `at`, opens the
    /// new one, and splits across midnight so each day owns its own slice.
    static func switchTo(_ activityID: String, at when: Date = Date()) {
        var today = load(dayKey(when))

        if let open = today.openSegment, let i = today.segments.firstIndex(of: open) {
            if open.activityID == activityID { return }      // already in that state
            today.segments[i].end = when
        }
        today.segments.append(Segment(activityID: activityID, start: when))
        save(today)
    }

    /// Cut a segment in two at `when`, giving the later half a different state.
    /// This is how a forgotten switch gets fixed — including the big one, where
    /// you fell asleep and nobody was awake to tap anything.
    static func split(_ segmentID: String, at when: Date, laterBecomes activityID: String) {
        var log = load()
        guard let i = log.segments.firstIndex(where: { $0.id == segmentID }) else { return }
        let old = log.segments[i]
        guard when > old.start, when < (old.end ?? Date()) else { return }

        log.segments[i].end = when
        log.segments.insert(
            Segment(activityID: activityID, start: when, end: old.end),
            at: i + 1)
        save(log)
    }

    /// Call on launch and when the day flips: if yesterday still has a segment
    /// running, close it at midnight and re-open the same activity today, so
    /// sleeping through midnight lands correctly on both days.
    static func rolloverIfNeeded(now: Date = Date()) {
        let todayKey = dayKey(now)
        var today = load(todayKey)
        guard today.segments.isEmpty else { return }

        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now) ?? now
        var prev = load(dayKey(yesterday))
        guard let open = prev.openSegment,
              let i = prev.segments.firstIndex(of: open) else { return }

        let midnight = startOfDay(now)
        prev.segments[i].end = midnight
        save(prev)

        today.segments.append(Segment(activityID: open.activityID, start: midnight))
        save(today)
    }
}

// MARK: - Color from hex

extension Color {
    init(hex: String) {
        var v: UInt64 = 0
        Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&v)
        self.init(.sRGB,
                  red:   Double((v >> 16) & 0xff) / 255,
                  green: Double((v >> 8) & 0xff) / 255,
                  blue:  Double(v & 0xff) / 255,
                  opacity: 1)
    }
}

func hhmm(_ secs: TimeInterval) -> String {
    let m = Int(secs) / 60
    return m >= 60 ? "\(m / 60) 小时 \(m % 60) 分" : "\(m) 分钟"
}
