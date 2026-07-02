use std::sync::Arc;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
};
use base64::Engine as _;
use tracing::{info, warn};

use crate::app_state::AppState;

/// Helper to convert string to Utf8Bytes
fn txt(s: String) -> axum::extract::ws::Utf8Bytes {
    axum::extract::ws::Utf8Bytes::from(s)
}

/// Main WebSocket handler — the one the frontend actually connects to.
/// Dispatches messages by `type` field.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: Arc<AppState>) {
    info!("WebSocket connected");

    // Track active terminal sessions: connection_id -> (SshSession, Channel)
    // We manage the channel lifecycle per WebSocket connection

    // ─── Main message loop ───
    loop {
        match socket.recv().await {
            Some(Ok(Message::Text(text))) => {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                    let msg_type = parsed
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");

                    match msg_type {
                        "ping" => {
                            let pong = serde_json::json!({"type":"pong"});
                            let _ = socket.send(Message::Text(txt(pong.to_string()))).await;
                        }
                        "connect" => {
                            // Terminal connect: look up SSH session and open shell
                            handle_terminal_connect(&mut socket, &state, &parsed).await;
                            // After connect, the terminal session starts
                            // We need to enter the terminal I/O loop
                            info!("Terminal session started, entering I/O loop");
                            // Note: handle_terminal_connect now manages the full terminal lifecycle
                            break;
                        }
                        "exec" => {
                            // Simple command exec (non-interactive)
                            handle_simple_exec(&mut socket, &state, &parsed).await;
                        }
                        "disconnect" => {
                            let conn_id = parsed
                                .get("connectionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if !conn_id.is_empty() {
                                // Remove from connections map if present
                                let _ = state.connections.remove(conn_id);
                                let ack = serde_json::json!({
                                    "type": "disconnected",
                                    "connectionId": conn_id
                                });
                                let _ = socket.send(Message::Text(txt(ack.to_string()))).await;
                            }
                        }
                        _ => {
                            warn!("Unknown message type: {}", msg_type);
                            let err = serde_json::json!({
                                "type": "error",
                                "message": format!("Unknown message type: {}", msg_type)
                            });
                            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
                        }
                    }
                }
            }
            Some(Ok(Message::Close(_))) | None => {
                info!("WebSocket closed");
                break;
            }
            Some(Ok(Message::Binary(_))) => {
                // Binary messages currently unsupported
            }
            Some(Err(e)) => {
                warn!("WebSocket error: {:?}", e);
                break;
            }
            _ => break,
        }
    }

    info!("WebSocket disconnected");
}

