import Foundation

enum StartMode: String, Codable, CaseIterable, Identifiable {
    case now
    case later

    var id: String { rawValue }

    var label: String {
        switch self {
        case .now: "Now"
        case .later: "Later today"
        }
    }
}

struct DiscoveryForm: Codable, Equatable {
    var locationLabel = ""
    var coordinates: Coordinates?
    var startMode: StartMode = .now
    var laterTime = DiscoveryForm.defaultLaterTime
    var availableMinutes = 240
    var budgetMax = 40
    var groupSize = 2
    var transportMode: TransportMode = .walk
    var radiusMiles = 2
    var mood: Mood = .social

    static var defaultLaterTime: Date {
        let calendar = Calendar.current
        let now = Date()
        var components = calendar.dateComponents([.year, .month, .day], from: now)
        components.hour = 19
        components.minute = 0
        return calendar.date(from: components) ?? now
    }

    func validate() -> [String] {
        var errors: [String] = []
        if locationLabel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || coordinates == nil {
            errors.append("Choose a starting location.")
        }
        if availableMinutes < 60 {
            errors.append("Set aside at least one hour.")
        }
        if budgetMax < 0 {
            errors.append("Budget cannot be negative.")
        }
        if groupSize < 1 {
            errors.append("Group size must be at least one.")
        }
        return errors
    }

    func makeRequest(regenerationSeed: Int) throws -> GenerateRequest {
        guard let coordinates else {
            throw DiscoveryFormError.missingLocation
        }

        return GenerateRequest(
            locationLabel: locationLabel,
            coordinates: coordinates,
            startAt: startDate,
            availableMinutes: availableMinutes,
            budgetMin: 0,
            budgetMax: budgetMax,
            groupSize: groupSize,
            transportMode: transportMode,
            radiusMiles: radiusMiles,
            mood: mood,
            regenerationSeed: regenerationSeed
        )
    }

    private var startDate: Date {
        switch startMode {
        case .now:
            return Date()
        case .later:
            let calendar = Calendar.current
            let timeComponents = calendar.dateComponents([.hour, .minute], from: laterTime)
            var todayComponents = calendar.dateComponents([.year, .month, .day], from: Date())
            todayComponents.hour = timeComponents.hour
            todayComponents.minute = timeComponents.minute
            todayComponents.second = 0
            return calendar.date(from: todayComponents) ?? Date()
        }
    }
}

enum DiscoveryFormError: LocalizedError {
    case missingLocation

    var errorDescription: String? {
        switch self {
        case .missingLocation:
            return "A starting location is required."
        }
    }
}
