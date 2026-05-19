import Foundation

@MainActor
final class PlayerViewModel: ObservableObject {
    @Published private(set) var screenState: PlayerScreenState = .idle
    @Published private(set) var statusMessage: String = "Looking for active session..."
    @Published private(set) var lastAttemptAt: Date?

    private let apiBaseURL: URL
    private let urlSession: URLSession
    private let pollIntervalSeconds: UInt64
    private let loginUsername: String
    private let loginPassword: String
    private var bootstrapTask: Task<Void, Never>?
    private var wsTask: URLSessionWebSocketTask?
    private var telemetryTask: Task<Void, Never>?
    private var playbackPositionSeconds: Double = 0
    private var isPlaying = false

    init(
        apiBaseURL: URL = PlayerViewModel.defaultAPIBaseURL(),
        urlSession: URLSession = .shared,
        pollIntervalSeconds: UInt64 = 5,
        loginUsername: String = PlayerViewModel.defaultPlayerUsername(),
        loginPassword: String = PlayerViewModel.defaultPlayerPassword()
    ) {
        self.apiBaseURL = apiBaseURL
        self.urlSession = urlSession
        self.pollIntervalSeconds = pollIntervalSeconds
        self.loginUsername = loginUsername
        self.loginPassword = loginPassword
    }

    func startPolling() {
        guard bootstrapTask == nil else {
            return
        }

        bootstrapTask = Task {
            await bootstrapLoop()
        }
    }

    deinit {
        bootstrapTask?.cancel()
        telemetryTask?.cancel()
        wsTask?.cancel(with: .goingAway, reason: nil)
    }

    private func bootstrapLoop() async {
        while !Task.isCancelled {
            if wsTask != nil {
                try? await Task.sleep(for: .seconds(1))
                continue
            }

            await refreshAndConnectIfPossible()
            try? await Task.sleep(for: .seconds(pollIntervalSeconds))
        }
    }

    private func refreshAndConnectIfPossible() async {
        lastAttemptAt = Date()

        do {
            let activeSession = try await fetchLatestActiveSession()
            screenState = .main(activeSession)
            statusMessage = "Connecting live controls for \(activeSession.name) (\(activeSession.sessionCode))..."
            try await connectWebSocket(for: activeSession)
        } catch ActiveSessionFetchError.noActiveSession {
            screenState = .idle
            statusMessage = "No active session found. Retrying every \(pollIntervalSeconds) seconds..."
        } catch {
            screenState = .idle
            statusMessage = "Unable to reach backend. Retrying every \(pollIntervalSeconds) seconds..."
        }
    }

    private func connectWebSocket(for session: ActiveSession) async throws {
        let accessToken = try await fetchAccessToken()
        let wsURL = websocketURL(path: "/ws/player", sessionCode: session.sessionCode, token: accessToken)
        let task = urlSession.webSocketTask(with: wsURL)
        wsTask = task
        task.resume()

        statusMessage = "Connected to session \(session.sessionCode). Waiting for commands..."
        startTelemetryLoop(sessionCode: session.sessionCode)
        await listenForSocketMessages(task: task, sessionCode: session.sessionCode)
    }

    private func listenForSocketMessages(task: URLSessionWebSocketTask, sessionCode: String) async {
        while !Task.isCancelled && wsTask === task {
            do {
                let message = try await task.receive()
                switch message {
                case .string(let text):
                    await handleSocketMessage(text: text, sessionCode: sessionCode)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        await handleSocketMessage(text: text, sessionCode: sessionCode)
                    }
                @unknown default:
                    break
                }
            } catch {
                break
            }
        }

