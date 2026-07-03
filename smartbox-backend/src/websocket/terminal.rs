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
                            // handle_terminal_connect manages the full I/O loop, then returns
                            // After it returns, the terminal session is done
                            info!("Terminal session ended, back to main loop");
                        }
                        "sftp" => {
                            // SFTP operation: handle via SSH SFTP subsystem
                            handle_sftp_operation(&mut socket, &state, &parsed).await;
                        }
                        "logtail_start" => {
                            // Log tail: runs SSH tail -f and streams output
                            handle_logtail_start(&mut socket, &state, &parsed).await;
                            info!("Logtail session ended, back to main loop");
                        }
                        "logtail_stop" => {
                            // If we receive a stop in the main loop (e.g. disconnect),
                            // cancel any active logtail for this connection
                            let conn_id = parsed
                                .get("connectionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let log_path = parsed
                                .get("logPath")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let key = format!("{}:{}", conn_id, log_path);
                            if let Some((_, sender)) = state.active_logtails.remove(&key) {
                                let _ = sender.send(());
                            }
                        }
                        "disconnect" => {
                            let conn_id = parsed
                                .get("connectionId")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if !conn_id.is_empty() {
                                let _ = state.connections.remove(conn_id);
                                let ack = serde_json::json!({
                                    "type": "disconnected",
                                    "connectionId": conn_id
                                });
                                let _ = socket.send(Message::Text(txt(ack.to_string()))).await;
                            }
                        }
                        "docker_shell" => {
                            handle_docker_shell(&mut socket, &state, &parsed).await;
                            info!("Docker shell session ended, back to main loop");
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
            Some(Ok(Message::Binary(_))) => {}
            Some(Err(e)) => {
                warn!("WebSocket error: {:?}", e);
                break;
            }
            _ => break,
        }
    }

    info!("WebSocket disconnected");
}

// ========== Terminal (interactive shell) ==========

/// Handle "connect" message — open an interactive SSH shell and enter I/O loop.
async fn handle_terminal_connect(
    socket: &mut WebSocket,
    state: &Arc<AppState>,
    msg: &serde_json::Value,
) {
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
    if socket
        .send(Message::Text(txt(ack.to_string())))
        .await
        .is_err()
    {
        return;
    }

    info!("Terminal session connected: {}", connection_id);

    // ─── Terminal I/O Loop with output batching ───
    // Batching reduces WebSocket message count by accumulating SSH output
    // and flushing on size threshold (16KB) or time interval (50ms).
    let flush_timer = tokio::time::sleep(std::time::Duration::from_millis(50));
    tokio::pin!(flush_timer);
    let mut output_buffer: Vec<u8> = Vec::new();

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
                                    if msg_type != "sftp" {
                                        warn!("Unknown terminal message type: {}", msg_type);
                                    }
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
            // Data is accumulated in output_buffer and flushed in batch
            msg = channel.wait() => {
                use russh::ChannelMsg;
                match msg {
                    Some(ChannelMsg::Data { ref data }) => {
                        output_buffer.extend_from_slice(data);
                        // Flush immediately if buffer exceeds 16KB threshold
                        if output_buffer.len() > 16_384 {
                            let encoded = base64::engine::general_purpose::STANDARD.encode(&output_buffer);
                            output_buffer.clear();
                            let output = serde_json::json!({
                                "type": "data",
                                "connectionId": connection_id,
                                "data": encoded
                            });
                            if socket.send(Message::Text(txt(output.to_string()))).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                        // Flush remaining buffered data before break
                        send_buffered_data(&mut output_buffer, socket, &connection_id).await;
                        info!("SSH channel closed (connection: {})", connection_id);
                        break;
                    }
                    Some(ChannelMsg::ExitStatus { exit_status }) => {
                        // Flush remaining buffered data before break
                        send_buffered_data(&mut output_buffer, socket, &connection_id).await;
                        info!("SSH shell exited with status: {}", exit_status);
                        break;
                    }
                    _ => {}
                }
            }

            // Periodic flush timer — ensures max 50ms latency for small chunks
            _ = &mut flush_timer => {
                if !output_buffer.is_empty() {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&output_buffer);
                    output_buffer.clear();
                    let output = serde_json::json!({
                        "type": "data",
                        "connectionId": connection_id,
                        "data": encoded
                    });
                    if socket.send(Message::Text(txt(output.to_string()))).await.is_err() {
                        break;
                    }
                }
                flush_timer.as_mut().reset(
                    tokio::time::Instant::now() + std::time::Duration::from_millis(50)
                );
            }
        }
    }

    let disc = serde_json::json!({
        "type": "disconnected",
        "connectionId": connection_id
    });
    let _ = socket.send(Message::Text(txt(disc.to_string()))).await;
    info!("Terminal session ended: {}", connection_id);
}

