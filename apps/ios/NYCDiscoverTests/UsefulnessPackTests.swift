import MapKit
import XCTest
@testable import NYCDiscover

final class UsefulnessPackTests: XCTestCase {
    private let suiteName = "NYCDiscover.UsefulnessPackTests"

    override func tearDown() {
        UserDefaults(suiteName: suiteName)?.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testSavedItineraryStoreSavesLoadsAndDeduplicates() {
        let store = makeStore()
        let itinerary = makeSavedItinerary()

        store.save(itinerary)
        store.save(itinerary)

        let saved = store.load()
        XCTAssertEqual(saved, [itinerary])
        XCTAssertTrue(
            store.isSaved(
                response: itinerary.response,
                selectedPlanId: itinerary.selectedPlanId,
                originLabel: itinerary.originLabel
            )
        )
    }

    func testSavedItineraryStoreDeletesSavedPlan() {
        let store = makeStore()
        let itinerary = makeSavedItinerary()
        store.save(itinerary)

        let remaining = store.delete(id: itinerary.id)

        XCTAssertTrue(remaining.isEmpty)
        XCTAssertTrue(store.load().isEmpty)
    }

    func testSavedItineraryStoreFallsBackToEmptyOnCorruptedData() {
        let defaults = makeDefaults()
        defaults.set(Data("not-json".utf8), forKey: "saved")
        let store = SavedItineraryStore(defaults: defaults, key: "saved")

        XCTAssertEqual(store.load(), [])
    }

    func testShareFormatterIncludesPlanSummaryStopsAndWarnings() throws {
        let itinerary = makeSavedItinerary()
        let plan = try XCTUnwrap(itinerary.selectedPlan)

        let summary = ItineraryShareFormatter.summary(
            response: itinerary.response,
            plan: plan,
            form: itinerary.formSnapshot,
            originLabel: itinerary.originLabel
        )

        XCTAssertTrue(summary.contains("NYC Discover"))
        XCTAssertTrue(summary.contains("Origin: Upper West Side"))
        XCTAssertTrue(summary.contains("Plan: Trivia + Dessert"))
        XCTAssertTrue(summary.contains("Total: 2h 20m, $12-$25 per person, 2 stops"))
        XCTAssertTrue(summary.contains("1."))
        XCTAssertTrue(summary.contains("Neighborhood trivia table"))
        XCTAssertTrue(summary.contains("Demo data is shown because the local API is unavailable."))
        XCTAssertTrue(summary.contains("Travel mode: Walk"))
    }

    func testMapsDirectionsModeMatchesSupportedTransportModes() {
        XCTAssertEqual(MapsLauncher.directionsMode(for: .walk), MKLaunchOptionsDirectionsModeWalking)
        XCTAssertEqual(MapsLauncher.directionsMode(for: .bike), MKLaunchOptionsDirectionsModeWalking)
        XCTAssertEqual(MapsLauncher.directionsMode(for: .transit), MKLaunchOptionsDirectionsModeTransit)
    }

    private func makeStore() -> SavedItineraryStore {
        SavedItineraryStore(defaults: makeDefaults(), key: "saved")
    }

    private func makeDefaults(file: StaticString = #filePath, line: UInt = #line) -> UserDefaults {
        guard let defaults = UserDefaults(suiteName: suiteName) else {
            XCTFail("Could not create test UserDefaults suite.", file: file, line: line)
            return .standard
        }
        defaults.removePersistentDomain(forName: suiteName)
        return defaults
    }

    private func makeSavedItinerary() -> SavedItinerary {
        var form = DiscoveryForm()
        form.locationLabel = "Upper West Side"
        form.availableMinutes = 240
        form.budgetMax = 40
        form.transportMode = .walk
        let coordinates = Coordinates(latitude: 40.787, longitude: -73.9754)
        form.coordinates = coordinates

        let request = GenerateRequest(
            locationLabel: form.locationLabel,
            coordinates: coordinates,
            startAt: Date(timeIntervalSince1970: 1_735_000_000),
            availableMinutes: form.availableMinutes,
            budgetMin: 0,
            budgetMax: form.budgetMax,
            groupSize: form.groupSize,
            transportMode: form.transportMode,
            radiusMiles: form.radiusMiles,
            mood: form.mood,
            regenerationSeed: 0
        )

        let response = DemoData.buildResponse(for: request)
        return SavedItinerary(
            response: response,
            selectedPlanId: "plan-1",
            formSnapshot: form,
            originLabel: form.locationLabel,
            savedAt: Date(timeIntervalSince1970: 1_735_000_500)
        )
    }
}
