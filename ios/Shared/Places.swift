// Places you go, and what being there means. Arriving switches the state for
// you, so the common case — going to the lab, coming home — needs no tapping.

import Foundation
import CoreLocation

struct Place: Codable, Identifiable, Hashable {
    var id: String = UUID().uuidString
    var name: String
    var lat: Double
    var lon: Double
    var radius: Double = 120            // metres
    /// Switch to this when you arrive.
    var onArrive: String
    /// Switch to this when you leave. Empty means leave the state alone.
    var onLeave: String = ""

    var center: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lon)
    }

    var region: CLCircularRegion {
        // iOS clamps the radius to the device maximum on its own.
        let r = CLCircularRegion(center: center, radius: radius, identifier: id)
        r.notifyOnEntry = true
        r.notifyOnExit = !onLeave.isEmpty
        return r
    }
}

extension Store {
    private static let placesKey = "places"

    /// iOS will not monitor more than 20 regions for one app.
    static let placeLimit = 20

    static func places() -> [Place] {
        guard let d = defaults.data(forKey: placesKey),
              let p = try? JSONDecoder().decode([Place].self, from: d) else { return [] }
        return p
    }

    static func savePlaces(_ p: [Place]) {
        if let d = try? JSONEncoder().encode(p) { defaults.set(d, forKey: placesKey) }
    }

    /// Remembered so the log can say why a segment appeared.
    static func noteAutoSwitch(_ reason: String) {
        defaults.set(reason, forKey: "lastAutoReason")
        defaults.set(Date(), forKey: "lastAutoAt")
    }

    static var lastAutoSwitch: (reason: String, at: Date)? {
        guard let r = defaults.string(forKey: "lastAutoReason"),
              let d = defaults.object(forKey: "lastAutoAt") as? Date else { return nil }
        return (r, d)
    }
}
