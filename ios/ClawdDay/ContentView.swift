// One screen: the dial on top, the activity you are in right now, a grid to
// switch to something else, and today's breakdown underneath.

import SwiftUI
import WidgetKit

struct ContentView: View {
    @State private var log = Store.load()
    @State private var activities = Store.activities()
    @State private var now = Date()
    @State private var editing = false
    @State private var detail: Activity? = nil
    @State private var showSummary = false
    @State private var showPlaces = false
    @State private var splitting: Segment? = nil

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    private var totals: [(Activity, TimeInterval)] {
        let t = log.totals(now: now)
        return activities
            .compactMap { a in t[a.id].map { (a, $0) } }
            .filter { $0.1 >= 30 }
            .sorted { $0.1 > $1.1 }
    }

    private var accounted: TimeInterval {
        log.totals(now: now).values.reduce(0, +)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 22) {
                    DialFace(log: log, activities: activities, now: now)
                        .padding(.horizontal, 28)
                        .padding(.top, 8)

                    VStack(spacing: 3) {
                        Text("今天已记录 \(hhmm(accounted))")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                        // Say when a switch was not yours, so the dial is never
                        // silently wrong about why a block is there.
                        if let a = Store.lastAutoSwitch,
                           Date().timeIntervalSince(a.at) < 3600 {
                            Text("刚才\(a.reason)，自动切的")
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }

                    // A stretch this long is almost always a forgotten switch —
                    // most often falling asleep. Offer to cut it rather than
                    // guessing where the boundary was.
                    if let open = log.openSegment, open.duration(now: now) > 4 * 3600 {
                        Button { splitting = open } label: {
                            HStack {
                                Image(systemName: "scissors")
                                Text("这一段已经 \(hhmm(open.duration(now: now)))，中间换过吗？")
                                    .font(.footnote)
                                Spacer(minLength: 0)
                            }
                            .padding(12)
                            .background(Color.primary.opacity(0.06),
                                        in: RoundedRectangle(cornerRadius: 12))
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 20)
                    }

                    switcher

                    if !totals.isEmpty { breakdown }
                }
                .padding(.bottom, 40)
            }
            .navigationTitle("Myla 的一天")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showSummary = true } label: {
                        Image(systemName: "calendar")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button { showPlaces = true } label: {
                            Label("地点自动切换", systemImage: "mappin.and.ellipse")
                        }
                        Button { editing = true } label: {
                            Label("状态列表", systemImage: "slider.horizontal.3")
                        }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .sheet(isPresented: $editing) {
                ActivityEditor(activities: $activities) { reload() }
            }
            .sheet(item: $detail) { a in
                ActivityDetail(activity: a, now: now)
            }
            .sheet(isPresented: $showSummary) {
                SpanSummary(activities: activities, now: now)
            }
            .sheet(isPresented: $showPlaces) {
                PlacesView(activities: $activities) { reload() }
            }
            .sheet(item: $splitting) { seg in
                SplitSegment(segment: seg, activities: activities) { reload() }
            }
        }
        .onReceive(tick) { now = $0 }
        .onAppear {
            Store.rolloverIfNeeded()
            reload()
        }
    }

    // MARK: Pieces

    private var switcher: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("现在在做")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 20)

            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 10) {
                ForEach(activities) { a in
                    let on = log.openSegment?.activityID == a.id
                    Button {
                        // Switching is the only write: it closes the old segment
                        // and opens the new one at this instant.
                        Store.switchTo(a.id)
                        Nudge.reschedule()          // push the check-in back
                        reload()
                    } label: {
                        HStack(spacing: 8) {
                            Circle().fill(a.color).frame(width: 12, height: 12)
                            Text(a.name).font(.callout.weight(on ? .semibold : .regular))
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 11)
                        .padding(.horizontal, 12)
                        .background(on ? a.color.opacity(0.28) : Color.primary.opacity(0.06),
                                    in: RoundedRectangle(cornerRadius: 12))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(on ? a.color : .clear, lineWidth: 1.5))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private var breakdown: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("今天都花在哪了")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 20)

            ForEach(totals, id: \.0.id) { a, secs in
                Button { detail = a } label: {
                    HStack {
                        Circle().fill(a.color).frame(width: 10, height: 10)
                        Text(a.name)
                        Spacer()
                        Text(hhmm(secs)).foregroundStyle(.secondary).monospacedDigit()
                        Image(systemName: "chevron.right")
                            .font(.caption2).foregroundStyle(.tertiary)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 20)
                .padding(.vertical, 5)
            }
        }
    }

    private func reload() {
        log = Store.load()
        activities = Store.activities()
        WidgetCenter.shared.reloadAllTimelines()
    }
}

// MARK: - Editing the activity list

struct ActivityEditor: View {
    @Binding var activities: [Activity]
    var onDone: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var newName = ""

    private let palette = ["A0B1E3", "D1B3E6", "EEBC96", "A3DCC7", "F1E2A7", "A8D5E6", "C0DDA6", "F2C0D5", "E88794", "DBD2C7"]

    var body: some View {
        NavigationStack {
            List {
                Section("状态") {
                    ForEach($activities) { $a in
                        HStack {
                            Circle().fill(a.color).frame(width: 14, height: 14)
                            TextField("名字", text: $a.name)
                        }
                    }
                    .onDelete { activities.remove(atOffsets: $0) }
                    .onMove { activities.move(fromOffsets: $0, toOffset: $1) }
                }
                Section("加一个") {
                    HStack {
                        TextField("比如「实习」", text: $newName)
                        Button("加上") {
                            let n = newName.trimmingCharacters(in: .whitespaces)
                            guard !n.isEmpty else { return }
                            activities.append(Activity(id: UUID().uuidString, name: n,
                                                       hex: palette[activities.count % palette.count]))
                            newName = ""
                        }
                        .disabled(newName.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .navigationTitle("状态列表")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") {
                        Store.saveActivities(activities)
                        onDone()
                        dismiss()
                    }
                }
            }
        }
    }
}
