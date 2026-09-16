use axum::{
    Json,
    extract::{Extension, State},
};
use std::sync::Arc;

use crate::api_types::{SshConnectResponse, SshDisconnectRequest, SshExecRequest, SshExecResponse};
use crate::app_state::AppState;
use crate::response::ApiResponse;
use crate::space::SpaceCtx;
use crate::ssh::SshSession;
use crate::ssh::client::{ConnectRequest, SshConnection};

/// 是否把 `ssh_test_password` 回显给浏览器。
///
/// **默认关闭**：这个变量按 `docs/DEPLOY.md` 的建议是给"部署方配一台测试主机"用的，
/// 而公网可达时 `/api/ssh/test-config` 只要过了网关口令就能读到 —— 一旦部署方设置了
/// `ssh_test_password`，任何已登录的浏览器会话都能拿到**服务器自己的 SSH 口令**，
/// 于是"进门口令"被升级成"进服务器的口令"。所以默认只回 `hasPassword`（供 UI 提示），
/// 本地开发确实需要预填时显式打开：`WRENCH_EXPOSE_SSH_TEST_PASSWORD=1`。
fn expose_test_password() -> bool {
    matches!(
        std::env::var("WRENCH_EXPOSE_SSH_TEST_PASSWORD").as_deref(),
        Ok("1") | Ok("true")
    )
}

/// 组装 `/api/ssh/test-config` 的响应体。
///
/// 口令作为入参而不是就地读环境变量：单测要断言"默认不回显"，
/// 而进程级环境变量在并行测试里是共享状态，改成入参才能确定性断言。
fn build_test_config(expose_password: bool, password: String) -> serde_json::Value {
    let has_password = !password.is_empty();
    let mut body = serde_json::json!({
        "host": std::env::var("ssh_test_host").unwrap_or_default(),
        "user": std::env::var("ssh_test_user").unwrap_or_default(),
        "hasPassword": has_password,
    });
    if expose_password && has_password {
        body["password"] = serde_json::Value::String(password);
    }
    body
}

/// Get SSH test configuration from environment variables (GET /api/ssh/test-config)
pub async fn test_config() -> Json<serde_json::Value> {
    Json(build_test_config(
        expose_test_password(),
        std::env::var("ssh_test_password").unwrap_or_default(),
    ))
}

/// Execute a command on an SSH connection (POST /api/ssh/exec)
pub async fn exec_command(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(body): Json<SshExecRequest>,
) -> ApiResponse<SshExecResponse> {
    let connection_id = &body.connection_id;
    let command = &body.command;

    if connection_id.is_empty() || command.is_empty() {
        return ApiResponse::error(400, "Missing connectionId or command");
    }

    // Look up the connection
    let conn = match state.connection_in(&space.id, connection_id) {
        Some(c) => c,
        None => return ApiResponse::error(400, "SSH not connected"),
    };

    let session = match &conn.session {
        Some(s) => s.clone(),
        None => return ApiResponse::error(400, "SSH not connected"),
    };

    // Drop the read guard before awaiting (session is Arc)
    drop(conn);

    // Execute command
    match session.exec(command).await {
        Ok((stdout, stderr, exit_code)) => {
            // Audit log the command execution
            let detail = serde_json::json!({
                "action": "ssh_exec",
                "command": command,
                "exit_code": exit_code,
                "stdout_len": stdout.len(),
                "stderr_len": stderr.len(),
            });
            let ip = "0.0.0.0".to_string();
            state.add_audit_log("ssh_exec", detail, &ip, &space.id);

            ApiResponse::success(SshExecResponse { stdout, stderr, exit_code: exit_code as i32 })
        }
        Err(e) => ApiResponse::error(500, &format!("SSH exec error: {}", e)),
    }
}

