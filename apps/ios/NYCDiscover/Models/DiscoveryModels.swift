import CoreLocation
import Foundation

enum Mood: String, Codable, CaseIterable, Identifiable {
    case social
    case relaxing
    case outdoors
    case dateNight = "date-night"
    case productive
    case chaotic
    case lowEnergy = "low-energy"
    case cultural
    case foodFocused = "food-focused"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .social: "Social"
        case .relaxing: "Relaxing"
        case .outdoors: "Outdoors"
        case .dateNight: "Date night"
        case .productive: "Productive"
        case .chaotic: "Chaotic"
        case .lowEnergy: "Low energy"
        case .cultural: "Cultural"
        case .foodFocused: "Food-focused"
        }
    }

    var mark: String {
        switch self {
        case .social: "S"
        case .relaxing: "R"
        case .outdoors: "O"
        case .dateNight: "D"
        case .productive: "P"
        case .chaotic: "!"
        case .lowEnergy: "L"
        case .cultural: "C"
        case .foodFocused: "F"
        }
    }
}

enum TransportMode: String, Codable, CaseIterable, Identifiable {
    case walk
    case bike
    case transit

    var id: String { rawValue }

    var label: String {
        switch self {
        case .walk: "Walk"
        case .bike: "Bike"
        case .transit: "Transit"
        }
    }

    var mark: String {
        switch self {
        case .walk: "figure.walk"
        case .bike: "bicycle"
        case .transit: "tram.fill"
        }
    }
}

struct Coordinates: Codable, Hashable {
    var latitude: Double
    var longitude: Double

    var locationCoordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
}

struct GenerateRequest: Codable, Equatable {
    var locationLabel: String
    var coordinates: Coordinates
    var startAt: Date
    var availableMinutes: Int
    var budgetMin: Int
    var budgetMax: Int
    var groupSize: Int
    var transportMode: TransportMode
    var radiusMiles: Int
    var mood: Mood
    var regenerationSeed: Int
}

struct TravelLeg: Codable, Equatable {
    var mode: String
    var minutes: Int
    var distanceMiles: Double
    var fromLabel: String
    var toLabel: String
    var estimateNote: String
}

struct TimelineStep: Codable, Equatable, Identifiable {
    var candidateId: String
    var name: String
    var category: String
    var startAt: Date
    var endAt: Date
    var coordinates: Coordinates
    var costLow: Int
    var costHigh: Int
    var confidence: Double
    var sourceName: String
    var sourceUrl: String?
    var estimateNotes: [String]
    var travelBefore: TravelLeg

    var id: String { candidateId }
}

struct ItineraryPlan: Codable, Equatable, Identifiable {
    var id: String
    var title: String
    var subtitle: String
    var score: Double
    var confidence: Double
    var totalMinutes: Int
    var totalCostLow: Int
    var totalCostHigh: Int
    var steps: [TimelineStep]
    var estimateNotes: [String]
}

struct WeatherSummary: Codable, Equatable {
    var summary: String
    var temperatureF: Int?
    var precipitationProbability: Int
    var isWet: Bool
    var isSevere: Bool
    var sourceName: String
}

struct GenerationResponse: Codable, Equatable {
    var weather: WeatherSummary
    var plans: [ItineraryPlan]
    var warnings: [String]
    var generatedAt: Date
}

struct GeocodeResult: Codable, Equatable, Identifiable {
    var label: String
    var latitude: Double
    var longitude: Double

    var id: String { "\(label)-\(latitude)-\(longitude)" }

    var coordinates: Coordinates {
        Coordinates(latitude: latitude, longitude: longitude)
    }
}

struct GeocodeResponse: Codable, Equatable {
    var results: [GeocodeResult]
    var warnings: [String]
}

func durationLabel(_ minutes: Int) -> String {
    let hours = minutes / 60
    let remainder = minutes % 60
    if hours == 0 {
        return "\(remainder)m"
    }
    if remainder == 0 {
        return "\(hours)h"
    }
    return "\(hours)h \(remainder)m"
}

func confidenceLabel(_ confidence: Double) -> String {
    if confidence >= 0.82 {
        return "High confidence"
    }
    if confidence >= 0.66 {
        return "Good confidence"
    }
    return "Worth verifying"
}
