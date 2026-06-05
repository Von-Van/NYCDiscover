import MapKit
import SwiftUI

struct ItineraryMapView: View {
    let plan: ItineraryPlan
    @State private var position: MapCameraPosition = .automatic

    private var routeCoordinates: [CLLocationCoordinate2D] {
        plan.steps.map { $0.coordinates.locationCoordinate }
    }

    var body: some View {
        Map(position: $position) {
            if routeCoordinates.count > 1 {
                MapPolyline(coordinates: routeCoordinates)
                    .stroke(AppColor.accent, lineWidth: 4)
            }
            ForEach(Array(plan.steps.enumerated()), id: \.element.id) { index, step in
                Annotation(step.name, coordinate: step.coordinates.locationCoordinate) {
                    Text("\(index + 1)")
                        .font(.caption.weight(.black))
                        .foregroundStyle(AppColor.paper)
                        .frame(width: 30, height: 30)
                        .background(AppColor.ink)
                        .clipShape(Circle())
                        .shadow(radius: 3)
                }
            }
        }
        .mapStyle(.standard(elevation: .flat, pointsOfInterest: .including([.cafe, .museum, .restaurant])))
        .onAppear {
            position = .region(plan.mapRegion)
        }
        .onChange(of: plan.id) {
            position = .region(plan.mapRegion)
        }
    }
}

private extension ItineraryPlan {
    var mapRegion: MKCoordinateRegion {
        let coordinates = steps.map(\.coordinates)
        guard let first = coordinates.first else {
            return MKCoordinateRegion(
                center: CLLocationCoordinate2D(latitude: 40.7128, longitude: -74.0060),
                span: MKCoordinateSpan(latitudeDelta: 0.08, longitudeDelta: 0.08)
            )
        }

        let minLatitude = coordinates.map(\.latitude).min() ?? first.latitude
        let maxLatitude = coordinates.map(\.latitude).max() ?? first.latitude
        let minLongitude = coordinates.map(\.longitude).min() ?? first.longitude
        let maxLongitude = coordinates.map(\.longitude).max() ?? first.longitude
        let latitudeDelta = max(0.02, (maxLatitude - minLatitude) * 1.8)
        let longitudeDelta = max(0.02, (maxLongitude - minLongitude) * 1.8)

        return MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: (minLatitude + maxLatitude) / 2,
                longitude: (minLongitude + maxLongitude) / 2
            ),
            span: MKCoordinateSpan(latitudeDelta: latitudeDelta, longitudeDelta: longitudeDelta)
        )
    }
}
