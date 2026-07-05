use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Unified error type for the entire application.
#[derive(thiserror::Error, Debug)]
pub enum AppError {
    #[error("Bad request: {0}")]
    BadRequest(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Unauthorized: {0}")]
    Unauthorized(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("SSH error: {0}")]
    Ssh(String),

    #[error("Docker error: {0}")]
    Docker(String),

    #[error("Plugin error: {0}")]
    Plugin(String),

    #[error("Rate limited")]
    RateLimited,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, msg) = match &self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, 400, msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, 404, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, 401, msg.clone()),
            AppError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, 429, "Too many requests".into()),
            _ => {
                tracing::error!("Internal error: {:?}", &self);
                (StatusCode::INTERNAL_SERVER_ERROR, 500, "Internal error".into())
            }
        };

        let body = json!({
            "code": code,
            "msg": msg,
            "data": null
        });

        (status, Json(body)).into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Internal(format!("{:#}", e))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::StatusCode;

    #[test]
    fn test_bad_request() {
        let err = AppError::BadRequest("invalid input".into());
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[test]
    fn test_not_found() {
        let err = AppError::NotFound("resource not found".into());
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn test_unauthorized() {
        let err = AppError::Unauthorized("invalid token".into());
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[test]
    fn test_rate_limited() {
        let err = AppError::RateLimited;
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn test_internal_error() {
        let err = AppError::Internal("something went wrong".into());
        let resp = err.into_response();
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_ssh_error() {
        let err = AppError::Ssh("connection refused".into());
        let resp = err.into_response();
        // SSH errors map to 500 Internal
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_display_trait() {
        let err = AppError::BadRequest("bad".into());
        assert_eq!(format!("{}", err), "Bad request: bad");

        let err = AppError::RateLimited;
        assert_eq!(format!("{}", err), "Rate limited");
    }

    #[test]
    fn test_from_anyhow() {
        let any_err = anyhow::anyhow!("disk full");
        let app_err: AppError = any_err.into();
        match app_err {
            AppError::Internal(_) => {} // expected
            _ => panic!("Expected Internal variant"),
        }
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file missing");
        let app_err: AppError = io_err.into();
        match app_err {
            AppError::Internal(_) => {} // expected
            _ => panic!("Expected Internal variant"),
        }
    }

    #[test]
    fn test_from_serde_json_error() {
        let serde_err = serde_json::from_str::<serde_json::Value>("{invalid}").unwrap_err();
        let app_err: AppError = serde_err.into();
        match app_err {
            AppError::Internal(_) => {} // expected
            _ => panic!("Expected Internal variant"),
        }
    }
}
