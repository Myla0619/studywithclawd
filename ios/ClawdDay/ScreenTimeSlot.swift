// Apple renders app usage inside its own sandboxed extension; the numbers never
// reach our code. So this is a window onto a report, one per stretch of the
// activity, not data we can add up.
//
// Needs the Family Controls entitlement and the user's permission. Without
// either, it says so instead of failing.

import SwiftUI
#if canImport(DeviceActivity)
import DeviceActivity
import FamilyControls
#endif

struct ScreenTimeSlot: View {
    let segments: [Segment]
    @State private var authorized = false
    @State private var asked = false

    var body: some View {
        #if canImport(DeviceActivity)
        if authorized {
            if segments.isEmpty {
                Text("这个状态今天还没有时段").foregroundStyle(.secondary)
            } else {
                ForEach(segments) { seg in
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(clock(seg.start)) – \(seg.end.map(clock) ?? "现在")")
                            .font(.caption).foregroundStyle(.secondary).monospacedDigit()
                        DeviceActivityReport(
                            .init("SegmentUsage"),
                            filter: DeviceActivityFilter(
                                segment: .daily(during: DateInterval(
                                    start: seg.start, end: seg.end ?? Date())),
                                users: .all,
                                devices: .init([.iPhone])))
                            .frame(height: 108)
                    }
                    .padding(.vertical, 4)
                }
            }
        } else {
            Button(asked ? "再试一次" : "打开屏幕使用时间") {
                Task {
                    do {
                        try await AuthorizationCenter.shared
                            .requestAuthorization(for: .individual)
                        authorized = true
                    } catch {
                        asked = true
                    }
                }
            }
            .task {
                authorized = AuthorizationCenter.shared.authorizationStatus == .approved
            }
        }
        #else
        Text("这台设备上没有屏幕使用时间接口").foregroundStyle(.secondary)
        #endif
    }
}
