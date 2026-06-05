import XCTest
@testable import NYCDiscover

final class DiscoveryFormTests: XCTestCase {
    func testValidationRequiresAResolvedLocation() {
        var form = DiscoveryForm()
        form.locationLabel = "Upper West Side"

        XCTAssertEqual(form.validate(), ["Choose a starting location."])
    }

    func testGenerateRequestMatchesBackendContract() throws {
        var form = DiscoveryForm()
        form.locationLabel = "Upper West Side"
        form.coordinates = Coordinates(latitude: 40.787, longitude: -73.9754)
        form.availableMinutes = 180
        form.budgetMax = 55
        form.groupSize = 3
        form.transportMode = .transit
        form.radiusMiles = 3
        form.mood = .cultural

        let request = try form.makeRequest(regenerationSeed: 7)

        XCTAssertEqual(request.locationLabel, "Upper West Side")
        XCTAssertEqual(request.coordinates.latitude, 40.787)
        XCTAssertEqual(request.availableMinutes, 180)
        XCTAssertEqual(request.budgetMin, 0)
        XCTAssertEqual(request.budgetMax, 55)
        XCTAssertEqual(request.groupSize, 3)
        XCTAssertEqual(request.transportMode, .transit)
        XCTAssertEqual(request.radiusMiles, 3)
        XCTAssertEqual(request.mood, .cultural)
        XCTAssertEqual(request.regenerationSeed, 7)
    }

    func testDemoFallbackFiltersByBudgetAndDuration() throws {
        let request = GenerateRequest(
            locationLabel: "Upper West Side",
            coordinates: Coordinates(latitude: 40.787, longitude: -73.9754),
            startAt: Date(timeIntervalSince1970: 1_735_000_000),
            availableMinutes: 90,
            budgetMin: 0,
            budgetMax: 10,
            groupSize: 2,
            transportMode: .walk,
            radiusMiles: 2,
            mood: .social,
            regenerationSeed: 0
        )

        let response = DemoData.buildResponse(for: request)

        XCTAssertTrue(response.plans.allSatisfy { $0.totalMinutes <= 90 && $0.totalCostHigh <= 10 })
    }
}
