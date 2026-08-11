// Home-screen widget: today's dial, nothing else. Refreshes every few minutes
// and whenever the app switches activity.

import WidgetKit
import SwiftUI

struct DayEntry: TimelineEntry {
    let date: Date
    let log: DayLog
    let activities: [Activity]
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> DayEntry {
        DayEntry(date: Date(), log: Store.load(), activities: Store.activities())
    }

    func getSnapshot(in context: Context, completion: @escaping (DayEntry) -> Void) {
        completion(placeholder(in: context))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<DayEntry>) -> Void) {
        let now = Date()
        // One entry every 5 minutes for the next hour; the app also pokes
        // WidgetCenter whenever you switch, so this is only the slow path.
        let entries = (0..<12).map { i -> DayEntry in
            let t = Calendar.current.date(byAdding: .minute, value: i * 5, to: now) ?? now
            return DayEntry(date: t, log: Store.load(), activities: Store.activities())
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

struct ClawdDayWidgetView: View {
    var entry: DayEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        switch family {
        case .systemSmall:
            DialFace(log: entry.log, activities: entry.activities,
                     now: entry.date, compact: true)
                .padding(6)
        default:
            HStack(spacing: 14) {
                DialFace(log: entry.log, activities: entry.activities,
                         now: entry.date, compact: true)
                legend
            }
            .padding(10)
        }
    }

    private var legend: some View {
        let totals = entry.log.totals(now: entry.date)
        let top = entry.activities
            .compactMap { a in totals[a.id].map { (a, $0) } }
            .filter { $0.1 >= 60 }
            .sorted { $0.1 > $1.1 }
            .prefix(4)
        return VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(top), id: \.0.id) { a, secs in
                HStack(spacing: 6) {
                    Circle().fill(a.color).frame(width: 8, height: 8)
                    Text(a.name).font(.caption2)
                    Spacer(minLength: 0)
                    Text(hhmm(secs)).font(.caption2).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
    }
}

@main
struct ClawdDayWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "ClawdDayWidget", provider: Provider()) { entry in
            ClawdDayWidgetView(entry: entry)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("今天的圆盘")
        .description("一天 24 小时都花在哪了。")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}
