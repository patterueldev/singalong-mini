from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql+psycopg://postgres:postgres@db:5432/singalong"
    app_name: str = "Singalong Backend"
    app_env: str = "development"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    singalong_admin_username: str = "admin"
    singalong_admin_password: str = "password"
    admin_static_dir: str = "/app/static/admin"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")


settings = Settings()
