// The whole dial, rolled up. One stacked bar per day plus the totals, so a week
// or a month reads at a glance without any per-activity digging.

import SwiftUI

struct SpanSummary: View {
    let activities: [Activity]
    var now: Date = Date()

    @State private var span: Span = .week
    @Environment(\.dismiss) private var dismiss

    private var slices: [DaySlice] { Summary.slices(days: span.days, now: now) }
    private var totals: [(Activity, TimeInterval)] {
        let t = Summary.totals(slices)
        return activities
            .compactMap { a in t[a.id].map { (a, $0) } }
            .filter { $0.1 >= 60 }
            .sorted { $0.1 > $1.1 }
    }
    private var recorded: TimeInterval { slices.reduce(0) { $0 + $1.total } }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Picker("范围", selection: $span) {
                        ForEach(Span.allCases) { Text($0.rawValue).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    StackedDays(slices: slices, activities: activities)
                        .frame(height: 130)
                        .padding(.vertical, 6)

                    LabeledContent("有记录的天数", value: "\(slices.count) 天")
                    LabeledContent("记录到的时间", value: hhmm(recorded))
                }

                Section("加起来都花在哪了") {
                    ForEach(totals, id: \.0.id) { a, secs in
                        HStack {
                            Circle().fill(a.color).frame(width: 10, height: 10)
                            Text(a.name)
                            Spacer()
                            Text(hhmm(secs)).foregroundStyle(.secondary).monospacedDigit()
                        }
                    }
                    if totals.isEmpty {
                        Text("这个范围里还没有记录").foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("往回看")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { dismiss() }
                }
            }
        }
    }
}

/// One column per day, stacked in the order the activities are listed.
private struct StackedDays: View {
    let slices: [DaySlice]
    let activities: [Activity]

    var body: some View {
        GeometryReader { geo in
            let n = max(1, slices.count)
            let gap: CGFloat = slices.count > 10 ? 2 : 6
            let w = (geo.size.width - gap * CGFloat(n - 1)) / CGFloat(n)
            let barH = geo.size.height - 16

            HStack(alignment: .bottom, spacing: gap) {
                ForEach(slices) { s in
                    VStack(spacing: 3) {
                        VStack(spacing: 0) {
                            ForEach(activities) { a in
                                let secs = s.totals[a.id] ?? 0
                                if secs > 0 {
                                    Rectangle()
                                        .fill(a.color)
                                        .frame(height: barH * CGFloat(secs / 86_400))
                                }
                            }
                        }
                        .frame(width: w)
                        .clipShape(RoundedRectangle(cornerRadius: 3))

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
