use axum::response::{IntoResponse, Response};
use serde::Serialize;

/// Standard API response matching the original Node.js format:
/// `{ "code": 0, "data": ..., "msg": "success" }`
#[derive(Serialize)]
pub struct ApiResponse<T: Serialize> {
    pub code: i32,
    pub msg: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<T>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            code: 0,
            msg: "success".into(),
            data: Some(data),
        }
    }

    pub fn success_msg(msg: &str) -> Self {
        Self {
            code: 0,
            msg: msg.into(),
            data: None,
        }
    }

    pub fn error(code: i32, msg: &str) -> Self {
        Self {
            code,
            msg: msg.into(),
            data: None,
        }
    }
}

/// Convert any ApiResponse into an HTTP response.
impl<T: Serialize> IntoResponse for ApiResponse<T> {
    fn into_response(self) -> Response {
        axum::Json(self).into_response()
    }
}
