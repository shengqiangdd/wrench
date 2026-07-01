use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::info;

use crate::app_state::AppState;

/// WebSocket log stream handler (/ws/logs)
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_logs_socket(socket, state))
}

async fn handle_logs_socket(socket: WebSocket, _state: Arc<AppState>) {
    info!("Logs WebSocket connected");

    let (mut sender, mut receiver) = socket.split();

    let send_task = tokio::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
            if sender.send(Message::Ping(Bytes::new())).await.is_err() {
                break;
            }
        }
    });

    let recv_task = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Text(_text)) => {}
                Ok(Message::Close(_)) => break,
                Err(e) => {
                    tracing::warn!("Logs WS error: {:?}", e);
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

    info!("Logs WebSocket disconnected");
}
