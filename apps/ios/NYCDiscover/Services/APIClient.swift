import Foundation

struct APIClient {
    let baseURL: URL
    let demoFallbackEnabled: Bool
    private let session: URLSession

    init(
        baseURL: URL = APIClient.defaultBaseURL,
        demoFallbackEnabled: Bool = APIClient.defaultDemoFallbackEnabled,
        session: URLSession = .shared
    ) {
        self.baseURL = baseURL
        self.demoFallbackEnabled = demoFallbackEnabled
        self.session = session
    }

    func geocodeLocation(query: String) async throws -> GeocodeResponse {
        var components = URLComponents(url: baseURL.appending(path: "/v1/geocode"), resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "q", value: query)]
        guard let url = components?.url else {
            throw APIClientError.badURL
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 8
        return try await send(request)
    }

    func generateItineraries(request payload: GenerateRequest) async throws -> GenerationResponse {
        let url = baseURL.appending(path: "/v1/itineraries/generate")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try DateCoding.makeEncoder().encode(payload)
        return try await send(request)
    }

    private func send<T: Decodable>(_ request: URLRequest) async throws -> T {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? DateCoding.makeDecoder().decode(APIErrorPayload.self, from: data).detail)
                ?? "Request failed with status \(httpResponse.statusCode)."
            throw APIClientError.requestFailed(message)
        }
        do {
            return try DateCoding.makeDecoder().decode(T.self, from: data)
        } catch {
            throw APIClientError.decoding(error)
        }
    }

    private static var defaultBaseURL: URL {
        if
            let rawValue = Bundle.main.object(forInfoDictionaryKey: "NYCDiscoverAPIURL") as? String,
            let url = URL(string: rawValue)
        {
            return url
        }
        return URL(string: "http://127.0.0.1:8000")!
    }

    private static var defaultDemoFallbackEnabled: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NYCDiscoverDemoFallback") as? Bool ?? true
    }
}

private struct APIErrorPayload: Decodable {
    var detail: String?
}

enum APIClientError: LocalizedError {
    case badURL
    case invalidResponse
    case requestFailed(String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .badURL:
            return "The API URL is invalid."
        case .invalidResponse:
            return "The API returned an invalid response."
        case .requestFailed(let message):
            return message
        case .decoding(let error):
            return "The API response could not be read: \(error.localizedDescription)"
        }
    }
}

enum DateCoding {
    static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = fractionalFormatter.date(from: value) {
                return date
            }
            if let date = internetFormatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO-8601 date: \(value)"
            )
        }
        return decoder
    }

    static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(internetFormatter.string(from: date))
        }
        return encoder
    }

    private static let internetFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
