import Foundation

struct ActiveSession: Decodable, Equatable {
    let id: UUID
    let sessionCode: String
    let name: String
    let archivedAt: Date?
    let createdAt: Date
    let updatedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case sessionCode = "session_code"
        case name
        case archivedAt = "archived_at"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

enum PlayerScreenState: Equatable {
    case idle
    case main(ActiveSession)
}