// ========== SFTP Operations ==========

async fn handle_sftp_operation(
    socket: &mut WebSocket,
    state: &Arc<AppState>,
    msg: &serde_json::Value,
) {
    let connection_id = match msg.get("connectionId").and_then(|v| v.as_str()) {
        Some(id) => id,
        None => {
            let err = serde_json::json!({"type":"error","message":"Missing connectionId"});
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    let operation = match msg.get("operation").and_then(|v| v.as_str()) {
        Some(op) => op,
        None => {
            let err = serde_json::json!({"type":"error","message":"Missing operation"});
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Get the SSH session
    let session = {
        let entry = state.connections.get(connection_id);
        entry.and_then(|c| c.session.clone())
    };

    let session = match session {
        Some(s) => s,
        None => {
            let err = serde_json::json!({
                "type": "error",
                "connectionId": connection_id,
                "message": "SSH session not found"
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Open a temporary SFTP channel
    let sftp_result = async {
        let mut lock = session.get_handle().await;
        let handle = lock.as_mut().ok_or("SSH not connected")?;

        let channel = handle.channel_open_session().await?;
        channel.request_subsystem(true, "sftp").await?;
        let stream = channel.into_stream();
        let sftp = russh_sftp::client::SftpSession::new(stream).await?;
        Ok::<_, Box<dyn std::error::Error + Send + Sync>>(sftp)
    }.await;

    let mut sftp = match sftp_result {
        Ok(s) => s,
        Err(e) => {
            let err = serde_json::json!({
                "type": "sftp-result",
                "operation": operation,
                "success": false,
                "error": format!("SFTP open failed: {}", e)
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Dispatch to specific operation
    let result = match operation {
        "list" => handle_sftp_list(&mut sftp, msg).await,
        "readfile" => handle_sftp_readfile(&mut sftp, msg).await,
        "writefile" => handle_sftp_writefile(&mut sftp, msg).await,
        "mkdir" => handle_sftp_mkdir(&mut sftp, msg).await,
        "rmdir" => handle_sftp_rmdir(&mut sftp, msg).await,
        "unlink" => handle_sftp_unlink(&mut sftp, msg).await,
        "rename" => handle_sftp_rename(&mut sftp, msg).await,
        "stat" => handle_sftp_stat(&mut sftp, msg).await,
        other => {
            serde_json::json!({
                "type": "sftp-result",
                "operation": other,
                "success": false,
                "error": format!("Unknown SFTP operation: {}", other)
            })
        }
    };

    let _ = socket.send(Message::Text(txt(result.to_string()))).await;
}

async fn handle_sftp_list(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = msg.get("path").and_then(|v| v.as_str()).unwrap_or(".");
    match sftp.read_dir(path).await {
        Ok(entries) => {
            let files: Vec<serde_json::Value> = entries
                .map(|e| {
                    let metadata = e.metadata();
                    serde_json::json!({
                        "name": e.file_name(),
                        "path": format!("{}/{}", path.trim_end_matches('/'), e.file_name()),
                        "is_dir": metadata.is_dir(),
                        "size": metadata.len(),
                        "permissions": metadata.permissions().to_string(),
                        "modified": metadata.modified()
                            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                            .unwrap_or_default(),
                    })
                })
                .collect();
            serde_json::json!({
                "type": "sftp-result",
                "operation": "list",
                "success": true,
                "files": files
            })
        }
        Err(e) => {
            serde_json::json!({
                "type": "sftp-result",
                "operation": "list",
                "success": false,
                "error": format!("SFTP list failed: {}", e)
            })
        }
    }
}

async fn handle_sftp_readfile(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "readfile",
                "success": false, "error": "Missing path"
            });
        }
    };

    let mut file = match sftp.open(path).await {
        Ok(f) => f,
        Err(e) => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "readfile",
                "success": false, "error": format!("Open failed: {}", e)
            });
        }
    };

    use tokio::io::AsyncReadExt;
    let mut buf = Vec::new();
    match file.read_to_end(&mut buf).await {
        Ok(_) => {
            let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
            serde_json::json!({
                "type": "sftp-result",
                "operation": "readfile",
                "success": true,
                "content": encoded,
                "size": buf.len()
            })
        }
        Err(e) => {
            serde_json::json!({
                "type": "sftp-result", "operation": "readfile",
                "success": false, "error": format!("Read failed: {}", e)
            })
        }
    }
}

async fn handle_sftp_writefile(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "writefile",
                "success": false, "error": "Missing path"
            });
        }
    };

    let content_b64 = match msg.get("content").and_then(|v| v.as_str()) {
        Some(c) => c,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "writefile",
                "success": false, "error": "Missing content"
            });
        }
    };

    let data = match base64::engine::general_purpose::STANDARD.decode(content_b64) {
        Ok(d) => d,
        Err(_) => content_b64.as_bytes().to_vec(),
    };

    let mut file = match sftp
        .open_with_flags(
            path,
            russh_sftp::protocol::OpenFlags::CREATE
                | russh_sftp::protocol::OpenFlags::TRUNCATE
                | russh_sftp::protocol::OpenFlags::WRITE,
        )
        .await
    {
        Ok(f) => f,
        Err(e) => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "writefile",
                "success": false, "error": format!("Open failed: {}", e)
            });
        }
    };

    use tokio::io::AsyncWriteExt;
    match file.write_all(&data).await {
        Ok(_) => {
            serde_json::json!({
                "type": "sftp-result",
                "operation": "writefile",
                "success": true,
                "size": data.len()
            })
        }
        Err(e) => {
            serde_json::json!({
                "type": "sftp-result", "operation": "writefile",
                "success": false, "error": format!("Write failed: {}", e)
            })
        }
    }
}

