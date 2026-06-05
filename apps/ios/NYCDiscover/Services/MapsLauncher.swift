import MapKit

enum MapsLauncher {
    static func open(step: TimelineStep, transportMode: TransportMode) {
        let placemark = MKPlacemark(coordinate: step.coordinates.locationCoordinate)
        let mapItem = MKMapItem(placemark: placemark)
        mapItem.name = step.name
        mapItem.openInMaps(launchOptions: launchOptions(for: transportMode))
    }

    static func launchOptions(for transportMode: TransportMode) -> [String: Any] {
        [MKLaunchOptionsDirectionsModeKey: directionsMode(for: transportMode)]
    }

    static func directionsMode(for transportMode: TransportMode) -> String {
        switch transportMode {
        case .walk:
            return MKLaunchOptionsDirectionsModeWalking
        case .bike:
            return MKLaunchOptionsDirectionsModeWalking
        case .transit:
            return MKLaunchOptionsDirectionsModeTransit
        }
    }
}
