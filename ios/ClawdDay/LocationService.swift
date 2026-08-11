// Region monitoring. iOS relaunches the app in the background when you cross a
// boundary, so arriving somewhere switches the state whether or not the app was
// open — which is the whole point: no remembering, no back-filling.

import CoreLocation
import WidgetKit

final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    static let shared = LocationService()

    private let manager = CLLocationManager()
    @Published var status: CLAuthorizationStatus = .notDetermined
    @Published var here: CLLocationCoordinate2D?

    override init() {
        super.init()
        manager.delegate = self
        manager.allowsBackgroundLocationUpdates = false   // regions do not need it
        status = manager.authorizationStatus
    }

    /// "Always" is what makes arrivals work with the app closed; iOS asks for it
    /// in two steps and there is nothing we can do to skip the second one.
    func requestAuthorization() {
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        default: break
        }
    }

    func askForCurrentLocation() {
        manager.requestLocation()
    }

    /// Re-registers every place. Called after any edit and on launch.
    func syncRegions() {
        for r in manager.monitoredRegions { manager.stopMonitoring(for: r) }
        guard manager.authorizationStatus == .authorizedAlways else { return }
        for p in Store.places().prefix(Store.placeLimit) {
            manager.startMonitoring(for: p.region)
        }
    }

    // MARK: Delegate

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        status = m.authorizationStatus
        syncRegions()
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        here = locs.last?.coordinate
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {}

    func locationManager(_ m: CLLocationManager, didEnterRegion region: CLRegion) {
        guard let p = Store.places().first(where: { $0.id == region.identifier }) else { return }
        apply(p.onArrive, why: "到了「\(p.name)」")
    }

    func locationManager(_ m: CLLocationManager, didExitRegion region: CLRegion) {
        guard let p = Store.places().first(where: { $0.id == region.identifier }),
              !p.onLeave.isEmpty else { return }
        apply(p.onLeave, why: "离开「\(p.name)」")
    }

    private func apply(_ activityID: String, why: String) {
        guard Store.activity(activityID) != nil else { return }
        Store.rolloverIfNeeded()
        Store.switchTo(activityID)
        Store.noteAutoSwitch(why)
        WidgetCenter.shared.reloadAllTimelines()
        Nudge.reschedule()
    }
}
