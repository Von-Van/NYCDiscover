import Foundation

enum DemoData {
    static func buildResponse(for request: GenerateRequest) -> GenerationResponse {
        let origin = request.locationLabel
        let socialSteps = [
            step(
                request: request,
                id: "demo-trivia",
                name: "Neighborhood trivia table",
                category: "trivia",
                offset: 20,
                duration: 80,
                cost: (8, 16),
                latitude: 40.7872,
                longitude: -73.9755,
                fromLabel: origin,
                travelMinutes: 8
            ),
            step(
                request: request,
                id: "demo-dessert",
                name: "Late-night cookie stop",
                category: "dessert",
                offset: 115,
                duration: 25,
                cost: (4, 9),
                latitude: 40.7858,
                longitude: -73.9721,
                fromLabel: "Neighborhood trivia table",
                travelMinutes: 7
            ),
        ]
        let culturalSteps = [
            step(
                request: request,
                id: "demo-roerich",
                name: "Nicholas Roerich Museum",
                category: "museum",
                offset: 15,
                duration: 60,
                cost: (0, 0),
                latitude: 40.8029,
                longitude: -73.9683,
                fromLabel: origin,
                travelMinutes: 13
            ),
            step(
                request: request,
                id: "demo-noodles",
                name: "Hand-pulled noodles and dumplings",
                category: "restaurant",
                offset: 92,
                duration: 55,
                cost: (14, 24),
                latitude: 40.7992,
                longitude: -73.9671,
                fromLabel: "Nicholas Roerich Museum",
                travelMinutes: 7
            ),
        ]
        let nightSteps = [
            step(
                request: request,
                id: "demo-bookstore",
                name: "Book Culture browse",
                category: "bookstore",
                offset: 15,
                duration: 42,
                cost: (0, 12),
                latitude: 40.8063,
                longitude: -73.9652,
                fromLabel: origin,
                travelMinutes: 15
            ),
            step(
                request: request,
                id: "demo-comedy",
                name: "Basement stand-up showcase",
                category: "comedy",
                offset: 82,
                duration: 75,
                cost: (12, 20),
                latitude: 40.7835,
                longitude: -73.9794,
                fromLabel: "Book Culture browse",
                travelMinutes: 22
            ),
        ]

        let plans = [
            plan(request: request, id: "plan-1", title: "Trivia + Dessert", subtitle: "Easy company", steps: socialSteps),
            plan(request: request, id: "plan-2", title: "Museum + Food", subtitle: "A cultured detour", steps: culturalSteps),
            plan(request: request, id: "plan-3", title: "Bookstore + Comedy", subtitle: "A little plot twist", steps: nightSteps),
        ].filter { plan in
            plan.totalMinutes <= request.availableMinutes && plan.totalCostHigh <= request.budgetMax
        }

        return GenerationResponse(
            weather: WeatherSummary(
                summary: "Partly sunny, comfortable later",
                temperatureF: 72,
                precipitationProbability: 12,
                isWet: false,
                isSevere: false,
                sourceName: "Fixture weather"
            ),
            plans: plans,
            warnings: ["Demo data is shown because the local API is unavailable."],
            generatedAt: Date()
        )
    }

    private static func step(
        request: GenerateRequest,
        id: String,
        name: String,
        category: String,
        offset: Int,
        duration: Int,
        cost: (Int, Int),
        latitude: Double,
        longitude: Double,
        fromLabel: String,
        travelMinutes: Int
    ) -> TimelineStep {
        let startAt = request.startAt.addingTimeInterval(TimeInterval(offset * 60))
        let endAt = request.startAt.addingTimeInterval(TimeInterval((offset + duration) * 60))
        return TimelineStep(
            candidateId: id,
            name: name,
            category: category,
            startAt: startAt,
            endAt: endAt,
            coordinates: Coordinates(latitude: latitude, longitude: longitude),
            costLow: cost.0,
            costHigh: cost.1,
            confidence: 0.78,
            sourceName: "Fixture place",
            sourceUrl: nil,
            estimateNotes: ["Cost and duration are category-based estimates."],
            travelBefore: TravelLeg(
                mode: request.transportMode.rawValue,
                minutes: travelMinutes,
                distanceMiles: max(0.2, Double(travelMinutes) / 20),
                fromLabel: fromLabel,
                toLabel: name,
                estimateNote: "Mode-aware estimate; verify before leaving."
            )
        )
    }

    private static func plan(
        request: GenerateRequest,
        id: String,
        title: String,
        subtitle: String,
        steps: [TimelineStep]
    ) -> ItineraryPlan {
        let endAt = steps.last?.endAt ?? request.startAt
        let totalMinutes = Int(endAt.timeIntervalSince(request.startAt) / 60)
        let totalCostLow = steps.reduce(0) { $0 + $1.costLow }
        let totalCostHigh = steps.reduce(0) { $0 + $1.costHigh }
        let confidence = steps.isEmpty ? 0 : steps.reduce(0) { $0 + $1.confidence } / Double(steps.count)

        return ItineraryPlan(
            id: id,
            title: title,
            subtitle: subtitle,
            score: 0.82,
            confidence: confidence,
            totalMinutes: totalMinutes,
            totalCostLow: totalCostLow,
            totalCostHigh: totalCostHigh,
            steps: steps,
            estimateNotes: [
                "Costs are estimated per person.",
                "Travel times are mode-aware estimates, not turn-by-turn routes.",
            ]
        )
    }
}
