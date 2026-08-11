// Managing places. Adding one uses wherever you are standing, because typing an
// address is exactly the kind of friction that stops this getting set up at all.

import SwiftUI
import MapKit
import CoreLocation

struct PlacesView: View {
    @Binding var activities: [Activity]
    var onChange: () -> Void

    @State private var places = Store.places()
    @State private var adding = false
    @StateObject private var loc = LocationService.shared
    @Environment(\.dismiss) private var dismiss

    private var needsAlways: Bool { loc.status != .authorizedAlways }

    var body: some View {
        NavigationStack {
            List {
                if needsAlways {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("要「始终」允许定位")
                                .font(.subheadline.weight(.semibold))
                            Text("只有始终允许，app 没打开的时候到了地方才会自动切。"
                                 + "iOS 会分两步问，第二步要你手动选「始终允许」。")
                                .font(.caption).foregroundStyle(.secondary)
                            Button("去授权") { loc.requestAuthorization() }
                                .buttonStyle(.borderedProminent)
                        }
                        .padding(.vertical, 4)
                    }
                }

                Section {
                    ForEach($places) { $p in
                        PlaceRow(place: $p, activities: activities)
                    }
                    .onDelete { idx in
                        places.remove(atOffsets: idx)
                        persist()
                    }
                    if places.isEmpty {
                        Text("还没有地点").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("地点（最多 \(Store.placeLimit) 个）")
                } footer: {
                    Text("到了自动切成设定的状态，离开可以切成另一个。"
                         + "半径小于 100 米容易漏触发，iOS 的围栏精度就这样。")
                }

                Section {
                    Button {
                        loc.askForCurrentLocation()
                        adding = true
                    } label: {
                        Label("用当前位置加一个", systemImage: "plus.circle")
                    }
                    .disabled(places.count >= Store.placeLimit)
                }
            }
            .navigationTitle("地点自动切换")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) {
                    Button("完成") { persist(); dismiss() }
                }
            }
            .sheet(isPresented: $adding) {
                AddPlace(activities: activities, here: loc.here) { p in
                    places.append(p)
                    persist()
                }
            }
            .onAppear { loc.requestAuthorization() }
        }
    }

    private func persist() {
        Store.savePlaces(places)
        LocationService.shared.syncRegions()
        onChange()
    }
}

private struct PlaceRow: View {
    @Binding var place: Place
    let activities: [Activity]

    var body: some View {
        DisclosureGroup {
            Picker("到了切成", selection: $place.onArrive) {
                ForEach(activities) { Text($0.name).tag($0.id) }
            }
            Picker("离开切成", selection: $place.onLeave) {
                Text("不变").tag("")
                ForEach(activities) { Text($0.name).tag($0.id) }
            }
            VStack(alignment: .leading) {
                Text("半径 \(Int(place.radius)) 米").font(.caption)
                Slider(value: $place.radius, in: 80...500, step: 20)
            }
        } label: {
            HStack {
                Image(systemName: "mappin.circle.fill")
                    .foregroundStyle(activities.first { $0.id == place.onArrive }?.color ?? .gray)
                TextField("名字", text: $place.name)
            }
        }
    }
}

private struct AddPlace: View {
    let activities: [Activity]
    let here: CLLocationCoordinate2D?
    var onAdd: (Place) -> Void

    @State private var name = ""
    @State private var activity = ""
    @State private var radius: Double = 120
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                if let c = here {
                    Section {
                        Map(initialPosition: .region(MKCoordinateRegion(
                            center: c,
                            latitudinalMeters: radius * 6, longitudinalMeters: radius * 6)))
                            .frame(height: 160)
                            .allowsHitTesting(false)
                            .listRowInsets(EdgeInsets())
                    }
                } else {
                    Section { Text("正在定位…").foregroundStyle(.secondary) }
                }
                Section {
                    TextField("名字，比如「实验室」", text: $name)
                    Picker("到了切成", selection: $activity) {
                        Text("选一个").tag("")
                        ForEach(activities) { Text($0.name).tag($0.id) }
                    }
                    VStack(alignment: .leading) {
                        Text("半径 \(Int(radius)) 米").font(.caption)
                        Slider(value: $radius, in: 80...500, step: 20)
                    }
                }
            }
            .navigationTitle("加个地点")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("加上") {
                        guard let c = here, !activity.isEmpty else { return }
                        onAdd(Place(name: name.isEmpty ? "新地点" : name,
                                    lat: c.latitude, lon: c.longitude,
                                    radius: radius, onArrive: activity))
                        dismiss()
                    }
                    .disabled(here == nil || activity.isEmpty)
                }
            }
        }
    }
}
