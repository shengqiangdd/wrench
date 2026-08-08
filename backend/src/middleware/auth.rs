use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use std::sync::Arc;

use crate::app_state::AppState;

/// Validate a token against the in-memory WS token store.
///
/// Returns `true` if the token is valid (exists and not expired).
/// Consumes the token (one-time use).
fn validate_token(state: &Arc<AppState>, token: &str) -> bool {
    // Check validity in a block so the Ref (read-lock) is dropped before remove
    // to avoid DashMap read→write deadlock on the same shard.
    let is_valid = {
        let entry = state.ws_tokens.get(token);
        match entry {
            Some(info) => info.expires_at >= chrono::Utc::now(),
            None => false,
        }
    };

    if is_valid {
        state.ws_tokens.remove(token);
        true
    } else {
        false
    }
}

/// Validate a JWT token using the app's JWT service.
///
/// Returns `true` if the token is valid and not expired.
fn validate_jwt(state: &Arc<AppState>, token: &str) -> bool {
    let service = state.jwt_service.read();
    let service = match service.as_ref() {
        Some(s) => s,
        None => return false,
    };

    match service.verify(token) {
        Ok(token_data) => {
            let now = chrono::Utc::now().timestamp() as u64;
            token_data.claims.exp > now
        }
        Err(_) => false,
    }
}

