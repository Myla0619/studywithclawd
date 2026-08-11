// The forgetting problem, handled by asking instead of hoping. If nothing has
// changed for a while, one notification turns up with the current state and
// buttons to confirm or correct it — no opening the app, no back-filling.
//
// Deliberately not a nag: it fires once per stretch, and confirming just
// silences it for another interval.

import UserNotifications
import WidgetKit

enum Nudge {
    static let categoryID = "CHECKIN"
    private static let intervalKey = "nudgeMinutes"

    static var minutes: Int {
        get {
            let m = Store.defaults.integer(forKey: intervalKey)
            return m > 0 ? m : 90
        }
        set { Store.defaults.set(newValue, forKey: intervalKey) }
    }

    static var enabled: Bool {
        get { Store.defaults.object(forKey: "nudgeOn") as? Bool ?? true }
        set { Store.defaults.set(newValue, forKey: "nudgeOn") }
    }

    static func requestPermission() {
        UNUserNotificationCenter.current()
            .requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Rebuilds the category so the buttons match whatever you actually use, then
    /// schedules the next check-in. Called on every switch, by hand or automatic.
    static func reschedule() {
        let center = UNUserNotificationCenter.current()
        center.removeAllPendingNotificationRequests()
        guard enabled else { return }

        let log = Store.load()
        guard let open = log.openSegment,
              let current = Store.activity(open.activityID) else { return }

        // Two most-used states today that are not the current one, as one-tap fixes.
        let totals = log.totals()
        let others = Store.activities()
            .filter { $0.id != current.id }
            .sorted { (totals[$0.id] ?? 0) > (totals[$1.id] ?? 0) }
            .prefix(2)

        var actions: [UNNotificationAction] = [
            UNNotificationAction(identifier: "still", title: "还在\(current.name)",
                                 options: [])
        ]
        actions += others.map {
            UNNotificationAction(identifier: "switch:\($0.id)", title: "改成\($0.name)",
                                 options: [])
        }
        center.setNotificationCategories([
            UNNotificationCategory(identifier: categoryID, actions: actions,
                                   intentIdentifiers: [], options: [])
        ])

        let body = UNMutableNotificationContent()
        body.title = "还在\(current.name)吗？"
        body.body = "已经 \(hhmm(open.duration()))。点一下确认或者改掉，圆盘就不会记错。"
        body.categoryIdentifier = categoryID
        body.sound = .default

        let when = UNTimeIntervalNotificationTrigger(
            timeInterval: TimeInterval(minutes * 60), repeats: false)
        center.add(UNNotificationRequest(identifier: "checkin", content: body, trigger: when))
    }
}

// MARK: - Handling the buttons

final class NudgeDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NudgeDelegate()

    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse) async {
        let id = response.actionIdentifier
        Store.rolloverIfNeeded()

        if id.hasPrefix("switch:") {
            let activity = String(id.dropFirst("switch:".count))
            Store.switchTo(activity)
            Store.noteAutoSwitch("从通知里改的")
            WidgetCenter.shared.reloadAllTimelines()
        }
        // "still" and a plain tap both just push the next check-in back.
        Nudge.reschedule()
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter,
                                willPresent n: UNNotification) async
        -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