async fn handle_sftp_mkdir(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "mkdir",
                "success": false, "error": "Missing path"
            });
        }
    };

    match sftp.create_dir(path).await {
        Ok(_) => serde_json::json!({ "type": "sftp-result", "operation": "mkdir", "success": true }),
        Err(e) => serde_json::json!({
            "type": "sftp-result", "operation": "mkdir",
            "success": false, "error": format!("Mkdir failed: {}", e)
        }),
    }
}

async fn handle_sftp_rmdir(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "rmdir",
                "success": false, "error": "Missing path"
            });
        }
    };

    match sftp.remove_dir(path).await {
        Ok(_) => serde_json::json!({ "type": "sftp-result", "operation": "rmdir", "success": true }),
        Err(e) => serde_json::json!({
            "type": "sftp-result", "operation": "rmdir",
            "success": false, "error": format!("Rmdir failed: {}", e)
        }),
    }
}

async fn handle_sftp_unlink(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "unlink",
                "success": false, "error": "Missing path"
            });
        }
    };

    match sftp.remove_file(path).await {
        Ok(_) => serde_json::json!({ "type": "sftp-result", "operation": "unlink", "success": true }),
        Err(e) => serde_json::json!({
            "type": "sftp-result", "operation": "unlink",
            "success": false, "error": format!("Unlink failed: {}", e)
        }),
    }
}

async fn handle_sftp_rename(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "rename",
                "success": false, "error": "Missing path"
            });
        }
    };

    let target = match msg.get("target").and_then(|v| v.as_str()) {
        Some(t) => t,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "rename",
                "success": false, "error": "Missing target"
            });
        }
    };

    match sftp.rename(path, target).await {
        Ok(_) => serde_json::json!({ "type": "sftp-result", "operation": "rename", "success": true }),
        Err(e) => serde_json::json!({
            "type": "sftp-result", "operation": "rename",
            "success": false, "error": format!("Rename failed: {}", e)
        }),
    }
}

async fn handle_sftp_stat(
    sftp: &mut russh_sftp::client::SftpSession,
    msg: &serde_json::Value,
) -> serde_json::Value {
    let path = match msg.get("path").and_then(|v| v.as_str()) {
        Some(p) => p,
        None => {
            return serde_json::json!({
                "type": "sftp-result", "operation": "stat",
                "success": false, "error": "Missing path"
            });
        }
    };

    match sftp.metadata(path).await {
        Ok(meta) => {
            serde_json::json!({
                "type": "sftp-result",
                "operation": "stat",
                "success": true,
                "size": meta.len(),
                "is_dir": meta.is_dir(),
                "permissions": meta.permissions().to_string(),
                "modified": meta.modified()
                    .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
                    .unwrap_or_default(),
            })
        }
        Err(e) => {
            serde_json::json!({
                "type": "sftp-result", "operation": "stat",
                "success": false, "error": format!("Stat failed: {}", e)
            })
        }
    }
}

