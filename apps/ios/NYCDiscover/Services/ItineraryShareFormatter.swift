import Foundation

struct ItineraryShareFormatter {
    static func summary(
        response: GenerationResponse,
        plan: ItineraryPlan,
        form: DiscoveryForm,
        originLabel: String
    ) -> String {
        var lines: [String] = [
            "NYC Discover",
            "Origin: \(originLabel)",
            "Weather: \(weatherLine(response.weather))",
            "Plan: \(plan.title)",
            "Total: \(durationLabel(plan.totalMinutes)), $\(plan.totalCostLow)-$\(plan.totalCostHigh) per person, \(plan.steps.count) stops",
            "",
            "Stops:",
        ]

        for (index, step) in plan.steps.enumerated() {
            lines.append("\(index + 1). \(timeRange(step)) \(step.name) (\(step.category))")
            lines.append("   $\(step.costLow)-$\(step.costHigh), \(step.travelBefore.minutes) min \(step.travelBefore.mode)")
            if !step.estimateNotes.isEmpty {
                lines.append("   Verify: \(step.estimateNotes.joined(separator: " "))")
            }
        }

        if !plan.estimateNotes.isEmpty {
            lines.append("")
            lines.append("Before you go:")
            lines.append(contentsOf: plan.estimateNotes.map { "- \($0)" })
        }

        if !response.warnings.isEmpty {
            lines.append("")
            lines.append("Heads up:")
            lines.append(contentsOf: response.warnings.map { "- \($0)" })
        }

        lines.append("")
        lines.append("Travel mode: \(form.transportMode.label)")
        return lines.joined(separator: "\n")
    }

    private static func weatherLine(_ weather: WeatherSummary) -> String {
        let temperature = weather.temperatureF.map { "\($0) degrees, " } ?? ""
        return "\(temperature)\(weather.summary), \(weather.precipitationProbability)% chance of precipitation"
    }

    private static func timeRange(_ step: TimelineStep) -> String {
        "\(timeFormatter.string(from: step.startAt))-\(timeFormatter.string(from: step.endAt))"
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "America/New_York")
        formatter.dateStyle = .none
        formatter.timeStyle = .short
        return formatter
    }()
}
