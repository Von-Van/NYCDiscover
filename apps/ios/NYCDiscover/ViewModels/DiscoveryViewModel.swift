import Foundation

enum DiscoveryPhase {
    case form
    case loading
    case results
}

@MainActor
final class DiscoveryViewModel: ObservableObject {
    @Published var form = DiscoveryForm()
    @Published var phase: DiscoveryPhase = .form
    @Published var response: GenerationResponse?
    @Published var activePlanId = "plan-1"
    @Published var message = ""
    @Published var errors: [String] = []
    @Published var seed = 0
    @Published var savedItineraries: [SavedItinerary]

    private let apiClient: APIClient
    private let locationService: LocationService
    private let savedItineraryStore: SavedItineraryStore
    private let fallbackCoordinates = Coordinates(latitude: 40.787, longitude: -73.9754)

    init(
        apiClient: APIClient = APIClient(),
        locationService: LocationService? = nil,
        savedItineraryStore: SavedItineraryStore = SavedItineraryStore()
    ) {
        self.apiClient = apiClient
        self.locationService = locationService ?? LocationService()
        self.savedItineraryStore = savedItineraryStore
        self.savedItineraries = savedItineraryStore.load()
    }

    var activePlan: ItineraryPlan? {
        response?.plans.first { $0.id == activePlanId } ?? response?.plans.first
    }

    var formattedToday: String {
        Date().formatted(date: .complete, time: .omitted)
    }

    var isActivePlanSaved: Bool {
        guard let response, let activePlan else {
            return false
        }
        return savedItineraries.contains {
            $0.id == SavedItinerary.makeId(
                response: response,
                selectedPlanId: activePlan.id,
                originLabel: form.locationLabel
            )
        }
    }

    func showForm() {
        phase = .form
    }

    func clearCoordinatesAfterEditingLocation() {
        form.coordinates = nil
    }

    func locateMe() async {
        message = "Checking your location..."
        errors = []
        do {
            let coordinates = try await locationService.requestCurrentLocation()
            guard LocationService.isInsideNYC(coordinates) else {
                message = "Your current location is outside NYC. Search for a city starting point instead."
                return
            }
            form.locationLabel = "Current location"
            form.coordinates = coordinates
            message = "Starting from your current location."
        } catch {
            message = "Location permission was not granted. Search by neighborhood instead."
        }
    }

    func resolveLocation() async {
        let query = form.locationLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.count >= 3 else {
            message = "Enter at least three characters."
            return
        }

        message = "Finding that spot in NYC..."
        errors = []
        do {
            let result = try await apiClient.geocodeLocation(query: query)
            guard let first = result.results.first else {
                throw APIClientError.requestFailed("No NYC location matched that search.")
            }
            form.locationLabel = first.label
            form.coordinates = first.coordinates
            message = "Starting point set."
        } catch {
            form.coordinates = fallbackCoordinates
            message = "Using the Upper West Side demo starting point while the API is offline."
        }
    }

    func submit() async {
        await runGeneration(nextSeed: seed)
    }

    func regenerate() async {
        let nextSeed = seed + 1
        seed = nextSeed
        await runGeneration(nextSeed: nextSeed)
    }

    func saveActivePlan() {
        guard let response, let activePlan else {
            return
        }
        let itinerary = SavedItinerary(
            response: response,
            selectedPlanId: activePlan.id,
            formSnapshot: form,
            originLabel: form.locationLabel
        )
        savedItineraries = savedItineraryStore.save(itinerary)
        message = "Plan saved."
    }

    func deleteSavedItinerary(_ itinerary: SavedItinerary) {
        savedItineraries = savedItineraryStore.delete(id: itinerary.id)
    }

    func restoreSavedItinerary(_ itinerary: SavedItinerary) {
        form = itinerary.formSnapshot
        response = itinerary.response
        activePlanId = itinerary.selectedPlan?.id ?? itinerary.response.plans.first?.id ?? itinerary.selectedPlanId
        message = ""
        errors = []
        phase = .results
    }

    func shareSummary(for plan: ItineraryPlan) -> String {
        guard let response else {
            return ""
        }
        return ItineraryShareFormatter.summary(
            response: response,
            plan: plan,
            form: form,
            originLabel: form.locationLabel
        )
    }

    func openInMaps(step: TimelineStep) {
        MapsLauncher.open(step: step, transportMode: form.transportMode)
    }

    private func runGeneration(nextSeed: Int) async {
        let formErrors = form.validate()
        errors = formErrors
        guard formErrors.isEmpty else {
            return
        }

        let request: GenerateRequest
        do {
            request = try form.makeRequest(regenerationSeed: nextSeed)
        } catch {
            errors = [error.localizedDescription]
            return
        }

        phase = .loading
        message = ""
        do {
            let result = try await apiClient.generateItineraries(request: request)
            response = result
            activePlanId = result.plans.first?.id ?? ""
        } catch {
            guard apiClient.demoFallbackEnabled else {
                errors = [error.localizedDescription]
                phase = .form
                return
            }
            let result = DemoData.buildResponse(for: request)
            response = result
            activePlanId = result.plans.first?.id ?? ""
        }
        phase = .results
    }
}
