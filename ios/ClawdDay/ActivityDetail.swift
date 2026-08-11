// Tap a block on the dial or in the breakdown to open this: every stretch of
// that activity with real clock times, plus how it adds up over a week/month,
// plus — where Apple allows it — how much the phone was used during it.

import SwiftUI

struct ActivityDetail: View {
    let activity: Activity
    var now: Date = Date()

    @State private var span: Span = .week
    @Environment(\.dismiss) private var dismiss

    private var todaySegments: [Segment] {
        Store.load().segments
            .filter { $0.activityID == activity.id }
            .sorted { $0.start < $1.start }
    }

    private var slices: [DaySlice] { Summary.slices(days: span.days, now: now) }

    private var spanTotal: TimeInterval {
        Summary.totals(slices)[activity.id] ?? 0
    }

    private var dailyAverage: TimeInterval {
        let daysWithAny = slices.filter { ($0.totals[activity.id] ?? 0) > 0 }.count
        return daysWithAny == 0 ? 0 : spanTotal / Double(daysWithAny)
    }

    var body: some View {
        NavigationStack {
            List {
                Section("今天") {
                    if todaySegments.isEmpty {
                        Text("今天还没有").foregroundStyle(.secondary)
                    }
                    ForEach(todaySegments) { seg in
                        SegmentRow(seg: seg, color: activity.color, now: now)
                    }
                }

                Section {
                    Picker("范围", selection: $span) {
                        ForEach(Span.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    LabeledContent("总计", value: hhmm(spanTotal))
                    LabeledContent("有记录的天里平均", value: hhmm(dailyAverage))

                    SpanBars(slices: slices, activityID: activity.id, color: activity.color)
                        .frame(height: 92)
                        .padding(.vertical, 4)
                } header: {
                    Text("往前看")
                }

                Section {
                    ScreenTimeSlot(segments: todaySegments)
                } header: {
                    Text("这段时间手机在干嘛")
                } footer: {
                    Text("这块由系统渲染。Apple 不把用量数字交给 app，所以只能看，"
                         + "圆盘上算不进去。")
                }
            }
            .navigationTitle(activity.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }
}

private struct SegmentRow: View {
    let seg: Segment
    let color: Color
    let now: Date

    var body: some View {
        HStack(spacing: 12) {
            Capsule().fill(color).frame(width: 4, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text("\(clock(seg.start)) – \(seg.end.map(clock) ?? "现在")")
                    .monospacedDigit()
                if seg.end == nil {
                    Text("正在进行").font(.caption2).foregroundStyle(color)
                }
            }
            Spacer()
            Text(hhmm(seg.duration(now: now)))
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }
}

/// One bar per day; the filled part is this activity, the rest is everything else.
private struct SpanBars: View {
    let slices: [DaySlice]
    let activityID: String
    let color: Color

    var body: some View {
        GeometryReader { geo in
            let n = max(1, slices.count)
            let gap: CGFloat = slices.count > 10 ? 2 : 5
            let w = (geo.size.width - gap * CGFloat(n - 1)) / CGFloat(n)
            HStack(alignment: .bottom, spacing: gap) {
                ForEach(slices) { s in
                    let mine = s.totals[activityID] ?? 0
                    let frac = min(1, mine / (8 * 3600))     // 8 hours fills the bar
                    VStack(spacing: 3) {
                        RoundedRectangle(cornerRadius: 3)
                            .fill(mine > 0 ? color : Color.primary.opacity(0.08))
                            .frame(width: w, height: max(3, 74 * frac))
                        if slices.count <= 10 {
                            Text(String(s.id.suffix(2)))
                                .font(.system(size: 9))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
        }
    }
}
