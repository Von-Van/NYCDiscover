import SwiftUI

struct ResultsView: View {
    @ObservedObject var viewModel: DiscoveryViewModel

    var body: some View {
        guard let response = viewModel.response else {
            return AnyView(EmptyView())
        }

        return AnyView(
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    heading
                    weatherStrip(response.weather)
                    warnings(response.warnings)

                    if response.plans.isEmpty {
                        emptyState
                    } else if let activePlan = viewModel.activePlan {
                        planTabs(response.plans)
                        planDetails(activePlan)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
            }
        )
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text("PLANS FOR \(viewModel.form.locationLabel.uppercased())")
                    .font(.caption.weight(.black))
                    .foregroundStyle(AppColor.accent)
                Text("Here's your way out the door.")
                    .font(.system(size: 36, weight: .black, design: .serif))
                    .foregroundStyle(AppColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 10) {
                Button {
                    viewModel.showForm()
                } label: {
                    Label("Change", systemImage: "slider.horizontal.3")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
                .tint(AppColor.ink)

                Button {
                    Task { await viewModel.regenerate() }
                } label: {
                    Label("Regenerate", systemImage: "arrow.clockwise")
                        .font(.subheadline.weight(.bold))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(AppColor.accent)
            }
        }
    }

    private func weatherStrip(_ weather: WeatherSummary) -> some View {
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: weather.isWet ? "cloud.rain.fill" : "sun.max.fill")
                .font(.title2)
                .foregroundStyle(weather.isWet ? AppColor.accent : AppColor.warm)
                .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 3) {
                Text("\(weather.temperatureF.map { "\($0) degrees - " } ?? "")\(weather.summary)")
                    .font(.subheadline.weight(.black))
                    .foregroundStyle(AppColor.ink)
                Text("\(weather.precipitationProbability)% chance of precipitation")
                    .font(.caption)
                    .foregroundStyle(AppColor.muted)
            }
            Spacer()
            Text(weather.sourceName)
                .font(.caption2.weight(.black))
                .foregroundStyle(AppColor.muted)
        }
        .padding(14)
        .background(AppColor.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppColor.line, lineWidth: 1)
        )
    }

    private func warnings(_ warnings: [String]) -> some View {
        Group {
            if !warnings.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Heads up")
                        .font(.caption.weight(.black))
                    Text(warnings.joined(separator: " "))
                        .font(.footnote)
                }
                .foregroundStyle(AppColor.ink)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppColor.warm.opacity(0.12))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("NO HONEST FIT")
                .font(.caption.weight(.black))
                .foregroundStyle(AppColor.warm)
            Text("These constraints are too tight for the available data.")
                .font(.title3.weight(.black))
                .foregroundStyle(AppColor.ink)
            Text("Try adding time, budget, or travel radius. We would rather return no plan than a bad one.")
                .font(.body)
                .foregroundStyle(AppColor.muted)
            Button {
                viewModel.showForm()
            } label: {
                Text("Adjust the brief")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppColor.paper)
                    .frame(maxWidth: .infinity, minHeight: 50)
                    .background(AppColor.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)
        }
        .padding(16)
        .background(AppColor.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppColor.line, lineWidth: 1)
        )
    }

    private func planTabs(_ plans: [ItineraryPlan]) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(Array(plans.enumerated()), id: \.element.id) { index, plan in
                    Button {
                        viewModel.activePlanId = plan.id
                    } label: {
                        VStack(alignment: .leading, spacing: 5) {
                            Text("Plan \(planLetter(for: index))")
                                .font(.caption2.weight(.black))
                                .foregroundStyle(AppColor.muted)
                            Text(plan.title)
                                .font(.subheadline.weight(.black))
                                .foregroundStyle(AppColor.ink)
                                .lineLimit(1)
                            Text("\(durationLabel(plan.totalMinutes)) - up to $\(plan.totalCostHigh)")
                                .font(.caption)
                                .foregroundStyle(AppColor.muted)
                                .lineLimit(1)
                        }
                        .frame(width: 170, alignment: .leading)
                        .padding(12)
                        .background(viewModel.activePlanId == plan.id ? AppColor.accent.opacity(0.18) : AppColor.panel)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(viewModel.activePlanId == plan.id ? AppColor.accent : AppColor.line, lineWidth: 1)
                        )
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func planDetails(_ plan: ItineraryPlan) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(plan.subtitle.uppercased())
                            .font(.caption.weight(.black))
                            .foregroundStyle(AppColor.accent)
                        Text(plan.title)
                            .font(.title2.weight(.black))
                            .foregroundStyle(AppColor.ink)
                    }
                    Spacer()
                    VStack(spacing: 2) {
                        Text("\(Int((plan.confidence * 100).rounded()))")
                            .font(.title.weight(.black))
                            .foregroundStyle(AppColor.ink)
                        Text(confidenceLabel(plan.confidence))
                            .font(.caption2.weight(.bold))
                            .multilineTextAlignment(.center)
                            .foregroundStyle(AppColor.muted)
                    }
                    .frame(width: 82)
                    .padding(8)
                    .background(AppColor.paper)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                facts(plan)
            }
            .padding(16)
            .background(AppColor.panel)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(AppColor.ink, lineWidth: 1)
            )

            ItineraryMapView(plan: plan)
                .frame(height: 260)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(AppColor.line, lineWidth: 1)
                )

            Text("Connectors show the shape of the plan. Check your preferred navigation app before leaving.")
                .font(.caption)
                .foregroundStyle(AppColor.muted)

            timeline(plan.steps)

            estimateNote(plan.estimateNotes)
        }
    }

    private func facts(_ plan: ItineraryPlan) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            fact(title: "Total time", value: durationLabel(plan.totalMinutes))
            fact(title: "Est. spend", value: "$\(plan.totalCostLow)-$\(plan.totalCostHigh)")
            fact(title: "Stops", value: "\(plan.steps.count)")
            fact(title: "Travel", value: viewModel.form.transportMode.label)
        }
    }

    private func fact(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.caption2.weight(.black))
                .foregroundStyle(AppColor.muted)
            Text(value)
                .font(.subheadline.weight(.black))
                .foregroundStyle(AppColor.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(AppColor.paper)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func timeline(_ steps: [TimelineStep]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(steps.enumerated()), id: \.element.id) { index, step in
                HStack(alignment: .top, spacing: 12) {
                    VStack(spacing: 6) {
                        Text("\(index + 1)")
                            .font(.caption.weight(.black))
                            .foregroundStyle(AppColor.paper)
                            .frame(width: 30, height: 30)
                            .background(AppColor.ink)
                            .clipShape(Circle())
                        Rectangle()
                            .fill(AppColor.line)
                            .frame(width: 2)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        HStack {
                            Label("\(step.travelBefore.minutes) min \(step.travelBefore.mode)", systemImage: "arrow.triangle.turn.up.right.diamond")
                            Spacer()
                            Text(String(format: "%.1f mi", step.travelBefore.distanceMiles))
                        }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColor.muted)

                        VStack(alignment: .leading, spacing: 8) {
                            Text("\(step.startAt.formatted(date: .omitted, time: .shortened)) to \(step.endAt.formatted(date: .omitted, time: .shortened))")
                                .font(.caption.weight(.black))
                                .foregroundStyle(AppColor.accent)
                            Text(step.category.uppercased())
                                .font(.caption2.weight(.black))
                                .foregroundStyle(AppColor.muted)
                            Text(step.name)
                                .font(.headline.weight(.black))
                                .foregroundStyle(AppColor.ink)
                            Text("$\(step.costLow)-$\(step.costHigh) - \(confidenceLabel(step.confidence))")
                                .font(.subheadline)
                                .foregroundStyle(AppColor.muted)

                            DisclosureGroup("What to verify") {
                                VStack(alignment: .leading, spacing: 8) {
                                    ForEach(step.estimateNotes, id: \.self) { note in
                                        Text(note)
                                    }
                                    if let sourceUrl = step.sourceUrl, let url = URL(string: sourceUrl) {
                                        Link("Open source", destination: url)
                                            .font(.subheadline.weight(.bold))
                                    }
                                }
                                .font(.footnote)
                                .foregroundStyle(AppColor.muted)
                                .padding(.top, 4)
                            }
                            .font(.subheadline.weight(.bold))
                            .tint(AppColor.accent)
                        }
                        .padding(14)
                        .background(AppColor.panel)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(AppColor.line, lineWidth: 1)
                        )
                    }
                }
            }
        }
    }

    private func estimateNote(_ notes: [String]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Before you go")
                .font(.headline.weight(.black))
                .foregroundStyle(AppColor.ink)
            ForEach(notes, id: \.self) { note in
                Label(note, systemImage: "checkmark.circle")
                    .font(.footnote)
                    .foregroundStyle(AppColor.muted)
            }
        }
        .padding(14)
        .background(AppColor.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppColor.line, lineWidth: 1)
        )
    }

    private func planLetter(for index: Int) -> String {
        let letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
        guard index < letters.count else {
            return "\(index + 1)"
        }
        let letterIndex = letters.index(letters.startIndex, offsetBy: index)
        return String(letters[letterIndex])
    }
}
