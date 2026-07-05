use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::info;

use crate::app_state::AppState;

/// WebSocket Docker stats handler (/ws/docker/stats)
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_docker_stats_socket(socket, state))
}

async fn handle_docker_stats_socket(socket: WebSocket, _state: Arc<AppState>) {
    info!("Docker stats WebSocket connected");

    let (mut sender, mut receiver) = socket.split();

    let send_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
            let stats = serde_json::json!({
                "cpu_percent": 0.0,
                "mem_usage": 0,
                "mem_limit": 0,
                "timestamp": chrono::Utc::now().to_rfc3339()
            });
            let msg = Message::Text(serde_json::to_string(&stats).unwrap().into());
            if sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    tracing::warn!("Docker stats WS error: {:?}", e);
                    break;
                }
                _ => {}
            }
        }
    });

    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    info!("Docker stats WebSocket disconnected");
}
