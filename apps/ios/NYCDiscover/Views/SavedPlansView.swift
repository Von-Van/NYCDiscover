import SwiftUI

struct SavedPlansView: View {
    @ObservedObject var viewModel: DiscoveryViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                AppColor.paper.ignoresSafeArea()
                Group {
                    if viewModel.savedItineraries.isEmpty {
                        emptyState
                    } else {
                        savedList
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
            }
            .navigationTitle("Saved Plans")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "bookmark")
                .font(.largeTitle)
                .foregroundStyle(AppColor.accent)
            Text("No saved plans yet")
                .font(.title3.weight(.black))
                .foregroundStyle(AppColor.ink)
            Text("Save a generated itinerary and it will be ready here for the demo.")
                .font(.callout)
                .multilineTextAlignment(.center)
                .foregroundStyle(AppColor.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var savedList: some View {
        ScrollView {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.savedItineraries) { itinerary in
                    savedCard(itinerary)
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func savedCard(_ itinerary: SavedItinerary) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(itinerary.originLabel.uppercased())
                        .font(.caption2.weight(.black))
                        .foregroundStyle(AppColor.accent)
                    Text(itinerary.selectedPlan?.title ?? "Saved plan")
                        .font(.headline.weight(.black))
                        .foregroundStyle(AppColor.ink)
                        .lineLimit(2)
                }
                Spacer()
                Button {
                    viewModel.deleteSavedItinerary(itinerary)
                } label: {
                    Image(systemName: "trash")
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(AppColor.warm)
                        .frame(width: 34, height: 34)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Delete saved plan")
            }

            if let plan = itinerary.selectedPlan {
                HStack(spacing: 10) {
                    Label(durationLabel(plan.totalMinutes), systemImage: "clock")
                    Label("$\(plan.totalCostLow)-$\(plan.totalCostHigh)", systemImage: "dollarsign")
                    Label("\(plan.steps.count)", systemImage: "mappin.and.ellipse")
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(AppColor.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            }

            Text("Saved \(itinerary.savedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(AppColor.muted)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppColor.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppColor.line, lineWidth: 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .contentShape(RoundedRectangle(cornerRadius: 8))
        .onTapGesture {
            viewModel.restoreSavedItinerary(itinerary)
            dismiss()
        }
    }
}
