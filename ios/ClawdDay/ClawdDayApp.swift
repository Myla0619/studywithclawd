import SwiftUI
import UserNotifications

@main
struct ClawdDayApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = NudgeDelegate.shared
        Store.rolloverIfNeeded()
        LocationService.shared.syncRegions()
        Nudge.reschedule()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}