/// Handle "connect" message — open an interactive SSH shell and enter I/O loop.
async fn handle_terminal_connect(socket: &mut WebSocket, state: &Arc<AppState>, msg: &serde_json::Value) {
    let connection_id = msg
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();

    let cols = msg.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u32;
    let rows = msg.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u32;

    // Look up SSH session from the connection pool
    let session = {
        let entry = state.connections.get(&connection_id);
        entry.and_then(|c| c.session.clone())
    };

    let session = match session {
        Some(s) => s,
        None => {
            let err = serde_json::json!({
                "type": "error",
                "connectionId": connection_id,
                "message": "SSH session not found or not connected"
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Open interactive shell
    let mut channel = match session.open_shell(cols, rows).await {
        Ok(ch) => ch,
        Err(e) => {
            let err = serde_json::json!({
                "type": "error",
                "connectionId": connection_id,
                "message": format!("Shell open failed: {}", e)
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Send connected acknowledgment
    let ack = serde_json::json!({
        "type": "connected",
        "connectionId": connection_id
    });
    if socket.send(Message::Text(txt(ack.to_string()))).await.is_err() {
        return;
    }

    info!("Terminal session connected: {}", connection_id);

    // ─── Terminal I/O Loop ───
    loop {
        tokio::select! {
            // Incoming from WebSocket (user keystrokes / resize)
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                            let msg_type = parsed
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            match msg_type {
                                "exec" => {
                                    if let Some(data) = parsed.get("data").and_then(|v| v.as_str()) {
                                        // Base64 decode user input for the terminal
                                        let decoded = base64::engine::general_purpose::STANDARD
                                            .decode(data)
                                            .unwrap_or_else(|_| data.as_bytes().to_vec());
                                        if channel.data(decoded.as_slice()).await.is_err() {
                                            info!("SSH channel write error");
                                            break;
                                        }
                                    }
                                }
                                "resize" => {
                                    let new_cols = parsed.get("cols").and_then(|v| v.as_u64()).unwrap_or(80) as u32;
                                    let new_rows = parsed.get("rows").and_then(|v| v.as_u64()).unwrap_or(24) as u32;
                                    let _ = channel
                                        .request_pty(false, "xterm-256color", new_cols, new_rows, 0, 0, &[])
                                        .await;
                                }
                                "ping" => {
                                    let pong = serde_json::json!({"type":"pong"});
                                    let _ = socket.send(Message::Text(txt(pong.to_string()))).await;
                                }
                                _ => {
                                    warn!("Unknown terminal message type: {}", msg_type);
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("Terminal WebSocket closed by client");
                        break;
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Err(e)) => {
                        warn!("Terminal WebSocket error: {:?}", e);
                        break;
                    }
                    _ => break,
                }
            }

            // Outgoing to WebSocket (SSH terminal output via channel.wait())
            msg = channel.wait() => {
                use russh::ChannelMsg;
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        let encoded = base64::engine::general_purpose::STANDARD.encode(data);
                        let output = serde_json::json!({
                            "type": "data",
                            "connectionId": connection_id,
                            "data": encoded
                        });
                        if socket.send(Message::Text(txt(output.to_string()))).await.is_err() {
                            break;
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        info!("SSH channel closed (connection: {})", connection_id);
                        break;
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        info!("SSH shell exited with status: {}", exit_status);
                        break;
                    }
                    _ => {
                        // Ignore other channel messages
                    }
                }
            }
        }
    }

    // Send disconnected notification
    let disc = serde_json::json!({
        "type": "disconnected",
        "connectionId": connection_id
    });
    let _ = socket.send(Message::Text(txt(disc.to_string()))).await;
    info!("Terminal session ended: {}", connection_id);
}

/// Handle simple "exec" — run a command and return the result.
async fn handle_simple_exec(socket: &mut WebSocket, state: &Arc<AppState>, msg: &serde_json::Value) {
    let connection_id = msg
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if connection_id.is_empty() {
        let err = serde_json::json!({
            "type": "error",
            "message": "Missing connectionId"
        });
        let _ = socket.send(Message::Text(txt(err.to_string()))).await;
        return;
    }

    let command = msg
        .get("command")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if command.is_empty() {
        let err = serde_json::json!({
            "type": "error",
            "connectionId": connection_id,
            "message": "Missing command"
        });
        let _ = socket.send(Message::Text(txt(err.to_string()))).await;
        return;
    }

    // For simple exec, we also allow SSH sessions from the connection pool
    let session = {
        let entry = state.connections.get(connection_id);
        entry.and_then(|c| c.session.clone())
    };

    match session {
        Some(s) => {
            match s.exec(command).await {
                Ok((stdout, _stderr, _exit_code)) => {
                    let resp = serde_json::json!({
                        "type": "data",
                        "connectionId": connection_id,
                        "data": base64::engine::general_purpose::STANDARD.encode(stdout.as_bytes())
                    });
                    let _ = socket.send(Message::Text(txt(resp.to_string()))).await;
                }
                Err(e) => {
                    let err = serde_json::json!({
                        "type": "error",
                        "connectionId": connection_id,
                        "message": format!("Command exec failed: {}", e)
                    });
                    let _ = socket.send(Message::Text(txt(err.to_string()))).await;
                }
            }
        }
        None => {
            let err = serde_json::json!({
                "type": "error",
                "connectionId": connection_id,
                "message": "SSH session not found"
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
        }
    }
}
