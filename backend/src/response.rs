use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// Standard API response matching the original Node.js format:
/// `{ "success": true/false, "code": 0, "msg": "success", "data": ..., "error": "..." }`
#[derive(Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub code: i32,
    pub msg: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self { success: true, code: 0, msg: "success".into(), data: Some(data), error: None }
    }

    pub fn success_msg(msg: &str) -> Self {
        Self { success: true, code: 0, msg: msg.into(), data: None, error: None }
    }

    pub fn error(code: i32, msg: &str) -> Self {
        Self { success: false, code, msg: msg.into(), data: None, error: Some(msg.into()) }
    }
}

/// 需要真实 HTTP 状态码的 API 错误（`ApiResponse` 恒为 200，客户端无法区分
/// “口令错误” 与 “服务端故障”，认证/空间类接口必须用真实状态码）。
pub struct ApiError {
    status: axum::http::StatusCode,
    message: String,
}

impl ApiError {
    pub fn new(status: axum::http::StatusCode, message: impl Into<String>) -> Self {
        Self { status, message: message.into() }
    }
    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(axum::http::StatusCode::BAD_REQUEST, message)
    }
    pub fn unauthorized(message: impl Into<String>) -> Self {
        Self::new(axum::http::StatusCode::UNAUTHORIZED, message)
    }
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(axum::http::StatusCode::FORBIDDEN, message)
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(axum::http::StatusCode::NOT_FOUND, message)
    }
    pub fn not_configured() -> Self {
        Self::new(
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            "Authentication not configured. Use the one-time setup token from the server logs to set the entry password.",
        )
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(axum::http::StatusCode::INTERNAL_SERVER_ERROR, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let code = self.status.as_u16() as i32;
        let body = axum::Json(serde_json::json!({
            "success": false,
            "code": code,
            "msg": self.message,
            "error": self.message,
            "data": serde_json::Value::Null,
        }));
        (self.status, body).into_response()
    }
}

/// Convert any ApiResponse into an HTTP response.
impl<T: Serialize> IntoResponse for ApiResponse<T> {
    fn into_response(self) -> Response {
        axum::Json(self).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_success_response() {
        let resp = ApiResponse::success(42i32);
        assert!(resp.success);
        assert_eq!(resp.code, 0);
        assert_eq!(resp.msg, "success");
        assert_eq!(resp.data, Some(42));
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_success_msg() {
        let resp: ApiResponse<()> = ApiResponse::success_msg("done");
        assert!(resp.success);
        assert_eq!(resp.code, 0);
        assert_eq!(resp.msg, "done");
        assert!(resp.data.is_none());
        assert!(resp.error.is_none());
    }

    #[test]
    fn test_error_response() {
        let resp: ApiResponse<()> = ApiResponse::error(1, "something went wrong");
        assert!(!resp.success);
        assert_eq!(resp.code, 1);
        assert_eq!(resp.msg, "something went wrong");
        assert!(resp.data.is_none());
        assert_eq!(resp.error, Some("something went wrong".into()));
    }

    #[test]
    fn test_error_empty_msg() {
        let resp: ApiResponse<()> = ApiResponse::error(-1, "");
        assert!(!resp.success);
        assert_eq!(resp.code, -1);
        assert_eq!(resp.error, Some("".into()));
    }

    #[test]
    fn test_error_with_data_type() {
        let resp = ApiResponse::success(vec![1, 2, 3]);
        assert!(resp.success);
        assert_eq!(resp.data, Some(vec![1, 2, 3]));
    }
}