/// Authentication middleware for REST API and WebSocket routes.
///
/// Supports two authentication methods:
/// 1. Legacy one-time WS tokens (validated through `ws_tokens` store)
/// 2. JWT tokens (validated through signature and expiration)
///
/// Routes that don't need auth (/api/health, /api/ws-token, static files)
/// should be mounted outside the protected router.
pub async fn auth_middleware(State(state): State<Arc<AppState>>, req: Request<Body>, next: Next) -> Response {
    let method = req.method();
    let uri = req.uri().to_string();
    let is_upgrade = req.headers().get("upgrade").and_then(|v| v.to_str().ok()).unwrap_or("") == "websocket";

    // Always allow OPTIONS (CORS preflight)
    if method == axum::http::Method::OPTIONS {
        return next.run(req).await;
    }

    // Extract token from Authorization header (preferred, secure).
    let token_from_header = req
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|h| {
            let parts: Vec<&str> = h.split_whitespace().collect();
            if parts.len() == 2 && parts[0].eq_ignore_ascii_case("Bearer") {
                Some(parts[1].to_string())
            } else {
                None
            }
        });

    // DEPRECATED: query parameter fallback for WebSocket upgrade requests.
    // Browser WebSocket API does not support custom headers, so query param
    // is the only option during the transition period. It will be replaced
    // by first-message authentication in a future release.
    let token = if let Some(t) = token_from_header {
        Some(t)
    } else {
        let qt = req.uri().query().and_then(|q| {
            q.split('&').find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                if parts.next()? == "token" {
                    parts.next().map(|v| v.to_string())
                } else {
                    None
                }
            })
        });
        if qt.is_some() {
            tracing::warn!(
                "[auth] {} {} — DEPRECATED: Token via query parameter is insecure (exposed in server logs, browser history, proxy logs). Migrate to Authorization header or first-message auth.",
                method, uri
            );
        }
        qt
    };

    match token {
        Some(t) if validate_token(&state, &t) => {
            tracing::info!("[auth] {} {} — one-time token OK (upgrade={})", method, uri, is_upgrade);
            next.run(req).await
        }
        Some(t) if validate_jwt(&state, &t) => {
            tracing::info!("[auth] {} {} — JWT OK (upgrade={})", method, uri, is_upgrade);
            next.run(req).await
        }
        Some(t) => {
            // Enhanced diagnostics: try to decode the JWT to identify the exact failure reason
            let has_jwt_service = state.jwt_service.read().is_some();
            let token_preview = if t.len() > 20 { format!("{}...{}", &t[..10], &t[t.len()-5..]) } else { t.clone() };

            // Try to manually decode to find failure reason
            let decode_hint = if let Some(service) = state.jwt_service.read().as_ref() {
                match service.verify(&t) {
                    Ok(claims) => format!("signature OK, exp={}, now={}", claims.claims.exp, chrono::Utc::now().timestamp() as u64),
                    Err(e) => format!("verify failed: {:?}", e),
                }
            } else {
                "jwt_service is None".to_string()
            };

            tracing::warn!(
                "[auth] {} {} — REJECTED token_len={} upgrade={} preview=[{}] jwt_service={} hint=[{}]",
                method, uri, t.len(), is_upgrade, token_preview, has_jwt_service, decode_hint
            );
            let body = serde_json::json!({
                "error": "Unauthorized: invalid or expired token. Call POST /api/ws-token first."
            })
            .to_string();
            Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()
        }
        None => {
            tracing::warn!("[auth] {} {} — NO TOKEN (upgrade={})", method, uri, is_upgrade);
            let body = serde_json::json!({
                "error": "Unauthorized: no token provided."
            })
            .to_string();
            Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .header(axum::http::header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::app_state::WsTokenInfo;
    use crate::config::AppConfig;
    use std::path::PathBuf;
    use std::sync::Arc;

    fn make_state() -> Arc<AppState> {
        let config = AppConfig {
            host: "0.0.0.0".into(),
            port: 3001,
            frontend_dist: PathBuf::from("./frontend/dist"),
            plugins_dir: PathBuf::from("/tmp/plugins"),
            cors_origins: vec!["*".into()],
            openrouter_api_key: None,
            jwt_secret: "test-jwt-secret".into(),
            vault_key: None,
            database_url: None,
            log_level: "warn".into(),
        };
        Arc::new(AppState {
            config,
            db: None,
            connections: dashmap::DashMap::new(),
            docker_clients: dashmap::DashMap::new(),
            alerts: parking_lot::RwLock::new(Vec::new()),
            audit_logs: parking_lot::RwLock::new(Vec::new()),
            ws_tokens: dashmap::DashMap::new(),
            marketplace_cache: parking_lot::RwLock::new(None),
            active_logtails: dashmap::DashMap::new(),
            jwt_service: parking_lot::RwLock::new(None),
            start_time: std::time::Instant::now(),
        })
    }

    #[test]
    fn test_validate_token_valid() {
        let state = make_state();
        // Insert a valid token
        state.ws_tokens.insert(
            "valid-token-123".into(),
            WsTokenInfo {
                token: "valid-token-123".into(),
                ip: "127.0.0.1".into(),
                expires_at: chrono::Utc::now() + chrono::Duration::hours(1),
            },
        );

        assert!(validate_token(&state, "valid-token-123"));
        // Token should be consumed (one-time use)
        assert!(!validate_token(&state, "valid-token-123"));
    }

    #[test]
    fn test_validate_token_invalid() {
        let state = make_state();
        assert!(!validate_token(&state, "nonexistent-token"));
    }

    #[test]
    fn test_validate_token_expired() {
        let state = make_state();
        state.ws_tokens.insert(
            "expired-token".into(),
            WsTokenInfo {
                token: "expired-token".into(),
                ip: "127.0.0.1".into(),
                expires_at: chrono::Utc::now() - chrono::Duration::seconds(1),
            },
        );

        assert!(!validate_token(&state, "expired-token"));
    }

    #[test]
    fn test_validate_token_one_time_use() {
        let state = make_state();
        state.ws_tokens.insert(
            "one-time".into(),
            WsTokenInfo {
                token: "one-time".into(),
                ip: "10.0.0.1".into(),
                expires_at: chrono::Utc::now() + chrono::Duration::hours(2),
            },
        );

        // First call succeeds
        assert!(validate_token(&state, "one-time"));
        // Second call fails (consumed)
        assert!(!validate_token(&state, "one-time"));
        // Third call still fails
        assert!(!validate_token(&state, "one-time"));
    }
}
