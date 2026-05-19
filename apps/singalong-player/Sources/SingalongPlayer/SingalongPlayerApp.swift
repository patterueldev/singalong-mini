import SwiftUI

@main
struct SingalongPlayerApp: App {
    @StateObject private var viewModel = PlayerViewModel()

    var body: some Scene {
        WindowGroup {
            PlayerRootView(viewModel: viewModel)
                .task {
                    viewModel.startPolling()
                }
        }
    }
}
