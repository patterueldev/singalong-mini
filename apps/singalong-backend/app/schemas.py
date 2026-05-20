from datetime import datetime
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


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    session_code: str
    name: str
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


class SessionArchiveResponse(BaseModel):
    session: SessionResponse
    message: str


class SongSuggestDownloadRequest(BaseModel):
    url: str = Field(min_length=1, max_length=1000)


class SongSuggestDownloadResponse(BaseModel):
    status: str
    message: str
    youtube_id: str


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
    exists_in_songbook: bool | None = None
    source_url: str
    youtube_id: str


class SongSuggestSearchResponse(BaseModel):
    effective_query: str
    appended_karaoke: bool
    results: list[SongSuggestSearchItem]


class SongSuggestIdentifyRequest(BaseModel):
    url: str = Field(min_length=1, max_length=1000)


class SongSuggestIdentifyResponse(BaseModel):
    title: str
    artist: str
    source_url: str
    youtube_id: str
    thumbnail_url: str
    thumbnail_data_url: str
    channel_name: str
    description: str


class SongSuggestUpdateRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    artist: str = Field(min_length=1, max_length=200)
    source_url: str = Field(min_length=1, max_length=1000)
    youtube_id: str = Field(min_length=1, max_length=50)
    thumbnail_url: str = Field(default="", max_length=1000)
    thumbnail_data_url: str = Field(default="", max_length=200000)
    language: str = Field(default="", max_length=20)
    is_off_vocal: bool = False
    has_lyrics: bool = False
    genres: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    lyrics: str = Field(default="", max_length=20000)


class SongSuggestUpdateResponse(BaseModel):
    status: str
    message: str
    draft: SongSuggestIdentifyResponse
