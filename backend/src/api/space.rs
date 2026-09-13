use axum::Json;
use axum::extract::{Extension, State};
use axum::http::{HeaderMap, header};
use axum::response::IntoResponse;
use std::sync::Arc;

use crate::app_state::AppState;
use crate::db::SPACE_SCOPED_TABLES;
use crate::response::{ApiError, ApiResponse};
use crate::space::{self, SpaceCtx};

/// GET /api/space/me —— 当前访问者的空间信息（不含空间码：服务端只有哈希）。
#[derive(serde::Serialize)]
pub struct SpaceInfoResponse {
    pub id: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "lastSeenAt")]
    pub last_seen_at: String,
    /// 是否为「历史数据认领空间」（升级前的数据所在空间）
    #[serde(rename = "isLegacy")]
    pub is_legacy: bool,
    /// 本空间各业务表行数
    pub counts: Vec<TableCount>,
}

#[derive(serde::Serialize)]
pub struct TableCount {
    pub table: String,
    pub count: i64,
}

#[derive(serde::Deserialize)]
pub struct AttachRequest {
    pub code: String,
}

#[derive(serde::Serialize)]
pub struct AttachResponse {
    pub id: String,
    pub attached: bool,
    #[serde(rename = "isLegacy")]
    pub is_legacy: bool,
}

#[derive(serde::Serialize)]
pub struct RotateResponse {
    /// 新的空间码（只返回这一次；服务端只存哈希）
    pub code: String,
    #[serde(rename = "previousInvalidated")]
    pub previous_invalidated: bool,
}

fn is_https(headers: &HeaderMap) -> bool {
    headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(',').next().unwrap_or("").trim().eq_ignore_ascii_case("https"))
        .unwrap_or(false)
}

fn cookie_headers(code: &str, headers: &HeaderMap) -> HeaderMap {
    let mut out = HeaderMap::new();
    if let Ok(value) = header::HeaderValue::from_str(&space::cookie_header_value(code, is_https(headers))) {
        out.insert(header::SET_COOKIE, value);
    }
    out
}

/// GET /api/space/me
pub async fn me(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
) -> ApiResponse<SpaceInfoResponse> {
    let counts = match state.db.as_ref() {
        Some(db) => db
            .list_table_counts(&space.id)
            .await
            .unwrap_or_else(|_| SPACE_SCOPED_TABLES.iter().map(|t| ((*t).to_string(), 0)).collect()),
        None => SPACE_SCOPED_TABLES.iter().map(|t| ((*t).to_string(), 0)).collect(),
    };

    let (created_at, last_seen_at) = match state.db.as_ref() {
        Some(db) => match db.find_space_by_id(&space.id).await {
            Ok(Some(row)) => (row.created_at, row.last_seen_at),
            _ => (String::new(), String::new()),
        },
        None => (String::new(), String::new()),
    };

    ApiResponse::success(SpaceInfoResponse {
        id: space.id.clone(),
        created_at,
        last_seen_at,
        is_legacy: space.is_legacy(),
        counts: counts
            .into_iter()
            .map(|(table, count)| TableCount { table, count })
            .collect(),
    })
}

/// POST /api/space/rotate —— 重新生成空间码（旧码与旧 cookie 立即失效）。
pub async fn rotate(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, ApiError> {
    let code = space::rotate(&state, &space.id)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to rotate space code: {e}")))?;

    state.add_audit_log("space_code_rotated", serde_json::json!({}), "unknown", &space.id);

    Ok((
        cookie_headers(&code, &headers),
        ApiResponse::success(RotateResponse { code, previous_invalidated: true }),
    ))
}

/// POST /api/space/attach —— 用空间码把当前浏览器切到该空间（换设备 / 恢复）。
///
/// 认领遗留数据也走这里：认领成功后标记空间已认领，服务端不再打印认领码。
pub async fn attach(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Json(payload): Json<AttachRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let space = space::attach(&state, &payload.code)
        .await
        .map_err(ApiError::bad_request)?;

    // 认领遗留空间：之后不再打印认领码，并确保历史数据归属正确
    if space.id == space::LEGACY_SPACE_ID && !space.claimed {
        if let Some(db) = state.db.as_ref() {
            let adopted = db.adopt_legacy_rows(&space.id).await.unwrap_or(0);
            let _ = db.mark_space_claimed(&space.id).await;
            // 清掉临时保存的认领码（仅迁移期需要）
            let _ = db.set_setting("legacy_claim_code", "").await;
            tracing::info!("[space] legacy space claimed; {adopted} rows adopted");
        }
        state.add_audit_log("legacy_data_claimed", serde_json::json!({}), "unknown", &space.id);
    }

    state.add_audit_log("space_attached", serde_json::json!({}), "unknown", &space.id);

    Ok((
        cookie_headers(&payload.code, &headers),
        ApiResponse::success(AttachResponse {
            id: space.id.clone(),
            attached: true,
            is_legacy: space.id == space::LEGACY_SPACE_ID,
        }),
    ))
}
