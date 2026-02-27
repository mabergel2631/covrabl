from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./covrabl.db"
    s3_endpoint: str = "localhost:9000"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = "covrabl"

    jwt_key: str = "default-secret-change-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 10080  # 7 days

    llm_provider: str = "anthropic"  # "anthropic" or "openai"
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    cors_origins: str = ""

    resend_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    from_email: str = "noreply@covrabl.com"
    app_url: str = "http://localhost:3000"

    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_basic_monthly_price_id: str = ""
    stripe_basic_annual_price_id: str = ""
    stripe_pro_monthly_price_id: str = ""
    stripe_pro_annual_price_id: str = ""
    stripe_business_monthly_price_id: str = ""
    stripe_business_annual_price_id: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"


settings = Settings()
