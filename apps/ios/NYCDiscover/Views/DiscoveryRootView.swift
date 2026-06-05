import SwiftUI

struct DiscoveryRootView: View {
    @StateObject private var viewModel = DiscoveryViewModel()

    var body: some View {
        NavigationStack {
            ZStack {
                AppColor.paper.ignoresSafeArea()
                VStack(spacing: 0) {
                    AppHeader(viewModel: viewModel)
                    Group {
                        switch viewModel.phase {
                        case .form:
                            PlannerView(viewModel: viewModel)
                        case .loading:
                            LoadingView()
                        case .results:
                            ResultsView(viewModel: viewModel)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

private struct AppHeader: View {
    @ObservedObject var viewModel: DiscoveryViewModel
    @State private var showingSavedPlans = false

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    viewModel.showForm()
                } label: {
                    HStack(spacing: 8) {
                        Text("NYC")
                            .font(.system(size: 13, weight: .black, design: .rounded))
                            .foregroundStyle(AppColor.paper)
                            .frame(width: 40, height: 34)
                            .background(AppColor.ink)
                        Text("DISCOVER")
                            .font(.system(size: 20, weight: .black, design: .rounded))
                            .foregroundStyle(AppColor.ink)
                    }
                }
                .buttonStyle(.plain)

                Spacer()

                HStack(spacing: 10) {
                    Button {
                        showingSavedPlans = true
                    } label: {
                        ZStack(alignment: .topTrailing) {
                            Image(systemName: "bookmark")
                                .font(.headline.weight(.bold))
                                .foregroundStyle(AppColor.ink)
                                .frame(width: 36, height: 34)
                            if !viewModel.savedItineraries.isEmpty {
                                Text("\(viewModel.savedItineraries.count)")
                                    .font(.system(size: 9, weight: .black, design: .rounded))
                                    .foregroundStyle(AppColor.paper)
                                    .frame(minWidth: 16, minHeight: 16)
                                    .background(AppColor.warm)
                                    .clipShape(Circle())
                                    .offset(x: 3, y: -3)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Saved plans")

                    Text("VOL. 01")
                        .font(.caption.weight(.bold))
                        .foregroundStyle(AppColor.muted)
                }
            }

            HStack {
                Text(viewModel.formattedToday.uppercased())
                Spacer()
                Text("PLANS, NOT LISTS")
            }
            .font(.caption2.weight(.semibold))
            .foregroundStyle(AppColor.muted)
            .padding(.top, 8)
            .overlay(alignment: .top) {
                Rectangle()
                    .fill(AppColor.ink.opacity(0.2))
                    .frame(height: 1)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 14)
        .padding(.bottom, 12)
        .background(.ultraThinMaterial)
        .sheet(isPresented: $showingSavedPlans) {
            SavedPlansView(viewModel: viewModel)
        }
    }
}

private struct LoadingView: View {
    @State private var pulse = false

    var body: some View {
        VStack(spacing: 22) {
            HStack(spacing: 8) {
                ForEach(0..<3) { index in
                    Circle()
                        .fill(AppColor.accent)
                        .frame(width: 12, height: 12)
                        .scaleEffect(pulse ? 1.25 : 0.75)
                        .animation(
                            .easeInOut(duration: 0.7)
                            .repeatForever()
                            .delay(Double(index) * 0.15),
                            value: pulse
                        )
                }
            }
            .onAppear { pulse = true }

            VStack(spacing: 10) {
                Text("WORKING THE ROUTE")
                    .font(.caption.weight(.black))
                    .foregroundStyle(AppColor.accent)
                Text("Finding the version of tonight that fits.")
                    .font(.title2.weight(.black))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(AppColor.ink)
                Text("Checking distance, time, weather, cost, and whether the pieces make sense together.")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(AppColor.muted)
                    .padding(.horizontal, 28)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding()
    }
}

enum AppColor {
    static let paper = Color(red: 0.97, green: 0.95, blue: 0.90)
    static let ink = Color(red: 0.12, green: 0.11, blue: 0.10)
    static let muted = Color(red: 0.42, green: 0.39, blue: 0.34)
    static let line = Color(red: 0.80, green: 0.75, blue: 0.66)
    static let accent = Color(red: 0.00, green: 0.39, blue: 0.43)
    static let warm = Color(red: 0.79, green: 0.24, blue: 0.16)
    static let panel = Color(red: 1.00, green: 0.99, blue: 0.96)
}
