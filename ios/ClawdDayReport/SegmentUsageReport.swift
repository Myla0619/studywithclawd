// The report extension. Everything here runs in Apple's sandbox: it can see the
// usage data and draw it, but nothing it computes can be handed back to the app.
// That is why "有效学习时长 = 学习 − 手机" cannot live on the dial.

import DeviceActivity
import SwiftUI

@main
struct ClawdDayReport: DeviceActivityReportExtension {
    var body: some DeviceActivityReportScene {
        SegmentUsageScene { summary in
            SegmentUsageView(summary: summary)
        }
    }
}

struct UsageSummary {
    var total: TimeInterval = 0
    var pickups: Int = 0
    var apps: [AppUse] = []
}

struct AppUse: Identifiable {
    var id: String { name }
    let name: String
    let seconds: TimeInterval
}

struct SegmentUsageScene: DeviceActivityReportScene {
    let context: DeviceActivityReport.Context = .init("SegmentUsage")
    let content: (UsageSummary) -> SegmentUsageView

    func makeConfiguration(
        representing data: DeviceActivityResults<DeviceActivityData>
    ) async -> UsageSummary {
        var out = UsageSummary()
        var byApp: [String: TimeInterval] = [:]

        for await d in data {
            for await seg in d.activitySegments {
                out.total += seg.totalActivityDuration
                for await cat in seg.categories {
                    for await app in cat.applications {
                        let name = app.application.localizedDisplayName ?? "其他"
                        byApp[name, default: 0] += app.totalActivityDuration
                        out.pickups += app.numberOfPickups
                    }
                }
            }
        }
        out.apps = byApp.sorted { $0.value > $1.value }
            .prefix(4)
            .map { AppUse(name: $0.key, seconds: $0.value) }
        return out
    }
}

struct SegmentUsageView: View {
    let summary: UsageSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if summary.total < 60 {
                Text("这段时间几乎没碰手机").font(.callout)
            } else {
                Text("手机用了 \(Int(summary.total) / 60) 分钟，拿起 \(summary.pickups) 次")
                    .font(.callout.weight(.medium))
                ForEach(summary.apps) { app in
                    HStack {
                        Text(app.name).font(.caption)
                        Spacer()
                        Text("\(Int(app.seconds) / 60) 分")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}