        if wsTask === task {
            telemetryTask?.cancel()
            telemetryTask = nil
            wsTask = nil
            screenState = .idle
            statusMessage = "Live connection lost. Reconnecting..."
        }
    }

    private func handleSocketMessage(text: String, sessionCode: String) async {
        guard let data = text.data(using: .utf8) else {
            return
        }

        guard
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let type = object["type"] as? String,
            let payload = object["payload"] as? [String: Any]
        else {
            return
        }

        switch type {
        case "playback.play":
            isPlaying = true
            statusMessage = "Playback command: play"
        case "playback.pause":
            isPlaying = false
            statusMessage = "Playback command: pause"
        case "playback.skip":
            playbackPositionSeconds = 0
            statusMessage = "Playback command: skip"
            await sendSocketEvent(
                type: "playback.ended",
                sessionCode: sessionCode,
                payload: ["reason": "skipped"]
            )
        case "playback.seek":
            if let position = payload["position_seconds"] as? Double {
                playbackPositionSeconds = max(0, position)
            } else if let position = payload["position_seconds"] as? Int {
                playbackPositionSeconds = Double(max(0, position))
            }
            statusMessage = "Playback command: seek to \(Int(playbackPositionSeconds))s"
        case "queue.updated":
            statusMessage = "Queue updated from admin"
        case "session.ended":
            isPlaying = false
            playbackPositionSeconds = 0
            statusMessage = "Session ended by admin. Waiting for next active session..."
            wsTask?.cancel(with: .normalClosure, reason: nil)
            wsTask = nil
            telemetryTask?.cancel()
            telemetryTask = nil
            screenState = .idle
        case "error":
            if let message = payload["message"] as? String {
                statusMessage = "WS error: \(message)"
            }
        default:
            break
        }
    }

    private func startTelemetryLoop(sessionCode: String) {
        telemetryTask?.cancel()
        telemetryTask = Task {
            while !Task.isCancelled && wsTask != nil {
                if isPlaying {
                    playbackPositionSeconds += 1
                }
                await sendSocketEvent(
                    type: "playback.position",
                    sessionCode: sessionCode,
                    payload: [
                        "position_seconds": playbackPositionSeconds,
                        "is_playing": isPlaying
                    ]
                )
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func sendSocketEvent(type: String, sessionCode: String, payload: [String: Any]) async {
        guard let wsTask else {
            return
        }

        let envelope: [String: Any] = [
            "type": type,
            "session_code": sessionCode,
            "payload": payload
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: envelope),
            let text = String(data: data, encoding: .utf8)
        else {
            return
        }

        do {
            try await wsTask.send(.string(text))
        } catch {
            return
        }
    }

    private func fetchAccessToken() async throws -> String {
        let endpoint = apiBaseURL.appending(path: "api/users/login")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(LoginRequest(username: loginUsername, password: loginPassword))

        let (data, response) = try await urlSession.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ActiveSessionFetchError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw ActiveSessionFetchError.httpError(httpResponse.statusCode)
        }

        return try JSONDecoder().decode(LoginTokenResponse.self, from: data).accessToken
    }

    private func fetchLatestActiveSession() async throws -> ActiveSession {
        let endpoint = apiBaseURL.appending(path: "api/sessions/active")
        var request = URLRequest(url: endpoint)
        request.httpMethod = "GET"
        request.timeoutInterval = 10

        let (data, response) = try await urlSession.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw ActiveSessionFetchError.invalidResponse
        }

        if httpResponse.statusCode == 404 {
            throw ActiveSessionFetchError.noActiveSession
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw ActiveSessionFetchError.httpError(httpResponse.statusCode)
        }

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            let withFractions = ISO8601DateFormatter()
            withFractions.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = withFractions.date(from: value) {
                return date
            }

            let internetDate = ISO8601DateFormatter()
            internetDate.formatOptions = [.withInternetDateTime]
            if let date = internetDate.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return try decoder.decode(ActiveSession.self, from: data)
    }

    private func websocketURL(path: String, sessionCode: String, token: String) -> URL {
        var components = URLComponents(
            url: apiBaseURL,
            resolvingAgainstBaseURL: false
        ) ?? URLComponents()
        components.scheme = components.scheme?.replacingOccurrences(of: "http", with: "ws")
        components.path = path
        components.queryItems = [
            URLQueryItem(name: "session_code", value: sessionCode),
            URLQueryItem(name: "token", value: token),
        ]
        return components.url ?? URL(string: "ws://localhost:9000\(path)?session_code=\(sessionCode)&token=\(token)")!
    }

    static func defaultAPIBaseURL() -> URL {
        if let value = ProcessInfo.processInfo.environment["SINGALONG_PLAYER_API_BASE_URL"],
           let url = URL(string: value) {
            return url
        }

        return URL(string: "http://localhost:9000")!
    }

    static func defaultPlayerUsername() -> String {
        ProcessInfo.processInfo.environment["SINGALONG_PLAYER_USERNAME"] ?? "admin"
    }

    static func defaultPlayerPassword() -> String {
        ProcessInfo.processInfo.environment["SINGALONG_PLAYER_PASSWORD"] ?? "password"
    }
}

private struct LoginRequest: Encodable {
    let username: String
    let password: String
}

private struct LoginTokenResponse: Decodable {
    let accessToken: String

    enum CodingKeys: String, CodingKey {
        case accessToken = "access_token"
    }
}

enum ActiveSessionFetchError: Error {
    case noActiveSession
    case invalidResponse
    case httpError(Int)
}
