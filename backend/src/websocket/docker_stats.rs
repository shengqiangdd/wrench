use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use std::sync::Arc;
use tracing::info;

use crate::app_state::AppState;

/// WebSocket Docker stats handler (/ws/docker/stats)
///
/// This endpoint is **deprecated**. Docker stats are now served via the
/// REST API `GET /api/docker/stats`. The WebSocket handler sends a
/// deprecation notice and closes the connection immediately.
pub async fn ws_handler(ws: WebSocketUpgrade, State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(handle_docker_stats_socket)
}

async fn handle_docker_stats_socket(mut socket: WebSocket) {
    info!("Docker stats WebSocket connected (legacy stub — closing)");
    let msg = serde_json::json!({
        "type": "error",
        "message": "Docker stats WebSocket is deprecated. Use REST API /api/docker/stats instead."
    });
    let _ = socket
        .send(Message::Text(
            serde_json::to_string(&msg).unwrap().into(),
        ))
        .await;
    let _ = socket.send(Message::Close(None)).await;
}