/// Connect to an SSH server (POST /api/ssh/connect)
pub async fn connect_ssh(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(body): Json<ConnectRequest>,
) -> ApiResponse<SshConnectResponse> {
    let connection_id = uuid::Uuid::new_v4().to_string();
    let host = body.host;
    let port = body.port.unwrap_or(22);
    let username = body.username;

    // 出口策略：先判定「这台机器允许连到哪里」再动手。
    // 这层预检给出 403 + 可读原因（上层笼统的 401「认证失败」会把策略拒绝说成口令错）；
    // 真正的强制点在 ssh/pool.rs，WebSocket 终端那条路径走同一个咽喉点。
    if let Err(denied) = crate::egress::authorize_tcp(&host, port).await {
        tracing::warn!(
            target: "wrench_backend",
            "出口策略拒绝 {}@{}:{} — {}",
            username, host, port, denied
        );
        state.add_audit_log(
            "ssh_egress_denied",
            serde_json::json!({
                "action": "ssh_egress_denied",
                "host": host,
                "port": port,
                "username": username,
                "reason": denied.to_string(),
            }),
            "0.0.0.0",
            &space.id,
        );
        return ApiResponse::error(403, &denied.to_string());
    }

    // Configuration for known_hosts verification
    let known_hosts_path = body.known_hosts_path.clone();
    let strict_mode = body.strict_mode.unwrap_or(false);

    let session = SshSession::new(
        connection_id.clone(),
        host.clone(),
        port,
        username.clone(),
        known_hosts_path,
        strict_mode,
    );

    // Try password auth first, then key auth
    if let Some(password) = &body.password
        && !password.is_empty()
    {
        match session
            .connect_password(password, body.known_hosts_path.clone(), body.strict_mode.unwrap_or(false))
            .await
        {
            Ok(()) => {
                save_connection(
                    &state,
                    &space.id,
                    &connection_id,
                    &host,
                    port,
                    &username,
                    session,
                    body.sudo_password.clone(),
                )
                .await;
                return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
            }
            Err(e) => {
                tracing::error!("Password auth failed for {}@{}:{}: {}", username, host, port, e);
            }
        }
    }

    // Try key auth
    if let Some(private_key) = &body.private_key
        && !private_key.is_empty()
        && session
            .connect_key(
                private_key,
                None,
                body.known_hosts_path.clone(),
                body.strict_mode.unwrap_or(false),
            )
            .await
            .is_ok()
    {
        save_connection(
            &state,
            &space.id,
            &connection_id,
            &host,
            port,
            &username,
            session,
            body.sudo_password.clone(),
        )
        .await;
        return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
    }

    ApiResponse::error(401, "SSH authentication failed")
}

/// Disconnect from an SSH server (POST /api/ssh/disconnect)
pub async fn disconnect_ssh(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(body): Json<SshDisconnectRequest>,
) -> ApiResponse<String> {
    let connection_id = &body.connection_id;

    let mut conn = match state.remove_connection_in(&space.id, connection_id) {
        Some(c) => c,
        None => return ApiResponse::error(404, "SSH connection not found"),
    };

    if let Some(session) = conn.session.take() {
        let _ = session.disconnect().await;
    }

    // Audit log
    let detail = serde_json::json!({
        "action": "ssh_disconnect",
        "host": conn.host,
        "port": conn.port,
        "username": conn.username,
    });
    let ip = "0.0.0.0".to_string();
    state.add_audit_log("ssh_disconnect", detail, &ip, &space.id);

    ApiResponse::success_msg("Disconnected")
}

// 连接元信息字段本来就多，拆成一个结构体反而要到处构造中转对象，收益不抵噪音
#[allow(clippy::too_many_arguments)]
async fn save_connection(
    state: &AppState,
    space_id: &str,
    connection_id: &str,
    host: &str,
    port: u16,
    username: &str,
    session: SshSession,
    sudo_password: Option<String>,
) {
    let entry = SshConnection {
        connection_id: connection_id.to_string(),
        host: host.to_string(),
        port,
        username: username.to_string(),
        auth_method: "password".to_string(),
        session: Some(Arc::new(session)),
        sudo_password,
        space_id: space_id.to_string(),
    };

    state.connections.insert(connection_id.to_string(), entry);
}

