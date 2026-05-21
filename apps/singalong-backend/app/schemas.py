from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class UserLoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)
    password: str = Field(min_length=1, max_length=200)


class UserLogoutRequest(BaseModel):
    username: str = Field(min_length=3, max_length=100)


class GuestCreateRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=50)


class GuestLoginRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=50)


class GuestUsernameSuggestionResponse(BaseModel):
    username: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    username: str
    role: str
    created_at: datetime
    updated_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    message: str


class LogoutResponse(BaseModel):
    message: str


class GuestCreateResponse(BaseModel):
    user: UserResponse
    message: str


class GuestLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
    nickname: str
    message: str


class SessionCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class SessionUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    vibes: str | None = Field(default=None, max_length=2000)


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_code: str
    name: str
    vibes: str | None = None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SessionArchiveResponse(BaseModel):
    session: SessionResponse
    message: str


class SessionQueueItem(BaseModel):
    id: UUID
    session_id: UUID
    song_id: UUID
    title: str
    artist: str
    duration: str | None = None
    queue_order: int
    status: Literal["pending", "finished", "skipped"]
    reserved_by: UUID
    reserved_by_username: str | None = None
    reserved_at: datetime
    played_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SessionQueueListResponse(BaseModel):
    items: list[SessionQueueItem]


class SessionQueueCreateRequest(BaseModel):
    song_id: UUID


class SessionQueueUpdateRequest(BaseModel):
    action: Literal["skip", "finish", "reorder"]
    target_order: int | None = Field(default=None, ge=1)


class SessionQueueMutationResponse(BaseModel):
    item: SessionQueueItem
    message: str


class SessionQueueDeleteResponse(BaseModel):
    message: str


class SessionParticipantItem(BaseModel):
    user_id: UUID
    username: str
    pending_count: int
    finished_count: int
    skipped_count: int
    total_count: int
    is_online: bool


class SessionParticipantListResponse(BaseModel):
    items: list[SessionParticipantItem]


class SessionWorkspaceResponse(BaseModel):
    session: SessionResponse
    websocket_status: str = "connected"
    player_connected: bool
    admin_connected_count: int
    guest_connected_count: int


class SongSuggestDownloadRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=1000)
    source_id: str = Field(min_length=1, max_length=50)
    source: str = Field(default="youtube", min_length=1, max_length=50)
    source_thumbnail: str = Field(default="", max_length=1000)
    source_thumbnail_data_url: str = Field(default="", max_length=1000000)
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)
    language: str | None = None
    is_off_vocal: bool = False
    video_has_lyrics: bool = False
    genre: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    lyrics: str = Field(default="", max_length=20000)


class SongSuggestDownloadResponse(BaseModel):
    status: str
    message: str
    song_id: str


class SongSuggestSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=200)
    limit: int = Field(default=20, ge=1, le=50)


class SongSuggestSearchItem(BaseModel):
    id: str
    title: str
    thumbnail_url: str
    duration: str
    channel_name: str
    channel_url: str = ""
    description: str = ""
    view_count: int | None = None
    uploaded_at: str = ""
    exists_in_songbook: bool = False
    source_url: str
    youtube_id: str


class SongSuggestSearchResponse(BaseModel):
    effective_query: str
    appended_karaoke: bool
    results: list[SongSuggestSearchItem]


class SongSuggestIdentifyRequest(BaseModel):
    url: str = Field(min_length=1, max_length=1000)


class SongSuggestIdentifyResponse(BaseModel):
    source_url: str
    source_id: str
    source: str
    source_thumbnail: str
    title: str
    artist: str
    language: str | None = None
    is_off_vocal: bool = False
    video_has_lyrics: bool = False
    genre: str | None = None
    tags: list[str] | None = None
    lyrics: str | None = None


class SongSuggestUpdateRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=1000)
    source_id: str = Field(min_length=1, max_length=50)
    source: str = Field(default="youtube", min_length=1, max_length=50)
    source_thumbnail: str = Field(default="", max_length=1000)
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)
    language: str = Field(default="", max_length=20)
    is_off_vocal: bool = False
    video_has_lyrics: bool = False
    genre: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    lyrics: str = Field(default="", max_length=20000)


class SongSuggestUpdateResponse(BaseModel):
    status: str
    message: str
    draft: SongSuggestIdentifyResponse


class SongSuggestSuggestionsResponse(BaseModel):
    genres: list[str]
    tags: list[str]


class SongSuggestEnhanceRequest(BaseModel):
    source_url: str = Field(min_length=1, max_length=1000)
    source_id: str = Field(min_length=1, max_length=50)
    source: str = Field(default="youtube", min_length=1, max_length=50)
    source_thumbnail: str = Field(default="", max_length=1000)
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)
    language: str = Field(default="", max_length=20)
    is_off_vocal: bool = False
    video_has_lyrics: bool = False
    genre: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    lyrics: str = Field(default="", max_length=20000)


class SongSuggestEnhanceResponse(BaseModel):
    status: str
    message: str
    enhanced: SongSuggestIdentifyResponse


class SongbookItem(BaseModel):
    id: UUID
    title: str
    artist: str
    duration: str
    language: str | None
    genre: str | None
    tags: list[str]
    thumbnail_url: str | None
    source_id: str | None
    source_url: str | None
    video_file: str | None = None
    lyrics: str | None = None
    added_by_username: str | None = None
    queued_count_in_session: int = 0
    was_queued_in_session: bool = False


class SongAdminUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)
    language: str | None = Field(default=None, max_length=20)
    genre: str | None = Field(default=None, max_length=100)
    tags: list[str] = Field(default_factory=list)
    lyrics: str | None = Field(default=None, max_length=20000)
    source_thumbnail_data_url: str | None = Field(default=None, max_length=1000000)


class SongAdminUpdateResponse(BaseModel):
    item: SongbookItem
    message: str


class SongbookListResponse(BaseModel):
    items: list[SongbookItem]
    total: int
    page: int
    pages: int


class SongDownloadItem(BaseModel):
    song_id: UUID
    title: str
    artist: str
    duration: str | None = None
    added_by_username: str | None = None
    source_thumbnail: str | None = None
    source_id: str | None
    source_url: str
    status: str
    progress_pct: int | None = None
    current_step: str | None = None
    progress_message: str | None = None
    error_message: str | None = None
    added_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    updated_at: datetime


class SongDownloadListResponse(BaseModel):
    items: list[SongDownloadItem]
