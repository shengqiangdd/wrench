use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::IntoResponse,
};
use bytes::Bytes;
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tracing::info;

use crate::app_state::AppState;

/// WebSocket log stream handler (/ws/logs)
pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<Arc<AppState>>) -> axum::response::Response {
    // 与终端共用同一档 WS 并发闸门：每条日志流也是一个长连接 + 任务，
    // 不设上限时它同样能用来把实例的连接数堆满。
    let Some(slot) = state.try_open_ws() else {
        return (
            axum::http::StatusCode::SERVICE_UNAVAILABLE,
            axum::Json(serde_json::json!({
                "error": "Too many open WebSocket connections on this instance. Please retry later.",
                "code": "ws_limit_reached",
            })),
        )
            .into_response();
    };
    ws.on_upgrade(move |socket| async move {
        let _slot = slot;
        handle_logs_socket(socket, state).await
    })
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
