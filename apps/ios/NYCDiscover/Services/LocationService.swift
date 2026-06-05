import CoreLocation
import Foundation

@MainActor
final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published private(set) var authorizationStatus: CLAuthorizationStatus

    private let manager: CLLocationManager
    private var continuation: CheckedContinuation<Coordinates, Error>?

    override init() {
        let manager = CLLocationManager()
        self.manager = manager
        self.authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestCurrentLocation() async throws -> Coordinates {
        guard continuation == nil else {
            throw LocationServiceError.requestInProgress
        }

        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            switch manager.authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                manager.requestLocation()
            case .notDetermined:
                manager.requestWhenInUseAuthorization()
            case .denied, .restricted:
                finish(with: .failure(LocationServiceError.permissionDenied))
            @unknown default:
                finish(with: .failure(LocationServiceError.permissionDenied))
            }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            authorizationStatus = manager.authorizationStatus
            guard continuation != nil else {
                return
            }
            switch manager.authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                manager.requestLocation()
            case .denied, .restricted:
                finish(with: .failure(LocationServiceError.permissionDenied))
            case .notDetermined:
                break
            @unknown default:
                finish(with: .failure(LocationServiceError.permissionDenied))
            }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else {
            Task { @MainActor in
                finish(with: .failure(LocationServiceError.unavailable))
            }
            return
        }
        let coordinates = Coordinates(
            latitude: location.coordinate.latitude,
            longitude: location.coordinate.longitude
        )
        Task { @MainActor in
            finish(with: .success(coordinates))
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        Task { @MainActor in
            finish(with: .failure(error))
        }
    }

    private func finish(with result: Result<Coordinates, Error>) {
        guard let continuation else {
            return
        }
        self.continuation = nil
        continuation.resume(with: result)
    }

    static func isInsideNYC(_ coordinates: Coordinates) -> Bool {
        coordinates.latitude >= 40.4774 &&
            coordinates.latitude <= 40.9176 &&
            coordinates.longitude >= -74.2591 &&
            coordinates.longitude <= -73.7002
    }
}

enum LocationServiceError: LocalizedError {
    case permissionDenied
    case requestInProgress
    case unavailable

    var errorDescription: String? {
        switch self {
        case .permissionDenied:
            return "Location permission was not granted."
        case .requestInProgress:
            return "A location request is already in progress."
        case .unavailable:
            return "Current location is unavailable."
        }
    }
}
