import SwiftUI

struct PlannerView: View {
    @ObservedObject var viewModel: DiscoveryViewModel

    private let durations: [(Int, String)] = [
        (90, "1.5 hours"),
        (120, "2 hours"),
        (180, "3 hours"),
        (240, "4 hours"),
        (360, "6 hours"),
    ]

    private let radii = [1, 2, 3, 5]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                hero
                briefPanel
                footer
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("A FIELD GUIDE FOR RIGHT NOW")
                .font(.caption.weight(.black))
                .foregroundStyle(AppColor.accent)
            Text("New York,\ndecided.")
                .font(.system(size: 50, weight: .black, design: .serif))
                .foregroundStyle(AppColor.ink)
                .lineSpacing(-4)
            Text("Give us a few practical constraints. Get back a small plan that fits the hours you actually have.")
                .font(.body)
                .foregroundStyle(AppColor.muted)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .top, spacing: 12) {
                Text("01")
                    .font(.caption.weight(.black))
                    .foregroundStyle(AppColor.paper)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(AppColor.warm)
                Text("Built for the gap after work, the free afternoon, and the group chat that has gone nowhere.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(AppColor.ink)
            }
            .padding(14)
            .background(AppColor.panel)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(AppColor.line, lineWidth: 1)
            )
        }
    }

    private var briefPanel: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Text("THE BRIEF")
                    .font(.caption.weight(.black))
                    .foregroundStyle(AppColor.warm)
                Text("Tell us what kind of day this is.")
                    .font(.headline.weight(.bold))
                    .foregroundStyle(AppColor.ink)
            }

            section(number: "1", title: "Start here") {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Neighborhood, landmark, or address")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(AppColor.muted)
                    HStack(spacing: 10) {
                        TextField("Try \"Upper West Side\"", text: $viewModel.form.locationLabel)
                            .textFieldStyle(.plain)
                            .textInputAutocapitalization(.words)
                            .padding(12)
                            .background(Color.white)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(AppColor.line, lineWidth: 1)
                            )
                            .onChange(of: viewModel.form.locationLabel) {
                                viewModel.clearCoordinatesAfterEditingLocation()
                            }

                        Button {
                            Task { await viewModel.resolveLocation() }
                        } label: {
                            Text("Set")
                                .font(.subheadline.weight(.bold))
                                .foregroundStyle(AppColor.paper)
                                .frame(width: 56, height: 44)
                                .background(AppColor.ink)
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }

                    Button {
                        Task { await viewModel.locateMe() }
                    } label: {
                        Label("Use my current location", systemImage: "location.viewfinder")
                            .font(.subheadline.weight(.semibold))
                    }
                    .foregroundStyle(AppColor.accent)

                    if !viewModel.message.isEmpty {
                        Text(viewModel.message)
                            .font(.footnote)
                            .foregroundStyle(AppColor.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            section(number: "2", title: "Start time") {
                Picker("Start time", selection: $viewModel.form.startMode) {
                    ForEach(StartMode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                if viewModel.form.startMode == .later {
                    DatePicker(
                        "Later today",
                        selection: $viewModel.form.laterTime,
                        displayedComponents: .hourAndMinute
                    )
                    .datePickerStyle(.compact)
                    .tint(AppColor.accent)
                }
            }

            HStack(alignment: .top, spacing: 12) {
                section(number: "3", title: "Time available") {
                    Picker("Time available", selection: $viewModel.form.availableMinutes) {
                        ForEach(durations, id: \.0) { value, label in
                            Text(label).tag(value)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                section(number: "4", title: "Group size") {
                    Stepper(value: $viewModel.form.groupSize, in: 1...12) {
                        Text("\(viewModel.form.groupSize)")
                            .font(.title3.weight(.black))
                            .foregroundStyle(AppColor.ink)
                    }
                }
            }

            section(number: "5", title: "Per-person budget") {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text("$0")
                        Spacer()
                        Text("$\(viewModel.form.budgetMax)")
                            .font(.title3.weight(.black))
                            .foregroundStyle(AppColor.ink)
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(AppColor.muted)
                    Slider(
                        value: Binding(
                            get: { Double(viewModel.form.budgetMax) },
                            set: { viewModel.form.budgetMax = Int($0.rounded()) }
                        ),
                        in: 0...100,
                        step: 5
                    )
                    .tint(AppColor.accent)
                }
            }

            section(number: "6", title: "How are you moving?") {
                VStack(spacing: 12) {
                    Picker("Transport", selection: $viewModel.form.transportMode) {
                        ForEach(TransportMode.allCases) { mode in
                            Label(mode.label, systemImage: mode.mark).tag(mode)
                        }
                    }
                    .pickerStyle(.segmented)

                    Picker("Radius", selection: $viewModel.form.radiusMiles) {
                        ForEach(radii, id: \.self) { radius in
                            Text("\(radius) mi").tag(radius)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }

            section(number: "7", title: "Pick the mood") {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: 10)], spacing: 10) {
                    ForEach(Mood.allCases) { mood in
                        Button {
                            viewModel.form.mood = mood
                        } label: {
                            HStack(spacing: 8) {
                                Text(mood.mark)
                                    .font(.caption.weight(.black))
                                    .frame(width: 26, height: 26)
                                    .foregroundStyle(viewModel.form.mood == mood ? AppColor.paper : AppColor.ink)
                                    .background(viewModel.form.mood == mood ? AppColor.ink : AppColor.paper)
                                    .clipShape(Circle())
                                Text(mood.label)
                                    .font(.caption.weight(.bold))
                                    .lineLimit(1)
                                    .minimumScaleFactor(0.85)
                            }
                            .foregroundStyle(viewModel.form.mood == mood ? AppColor.paper : AppColor.ink)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .padding(.horizontal, 10)
                            .background(viewModel.form.mood == mood ? AppColor.accent : Color.white)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(AppColor.line, lineWidth: 1)
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

            if !viewModel.errors.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(viewModel.errors, id: \.self) { error in
                        Text(error)
                    }
                }
                .font(.footnote.weight(.semibold))
                .foregroundStyle(AppColor.warm)
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(AppColor.warm.opacity(0.10))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            Button {
                Task { await viewModel.submit() }
            } label: {
                Label("Make my plan", systemImage: "arrow.right")
                    .font(.headline.weight(.black))
                    .foregroundStyle(AppColor.paper)
                    .frame(maxWidth: .infinity, minHeight: 54)
                    .background(AppColor.ink)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            .buttonStyle(.plain)

            Text("Same-day plans only. Prices and travel times are estimates; verify before leaving.")
                .font(.caption)
                .foregroundStyle(AppColor.muted)
                .frame(maxWidth: .infinity, alignment: .center)
        }
        .padding(16)
        .background(AppColor.panel)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(AppColor.ink, lineWidth: 1)
        )
    }

    private var footer: some View {
        HStack {
            Text("NYC DISCOVER")
            Spacer()
            Text("OPEN DATA")
        }
        .font(.caption2.weight(.black))
        .foregroundStyle(AppColor.muted)
        .padding(.bottom, 12)
    }

    private func section<Content: View>(
        number: String,
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text(number)
                    .font(.caption.weight(.black))
                    .foregroundStyle(AppColor.paper)
                    .frame(width: 24, height: 24)
                    .background(AppColor.ink)
                    .clipShape(Circle())
                Text(title)
                    .font(.subheadline.weight(.black))
                    .foregroundStyle(AppColor.ink)
            }
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(AppColor.paper.opacity(0.55))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}