/// Ensure an active SSH connection exists for the given host/port/username.
///
/// If a connection with matching host+port+username is already connected, returns its ID.
/// Otherwise creates a new one via password or key auth.
/// This lets Docker/Logs/Monitor pages connect without going through the SSH page.
pub async fn ensure_connection(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(body): Json<ConnectRequest>,
) -> ApiResponse<SshConnectResponse> {
    let host = body.host.clone();
    let port = body.port.unwrap_or(22);
    let username = body.username.clone();

    // Check for existing active connection with same host+port+username
    for conn in state.connections_in(&space.id) {
        let conn = &conn;
        if conn.host == host
            && conn.port == port
            && conn.username == username
            && let Some(session) = &conn.session
            && session.is_connected().await
        {
            return ApiResponse::success(SshConnectResponse {
                connection_id: conn.connection_id.clone(),
                host: conn.host.clone(),
                port: conn.port,
                username: conn.username.clone(),
            });
        }
    }

    // No existing connection — create new one (reuse connect_ssh logic)
    //
    // 建新连接前先过出口策略（复用已有会话不受影响：那是上一轮已经放行的目标）。
    if let Err(denied) = crate::egress::authorize_tcp(&host, port).await {
        tracing::warn!(
            target: "wrench_backend",
            "出口策略拒绝 {}@{}:{} — {}",
            username, host, port, denied
        );
        state.add_audit_log(
            "ssh_egress_denied",
            serde_json::json!({
                "action": "ssh_egress_denied",
                "host": host,
                "port": port,
                "username": username,
                "reason": denied.to_string(),
            }),
            "0.0.0.0",
            &space.id,
        );
        return ApiResponse::error(403, &denied.to_string());
    }

    let connection_id = uuid::Uuid::new_v4().to_string();

    // Configuration for known_hosts verification
    let known_hosts_path = body.known_hosts_path.clone();
    let strict_mode = body.strict_mode.unwrap_or(false);

    let session = SshSession::new(
        connection_id.clone(),
        host.clone(),
        port,
        username.clone(),
        known_hosts_path,
        strict_mode,
    );

    // Try password auth first, then key auth
    if let Some(password) = &body.password
        && !password.is_empty()
    {
        match session
            .connect_password(password, body.known_hosts_path.clone(), body.strict_mode.unwrap_or(false))
            .await
        {
            Ok(()) => {
                save_connection(
                    &state,
                    &space.id,
                    &connection_id,
                    &host,
                    port,
                    &username,
                    session,
                    body.sudo_password.clone(),
                )
                .await;
                return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
            }
            Err(e) => {
                tracing::error!(
                    "ensure_connection: Password auth failed for {}@{}:{}: {}",
                    username,
                    host,
                    port,
                    e
                );
            }
        }
    }

    if let Some(private_key) = &body.private_key
        && !private_key.is_empty()
        && session
            .connect_key(
                private_key,
                None,
                body.known_hosts_path.clone(),
                body.strict_mode.unwrap_or(false),
            )
            .await
            .is_ok()
    {
        save_connection(
            &state,
            &space.id,
            &connection_id,
            &host,
            port,
            &username,
            session,
            body.sudo_password.clone(),
        )
        .await;
        return ApiResponse::success(SshConnectResponse { connection_id, host, port, username });
    }

    ApiResponse::error(401, "SSH authentication failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 默认（未显式打开 `WRENCH_EXPOSE_SSH_TEST_PASSWORD`）不得回显口令。
    ///
    /// 回归背景：旧实现无条件 `"password": env("ssh_test_password")`，
    /// 公网可达时任何已登录会话都能读到服务器 SSH 口令。
    #[test]
    fn test_config_hides_password_by_default() {
        let body = build_test_config(false, "s3cret".to_string());
        assert!(body.get("password").is_none(), "默认响应体不得包含 password 字段，实际: {body}");
        assert_eq!(body["hasPassword"], serde_json::json!(true));
    }

    /// 显式打开开关时保留原有的开发预填行为。
    #[test]
    fn test_config_returns_password_only_when_opted_in() {
        let body = build_test_config(true, "s3cret".to_string());
        assert_eq!(body["password"], serde_json::json!("s3cret"));
    }

    /// 没配口令时 `hasPassword` 为 false，且不因开关打开而多出空字段。
    #[test]
    fn test_config_reports_missing_password_without_echoing_it() {
        let body = build_test_config(true, String::new());
        assert!(body.get("password").is_none());
        assert_eq!(body["hasPassword"], serde_json::json!(false));
    }
}
