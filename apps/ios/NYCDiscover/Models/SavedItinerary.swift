import Foundation

struct SavedItinerary: Codable, Equatable, Identifiable {
    var id: String
    var response: GenerationResponse
    var selectedPlanId: String
    var formSnapshot: DiscoveryForm
    var originLabel: String
    var savedAt: Date

    init(
        response: GenerationResponse,
        selectedPlanId: String,
        formSnapshot: DiscoveryForm,
        originLabel: String,
        savedAt: Date = Date()
    ) {
        self.id = SavedItinerary.makeId(
            response: response,
            selectedPlanId: selectedPlanId,
            originLabel: originLabel
        )
        self.response = response
        self.selectedPlanId = selectedPlanId
        self.formSnapshot = formSnapshot
        self.originLabel = originLabel
        self.savedAt = savedAt
    }

    var selectedPlan: ItineraryPlan? {
        response.plans.first { $0.id == selectedPlanId } ?? response.plans.first
    }

    static func makeId(
        response: GenerationResponse,
        selectedPlanId: String,
        originLabel: String
    ) -> String {
        let generatedAtMilliseconds = Int((response.generatedAt.timeIntervalSince1970 * 1_000).rounded())
        return "\(selectedPlanId)-\(generatedAtMilliseconds)-\(originLabel.lowercased())"
    }
}
