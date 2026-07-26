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
    ai_web_researcher_model: str = ""
    ai_language_identifier_model: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
