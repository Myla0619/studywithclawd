// Fixing a forgotten switch after the fact — you say where the boundary was, so
// nothing here is invented. The common case is sleep: the evening state ran all
// night because there was nobody awake to change it.

import SwiftUI
import WidgetKit

struct SplitSegment: View {
    let segment: Segment
    let activities: [Activity]
    var onDone: () -> Void

    @State private var at: Date
    @State private var later: String = ""
    @Environment(\.dismiss) private var dismiss

    init(segment: Segment, activities: [Activity], onDone: @escaping () -> Void) {
        self.segment = segment
        self.activities = activities
        self.onDone = onDone
        // Default to the middle, which is usually near enough to nudge.
        let end = segment.end ?? Date()
        _at = State(initialValue: segment.start.addingTimeInterval(
            end.timeIntervalSince(segment.start) / 2))
    }

    private var upper: Date { segment.end ?? Date() }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("这一段",
                                   value: "\(clock(segment.start)) – \(segment.end.map(clock) ?? "现在")")
                    DatePicker("从几点起换的", selection: $at,
                               in: segment.start...upper,
                               displayedComponents: [.hourAndMinute])
                    Picker("后半段是", selection: $later) {
                        Text("选一个").tag("")
                        ForEach(activities) { Text($0.name).tag($0.id) }
                    }
                } footer: {
                    Text("前半段保持原样，后半段改成你选的。夜里那一大段通常就是这么修。")
                }
            }
            .navigationTitle("拆开这一段")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("拆开") {
                        Store.split(segment.id, at: at, laterBecomes: later)
                        WidgetCenter.shared.reloadAllTimelines()
                        onDone()
                        dismiss()
                    }
                    .disabled(later.isEmpty)
                }
            }
        }
    }
}
