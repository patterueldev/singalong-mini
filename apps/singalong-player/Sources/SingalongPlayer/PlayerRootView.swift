import SwiftUI

struct PlayerRootView: View {
    @ObservedObject var viewModel: PlayerViewModel

    var body: some View {
        switch viewModel.screenState {
        case .idle:
            IdleScreen(statusMessage: viewModel.statusMessage, lastAttemptAt: viewModel.lastAttemptAt)
        case .main(let session):
            MainScreen(session: session, statusMessage: viewModel.statusMessage)
        }
    }
}

private struct IdleScreen: View {
    let statusMessage: String
    let lastAttemptAt: Date?

    private var lastAttemptText: String {
        guard let lastAttemptAt else {
            return "Waiting for first connection attempt..."
        }
        return "Last check: \(lastAttemptAt.formatted(date: .omitted, time: .standard))"
    }

    var body: some View {
        VStack(spacing: 16) {
            Text("Singalong Player")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("Idle")
                .font(.title2)
                .foregroundStyle(.secondary)
            ProgressView()
                .controlSize(.large)
            Text(statusMessage)
                .multilineTextAlignment(.center)
            Text(lastAttemptText)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}

private struct MainScreen: View {
    let session: ActiveSession
    let statusMessage: String

    var body: some View {
        VStack(spacing: 20) {
            Text("Singalong Player")
                .font(.largeTitle)
                .fontWeight(.bold)
            Text("Main Screen")
                .font(.title2)
                .foregroundStyle(.secondary)
            VStack(spacing: 8) {
                Text(session.name)
                    .font(.title)
                    .fontWeight(.semibold)
                Text("Session Code: \(session.sessionCode)")
                    .font(.title3)
                    .monospacedDigit()
                Text(statusMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}