// ========== Log Tail (tail -f via SSH) ==========

/// Handle logtail_start message.
/// Spawns SSH exec `tail -f` and streams output to the WebSocket.
async fn handle_logtail_start(
    socket: &mut WebSocket,
    state: &Arc<AppState>,
    msg: &serde_json::Value,
) {
    let connection_id = msg
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let log_path = msg
        .get("logPath")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let request_id = msg
        .get("requestId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    // Default 200, clamped to [10, 5000]
    let n = msg
        .get("lines")
        .and_then(|v| v.as_u64())
        .map(|v| v.clamp(10, 5000))
        .unwrap_or(200);

    if connection_id.is_empty() || log_path.is_empty() {
        let err = serde_json::json!({
            "type": "error",
            "requestId": request_id,
            "message": "Missing connectionId or logPath"
        });
        let _ = socket.send(Message::Text(txt(err.to_string()))).await;
        return;
    }

    let key = format!("{}:{}", connection_id, log_path);

    // Check if already tailing — if so, stop the old one first
    if let Some((_, old_sender)) = state.active_logtails.remove(&key) {
        let _ = old_sender.send(());
    }

    // Look up SSH session
    let session = {
        let entry = state.connections.get(&connection_id);
        entry.and_then(|c| c.session.clone())
    };

    let session = match session {
        Some(s) => s,
        None => {
            let err = serde_json::json!({
                "type": "error",
                "requestId": request_id,
                "message": "SSH session not found or not connected"
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Build the tail command (using our stream_exec)
    let escaped_path = log_path.replace('\'', "'\\''");
    let cmd = format!("tail -n {} -f '{}' 2>&1", n, escaped_path);

    // Open SSH exec channel for streaming
    let mut channel = match session.stream_exec(&cmd, 132, 60).await {
        Ok(ch) => ch,
        Err(e) => {
            let err = serde_json::json!({
                "type": "error",
                "requestId": request_id,
                "message": format!("Failed to start tail: {}", e)
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Send started acknowledgment
    let ack = serde_json::json!({
        "type": "logtail_started",
        "connectionId": connection_id,
        "requestId": request_id,
        "logPath": log_path,
    });
    if socket
        .send(Message::Text(txt(ack.to_string())))
        .await
        .is_err()
    {
        return;
    }

    info!("Log tail started: {} for path {}", connection_id, log_path);

    // ─── Log Tail I/O Loop ───
    loop {
        tokio::select! {
            // Incoming from WebSocket (stop signal)
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                            let msg_type = parsed
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if msg_type == "logtail_stop" {
                                info!("Log tail stop requested: {}", key);
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Err(e)) => {
                        warn!("Logtail WS error: {:?}", e);
                        break;
                    }
                    _ => break,
                }
            }

            // Outgoing from SSH channel (tail output)
            ssh_msg = channel.wait() => {
                match ssh_msg {
                    Some(msg) => {
                        match msg {
                            russh::ChannelMsg::Data { ref data } => {
                                if let Ok(text) = String::from_utf8(data.to_vec()) {
                                    // Split by lines for frontend
                                    let lines: Vec<&str> = text.lines().collect();
                                    if !lines.is_empty() {
                                        let ws_msg = serde_json::json!({
                                            "type": "logtail_data",
                                            "connectionId": connection_id,
                                            "logPath": log_path,
                                            "lines": lines,
                                        });
                                        if socket.send(Message::Text(txt(ws_msg.to_string()))).await.is_err() {
                                            break;
                                        }
                                    }
                                }
                            }
                            // Channel closed or EOF
                            russh::ChannelMsg::Eof | russh::ChannelMsg::Close => {
                                info!("Log tail channel closed: {}", key);
                                let stop_msg = serde_json::json!({
                                    "type": "logtail_stopped",
                                    "connectionId": connection_id,
                                    "logPath": log_path,
                                });
                                let _ = socket.send(Message::Text(txt(stop_msg.to_string()))).await;
                                break;
                            }
                            _ => {}
                        }
                    }
                    // No error case from channel.wait() - returns None on close
                    None => {
                        break;
                    }
                }
            }
        }
    }

    // Cleanup
    state.active_logtails.remove(&key);
    let stopped = serde_json::json!({
        "type": "logtail_stopped",
        "connectionId": connection_id,
        "requestId": request_id,
        "logPath": log_path,
    });
    let _ = socket.send(Message::Text(txt(stopped.to_string()))).await;
    info!("Log tail ended: {}", key);
}

// ========== Docker Shell (docker exec -it via SSH) ==========

/// Handle "docker_shell" message — SSH docker exec -it into a container and enter I/O loop.
async fn handle_docker_shell(
    socket: &mut WebSocket,
    state: &Arc<AppState>,
    msg: &serde_json::Value,
) {
    let connection_id = msg
        .get("connectionId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let request_id = msg
        .get("requestId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let container_id = msg
        .get("containerId")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let shell = msg
        .get("shell")
        .and_then(|v| v.as_str())
        .unwrap_or("/bin/bash")
        .to_string();
    let cols = msg.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u32;
    let rows = msg.get("rows").and_then(|v| v.as_u64()).unwrap_or(40) as u32;

    // Validate container ID (alphanumeric, hyphens, underscores, max 64 chars)
    if container_id.is_empty()
        || container_id.len() > 64
        || !container_id
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        let err = serde_json::json!({
            "type": "error",
            "requestId": request_id,
            "message": "Invalid container ID"
        });
        let _ = socket.send(Message::Text(txt(err.to_string()))).await;
        return;
    }

    // Validate shell path (starts with /, alphanumeric, dots, hyphens, underscores)
    if !shell.starts_with('/')
        || !shell
            .chars()
            .all(|c| c.is_alphanumeric() || c == '/' || c == '.' || c == '-' || c == '_')
    {
        let err = serde_json::json!({
            "type": "error",
            "requestId": request_id,
            "message": "Invalid shell path"
        });
        let _ = socket.send(Message::Text(txt(err.to_string()))).await;
        return;
    }

    // Look up SSH session
    let session = {
        let entry = state.connections.get(&connection_id);
        entry.and_then(|c| c.session.clone())
    };

    let session = match session {
        Some(s) => s,
        None => {
            let err = serde_json::json!({
                "type": "error",
                "requestId": request_id,
                "message": "SSH session not found or not connected"
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Build docker exec command
    let esc_id = container_id.replace('\'', "'\\''");
    let esc_shell = shell.replace('\'', "'\\''");
    let cmd = format!("docker exec -it '{}' '{}'", esc_id, esc_shell);

    // Open SSH exec channel with PTY for docker exec
    let mut channel = match session.stream_exec(&cmd, cols, rows).await {
        Ok(ch) => ch,
        Err(e) => {
            let err = serde_json::json!({
                "type": "error",
                "requestId": request_id,
                "message": format!("Docker exec failed: {}", e)
            });
            let _ = socket.send(Message::Text(txt(err.to_string()))).await;
            return;
        }
    };

    // Send ready acknowledgment
    let ack = serde_json::json!({
        "type": "docker_shell_ready",
        "connectionId": connection_id,
        "requestId": request_id,
        "containerId": container_id,
        "shell": shell,
    });
    if socket
        .send(Message::Text(txt(ack.to_string())))
        .await
        .is_err()
    {
        return;
    }

    info!("Docker shell connected: {} -> {} ({})", connection_id, container_id, shell);

    let mut exit_code: Option<u32> = None;

    // ─── Docker Shell I/O Loop with output batching ───
    // Batching reduces WebSocket message count by accumulating docker exec output
    // and flushing on size threshold (16KB) or time interval (50ms).
    let flush_timer = tokio::time::sleep(std::time::Duration::from_millis(50));
    tokio::pin!(flush_timer);
    let mut output_buffer: Vec<u8> = Vec::new();

    loop {
        tokio::select! {
            // Incoming from WebSocket (user input / resize)
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(text))) => {
                        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&text) {
                            let msg_type = parsed
                                .get("type")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            match msg_type {
                                "docker_shell_data" => {
                                    if let Some(data) = parsed.get("data").and_then(|v| v.as_str()) {
                                        let decoded = base64::engine::general_purpose::STANDARD
                                            .decode(data)
                                            .unwrap_or_else(|_| data.as_bytes().to_vec());
                                        if channel.data(decoded.as_slice()).await.is_err() {
                                            info!("Docker shell channel write error");
                                            break;
                                        }
                                    }
                                }
                                "docker_shell_resize" => {
                                    let new_cols = parsed.get("cols").and_then(|v| v.as_u64()).unwrap_or(120) as u32;
                                    let new_rows = parsed.get("rows").and_then(|v| v.as_u64()).unwrap_or(40) as u32;
                                    let _ = channel
                                        .request_pty(false, "xterm-256color", new_cols, new_rows, 0, 0, &[])
                                        .await;
                                }
                                "docker_shell_close" | "close" | "disconnect" => {
                                    info!("Docker shell close requested");
                                    break;
                                }
                                _ => {
                                    // Ignore other message types (ping etc.)
                                }
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        info!("Docker shell WebSocket closed by client");
                        break;
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Err(e)) => {
                        warn!("Docker shell WS error: {:?}", e);
                        break;
                    }
                    _ => break,
                }
            }

            // Outgoing to WebSocket (docker exec output via channel.wait())
            // Data is accumulated in output_buffer and flushed in batch
            msg = channel.wait() => {
                match msg {
                    Some(russh::ChannelMsg::Data { ref data }) => {
                        output_buffer.extend_from_slice(data);
                        // Flush immediately if buffer exceeds 16KB threshold
                        if output_buffer.len() > 16_384 {
                            let encoded = base64::engine::general_purpose::STANDARD.encode(&output_buffer);
                            output_buffer.clear();
                            let output = serde_json::json!({
                                "type": "docker_shell_output",
                                "connectionId": connection_id,
                                "containerId": container_id,
                                "data": encoded,
                            });
                            if socket.send(Message::Text(txt(output.to_string()))).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(russh::ChannelMsg::Eof) | Some(russh::ChannelMsg::Close) | None => {
                        // Flush remaining buffered data before break
                        send_buffered_docker_output(&mut output_buffer, socket, &connection_id, &container_id).await;
                        info!("Docker shell channel closed (container: {})", container_id);
                        break;
                    }
                    Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                        // Flush remaining buffered data before break
                        send_buffered_docker_output(&mut output_buffer, socket, &connection_id, &container_id).await;
                        info!("Docker shell exited with status: {}", exit_status);
                        exit_code = Some(exit_status);
                        break;
                    }
                    _ => {}
                }
            }

            // Periodic flush timer — ensures max 50ms latency for small chunks
            _ = &mut flush_timer => {
                if !output_buffer.is_empty() {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&output_buffer);
                    output_buffer.clear();
                    let output = serde_json::json!({
                        "type": "docker_shell_output",
                        "connectionId": connection_id,
                        "containerId": container_id,
                        "data": encoded,
                    });
                    if socket.send(Message::Text(txt(output.to_string()))).await.is_err() {
                        break;
                    }
                }
                flush_timer.as_mut().reset(
                    tokio::time::Instant::now() + std::time::Duration::from_millis(50)
                );
            }
        }
    }

    // Send closed notification
    let mut closed = serde_json::json!({
        "type": "docker_shell_closed",
        "connectionId": connection_id,
        "requestId": request_id,
        "containerId": container_id,
    });
    if let Some(code) = exit_code {
        closed.as_object_mut().unwrap().insert(
            "exitCode".to_string(),
            serde_json::json!(code),
        );
    }
    let _ = socket.send(Message::Text(txt(closed.to_string()))).await;
    info!("Docker shell ended: {} -> {}", connection_id, container_id);
}

// ─── Output batching helper functions ───

/// Flush any buffered terminal output data as a single WebSocket message.
/// Used when a channel is closing to ensure no data is lost.
async fn send_buffered_data(
    buffer: &mut Vec<u8>,
    socket: &mut WebSocket,
    connection_id: &str,
) {
    if !buffer.is_empty() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(buffer.as_slice());
        buffer.clear();
        let output = serde_json::json!({
            "type": "data",
            "connectionId": connection_id,
            "data": encoded
        });
        let _ = socket.send(Message::Text(txt(output.to_string()))).await;
    }
}

/// Flush any buffered docker shell output data as a single WebSocket message.
async fn send_buffered_docker_output(
    buffer: &mut Vec<u8>,
    socket: &mut WebSocket,
    connection_id: &str,
    container_id: &str,
) {
    if !buffer.is_empty() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(buffer.as_slice());
        buffer.clear();
        let output = serde_json::json!({
            "type": "docker_shell_output",
            "connectionId": connection_id,
            "containerId": container_id,
            "data": encoded,
        });
        let _ = socket.send(Message::Text(txt(output.to_string()))).await;
    }
}
