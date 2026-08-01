from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@db:5432/singalong"
    app_name: str = "Singalong Backend"
    app_env: str = "development"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8000"
    singalong_admin_username: str = "admin"
    singalong_admin_password: str = "password"
    client_static_dir: str = "/app/static/client"
    jwt_secret_key: str = "singalong-dev-jwt-secret"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 43200
    media_root_dir: str = "/data/media"
    songs_media_dir: str = "/data/media/songs"
    ytdlp_cookies_file: str = "/data/cookies.txt"
    singalong_base_url: str = "http://localhost:9000"

    ai_provider: str = "deepseek"
    openai_api_key: str = ""
    deepseek_api_key: str = ""

    ai_title_guesser_model: str = ""
    ai_off_vocal_detector_model: str = ""
    ai_content_classifier_model: str = ""
    ai_title_researcher_model: str = ""
    ai_artist_researcher_model: str = ""
    ai_genre_classifier_model: str = ""
    ai_tags_suggester_model: str = ""
    ai_language_identifier_model: str = ""
    ai_lyrics_researcher_model: str = ""

    brave_api_key: str = ""
    enable_lyrics_web_search: bool = True
    enable_metadata_web_search: bool = True

    # Bounded concurrency for ad-hoc yt-dlp metadata/search calls (search, identify, enhance).
    # See app/services/ytdlp/work_queue.py — keeps concurrent yt-dlp instances (and their sockets
    # and temp files) from exhausting file descriptors when several people search at once.
    ytdlp_search_concurrency: int = 2
    ytdlp_queue_max_wait_seconds: int = 20
    ytdlp_call_timeout_seconds: int = 45
    ytdlp_search_cache_ttl_seconds: int = 90

    # Scheduled DB backup + integrity canary (see app/tasks/db_backup_task.py, db_health_task.py).
    db_backup_dir: str = "/data/backups"
    db_backup_interval_hours: int = 6
    db_backup_retention_count: int = 20
    db_health_check_interval_minutes: int = 30

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
