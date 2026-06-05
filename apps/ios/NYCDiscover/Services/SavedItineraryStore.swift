import Foundation

struct SavedItineraryStore {
    private let defaults: UserDefaults
    private let key: String

    init(
        defaults: UserDefaults = .standard,
        key: String = "nycDiscover.savedItineraries"
    ) {
        self.defaults = defaults
        self.key = key
    }

    func load() -> [SavedItinerary] {
        guard let data = defaults.data(forKey: key) else {
            return []
        }
        do {
            return try DateCoding.makeDecoder().decode([SavedItinerary].self, from: data)
        } catch {
            return []
        }
    }

    @discardableResult
    func save(_ itinerary: SavedItinerary) -> [SavedItinerary] {
        var saved = load().filter { $0.id != itinerary.id }
        saved.insert(itinerary, at: 0)
        persist(saved)
        return saved
    }

    @discardableResult
    func delete(id: SavedItinerary.ID) -> [SavedItinerary] {
        let saved = load().filter { $0.id != id }
        persist(saved)
        return saved
    }

    func isSaved(response: GenerationResponse, selectedPlanId: String, originLabel: String) -> Bool {
        let id = SavedItinerary.makeId(
            response: response,
            selectedPlanId: selectedPlanId,
            originLabel: originLabel
        )
        return load().contains { $0.id == id }
    }

    private func persist(_ saved: [SavedItinerary]) {
        guard let data = try? DateCoding.makeEncoder().encode(saved) else {
            return
        }
        defaults.set(data, forKey: key)
    }
}
