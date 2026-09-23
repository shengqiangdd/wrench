//! User-run localhost SSH terminal companion. It deliberately exposes no TCP proxy.
use std::{
    io::{self, Write},
    net::IpAddr,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use axum::{
    Json, Router,
    extract::{
        DefaultBodyLimit, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header::ORIGIN},
    response::IntoResponse,
    routing::{get, post},
};
use base64::Engine as _;
use rand::{Rng, rng};
use russh::{
    ChannelMsg, client,
    keys::{PrivateKey, PublicKey, key::PrivateKeyWithHashAlg},
};
use serde::{Deserialize, Serialize};
use tokio::{
    net::TcpListener,
    sync::{Mutex as AsyncMutex, OwnedSemaphorePermit, Semaphore},
};
use tower_http::cors::CorsLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AgentState {
    origin: Arc<str>,
    port: u16,
    pairing_token: Arc<Mutex<Option<String>>>,
    session_token: Arc<str>,
    prompt_lock: Arc<AsyncMutex<()>>,
    known_hosts: PathBuf,
    ws_slots: Arc<Semaphore>,
}

#[derive(Deserialize)]
struct PairRequest {
    token: String,
}

#[derive(Serialize)]
struct PairResponse {
    paired: bool,
    message: &'static str,
    session_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectRequest {
    #[serde(rename = "type")]
    kind: String,
    connection_id: String,
    host: String,
    port: u16,
    username: String,
    password: Option<String>,
    private_key: Option<String>,
    cols: Option<u32>,
    rows: Option<u32>,
}

#[derive(Clone)]
struct HostVerifier {
    host: String,
    port: u16,
    known_hosts: PathBuf,
    prompt_lock: Arc<AsyncMutex<()>>,
}

impl client::Handler for HostVerifier {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKey) -> Result<bool, Self::Error> {
        let address = format!("[{}]:{}", self.host, self.port);
        let key_text = key.to_string();
        match std::fs::read_to_string(&self.known_hosts) {
            Ok(file) => {
                for line in file.lines() {
                    if let Some((host, fingerprint)) = line.split_once(' ')
                        && host == address
                    {
                        return Ok(fingerprint == key_text);
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err(russh::Error::NoAuthMethod),
        }
        let _prompt_guard = self.prompt_lock.lock().await;
        let shown = format!(
            "{}\nSHA256 fingerprint: {}",
            key_text,
            key.fingerprint(russh::keys::HashAlg::default())
        );
        let known_hosts = self.known_hosts.clone();
        let prompt = tokio::task::spawn_blocking(move || -> bool {
            eprintln!("\n未登记的 SSH host key：{}\n主机：{}\n密钥：{}", address, address, shown);
            eprint!("确认首次信任该主机密钥？请输入 yes: ");
            let _ = io::stderr().flush();
            let mut answer = String::new();
            if io::stdin().read_line(&mut answer).is_err() || answer.trim() != "yes" {
                return false;
            }
            if let Some(parent) = known_hosts.parent()
                && std::fs::create_dir_all(parent).is_err()
            {
                return false;
            }
            let mut options = std::fs::OpenOptions::new();
            options.create(true).append(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let Ok(mut file) = options.open(known_hosts) else {
                return false;
            };
            writeln!(file, "{} {}", address, key_text).is_ok()
        })
        .await
        .unwrap_or(false);
        Ok(prompt)
    }
}

fn origin_ok(headers: &HeaderMap, state: &AgentState) -> bool {
    headers.get(ORIGIN).and_then(|v| v.to_str().ok()) == Some(state.origin.as_ref())
}

fn host_ok(headers: &HeaderMap, port: u16) -> bool {
    let expected = format!("127.0.0.1:{port}");
    headers.get(axum::http::header::HOST).and_then(|v| v.to_str().ok()) == Some(expected.as_str())
}

async fn health(State(state): State<AgentState>, headers: HeaderMap) -> impl IntoResponse {
    if !origin_ok(&headers, &state) || !host_ok(&headers, state.port) {
        return StatusCode::FORBIDDEN.into_response();
    }
    (
        StatusCode::OK,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({"online": true})),
    )
        .into_response()
}

async fn pair(State(state): State<AgentState>, headers: HeaderMap, Json(body): Json<PairRequest>) -> impl IntoResponse {
    if !origin_ok(&headers, &state) || !host_ok(&headers, state.port) {
        return (
            StatusCode::FORBIDDEN,
            Json(PairResponse { paired: false, message: "origin or host rejected", session_token: None }),
        )
            .into_response();
    }
    let mut token = state.pairing_token.lock().unwrap_or_else(|p| p.into_inner());
    let valid = token
        .as_ref()
        .is_some_and(|expected| constant_time_eq(expected.as_bytes(), body.token.as_bytes()));
    if !valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(PairResponse {
                paired: false,
                message: "invalid or already used pairing token",
                session_token: None,
            }),
        )
            .into_response();
    }
    *token = None;
    (
        StatusCode::OK,
        Json(PairResponse {
            paired: true,
            message: "paired for this agent run",
            session_token: Some(state.session_token.to_string()),
        }),
    )
        .into_response()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        diff |= usize::from(a.get(i).copied().unwrap_or(0) ^ b.get(i).copied().unwrap_or(0));
    }
    diff == 0
}

async fn ws_entry(State(state): State<AgentState>, headers: HeaderMap, ws: WebSocketUpgrade) -> impl IntoResponse {
    if !origin_ok(&headers, &state) || !host_ok(&headers, state.port) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let permit = match state.ws_slots.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| async move { handle_socket(socket, state, permit).await })
        .into_response()
}

async fn handle_socket(mut socket: WebSocket, state: AgentState, _permit: OwnedSemaphorePermit) {
    let authenticated = match tokio::time::timeout(std::time::Duration::from_secs(3), socket.recv()).await {
        Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                Some(
                    v.get("type")?.as_str()? == "agent_auth"
                        && constant_time_eq(v.get("token")?.as_str()?.as_bytes(), state.session_token.as_bytes()),
                )
            })
            .unwrap_or(false),
        _ => false,
    };
    if !authenticated {
        let _ = socket.send(Message::Close(None)).await;
        return;
    }
    let _ = socket.send(Message::Text(r#"{"type":"agent_ready"}"#.into())).await;
    while let Some(Ok(message)) = socket.recv().await {
        match message {
            Message::Text(text) => {
                let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
                    continue;
                };
                match value.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "connect" => {
                        let Ok(request) = serde_json::from_value::<ConnectRequest>(value) else {
                            continue;
                        };
                        if request.kind != "connect" || !valid_connect(&request) {
                            send_error(
                                &mut socket,
                                &request.connection_id,
                                "本机模式只接受 IP 字面地址和有效 SSH 参数",
                            )
                            .await;
                            continue;
                        }
                        if !approve_target(&state, &request).await {
                            send_error(&mut socket, &request.connection_id, "本机用户拒绝了此次连接").await;
                            continue;
                        }
                        run_terminal(&mut socket, &state, request).await;
                    }
                    "data" => {
                        // Terminal byte input is accepted only during run_terminal's socket loop.
                    }
                    "ping" => {
                        let _ = socket.send(Message::Text(r#"{"type":"pong"}"#.into())).await;
                    }
                    _ => {}
                }
            }
            Message::Close(_) => break,
            _ => {}
        }
    }
}

fn is_private_target(host: IpAddr) -> bool {
    if host.is_loopback() || host.is_unspecified() || host.is_multicast() {
        return false;
    }
    match host {
        IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => {
            let octets = ip.octets();
            (octets[0] & 0xfe) == 0xfc || (octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80)
        }
    }
}

fn valid_connect(req: &ConnectRequest) -> bool {
    let Some(host) = req.host.parse::<IpAddr>().ok() else {
        return false;
    };
    is_private_target(host)
        && req.port > 0
        && !req.username.is_empty()
        && (req.password.as_ref().is_some_and(|s| !s.is_empty())
            || req.private_key.as_ref().is_some_and(|s| !s.is_empty()))
        && req.host.len() < 64
        && req.username.len() < 256
}

async fn approve_target(state: &AgentState, req: &ConnectRequest) -> bool {
    let _guard = state.prompt_lock.lock().await;
    let host = req.host.clone();
    let user = req.username.escape_default().to_string();
    let port = req.port;
    tokio::task::spawn_blocking(move || {
        eprintln!("\nWrench 本机 Agent 请求 SSH 连接：{}@{}:{}", user, host, port);
        eprint!("在本机终端输入 yes 批准（其他输入拒绝）: ");
        let _ = io::stderr().flush();
        let mut answer = String::new();
        io::stdin().read_line(&mut answer).is_ok() && answer.trim() == "yes"
    })
    .await
    .unwrap_or(false)
}

async fn send_error(socket: &mut WebSocket, id: &str, message: &str) {
    let body = serde_json::json!({"type":"error","connectionId":id,"message":message});
    let _ = socket.send(Message::Text(body.to_string().into())).await;
}

async fn run_terminal(socket: &mut WebSocket, state: &AgentState, req: ConnectRequest) {
    let host = req.host.clone();
    let port = req.port;
    let prompt_lock = state.prompt_lock.clone();
    let handler = HostVerifier {
        host: host.clone(),
        port,
        known_hosts: state.known_hosts.clone(),
        prompt_lock: state.prompt_lock.clone(),
    };
    let config = Arc::new(client::Config::default());
    let mut session = match tokio::time::timeout(
        std::time::Duration::from_secs(15),
        client::connect(config, (host.parse::<IpAddr>().expect("validated IP address"), port), handler),
    )
    .await
    {
        Ok(Ok(session)) => session,
        Ok(Err(e)) => {
            send_error(socket, &req.connection_id, &format!("SSH 握手失败: {e}")).await;
            return;
        }
        Err(_) => {
            send_error(socket, &req.connection_id, "SSH 连接超时").await;
            return;
        }
    };
    let auth = if let Some(password) = req.password.filter(|s| !s.is_empty()) {
        session.authenticate_password(&req.username, password).await
    } else {
        let key_text = req.private_key.unwrap_or_default();
        match PrivateKey::from_openssh(key_text.as_bytes()) {
            Ok(key) => {
                session
                    .authenticate_publickey(&req.username, PrivateKeyWithHashAlg::new(Arc::new(key), None))
                    .await
            }
            Err(e) => {
                send_error(socket, &req.connection_id, &format!("私钥解析失败: {e}")).await;
                return;
            }
        }
    };
    match auth {
        Ok(result) if result.success() => {}
        Ok(_) => {
            send_error(socket, &req.connection_id, "SSH 认证失败").await;
            return;
        }
        Err(e) => {
            send_error(socket, &req.connection_id, &format!("SSH 认证失败: {e}")).await;
            return;
        }
    }
    let mut channel = match session.channel_open_session().await {
        Ok(c) => c,
        Err(e) => {
            send_error(socket, &req.connection_id, &e.to_string()).await;
            return;
        }
    };
    let cols = req.cols.unwrap_or(80).clamp(20, 500);
    let rows = req.rows.unwrap_or(24).clamp(5, 200);
    if channel
        .request_pty(true, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .is_err()
        || channel.request_shell(true).await.is_err()
    {
        send_error(socket, &req.connection_id, "SSH PTY 初始化失败").await;
        return;
    }
    let connected = serde_json::json!({"type":"connected","connectionId":req.connection_id});
    if socket.send(Message::Text(connected.to_string().into())).await.is_err() {
        return;
    }
    drop(prompt_lock);
    loop {
        tokio::select! {
            server_message = channel.wait() => match server_message {
                Some(ChannelMsg::Data { data }) | Some(ChannelMsg::ExtendedData { data, .. }) => {
                    let id = req.connection_id.as_bytes();
                    let mut frame = Vec::with_capacity(3 + id.len() + data.len()); frame.push(1); frame.extend_from_slice(&(id.len() as u16).to_be_bytes()); frame.extend_from_slice(id); frame.extend_from_slice(&data);
                    if socket.send(Message::Binary(frame.into())).await.is_err() { break; }
                },
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Text(text))) => if let Ok(v) = serde_json::from_str::<serde_json::Value>(&text) {
                    match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
                        "exec" => if let Some(data) = v.get("data").and_then(|x| x.as_str())
                            && let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data)
                        { let _ = channel.data_bytes(bytes).await; },
                        "resize" => if let (Some(cols), Some(rows)) = (v.get("cols").and_then(|x| x.as_u64()), v.get("rows").and_then(|x| x.as_u64())) { let _ = channel.window_change(cols as u32, rows as u32, 0, 0).await; },
                        "disconnect" => break,
                        _ => {}
                    }
                },
                Some(Ok(Message::Binary(frame))) if frame.len() > 3 => {
                    let _ = channel.data_bytes(frame[3..].to_vec()).await;
                },
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                _ => {}
            }
        }
    }
    let _ = session
        .disconnect(russh::Disconnect::ByApplication, "terminal closed", "en")
        .await;
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let origin = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("WRENCH_AGENT_ALLOW_ORIGIN").ok())
        .ok_or_else(|| anyhow::anyhow!("usage: wrench-agent <exact-web-origin> (e.g. https://wrench.example)"))?;
    let parsed =
        url_origin(&origin).ok_or_else(|| anyhow::anyhow!("origin must be an exact http(s) origin without path"))?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let mut bytes = [0u8; 32];
    rng().fill_bytes(&mut bytes);
    let pairing = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    let session = Uuid::new_v4().to_string() + &Uuid::new_v4().simple().to_string();
    let known_hosts = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".wrench-agent")
        .join("known_hosts");
    let state = AgentState {
        origin: Arc::from(parsed),
        port,
        pairing_token: Arc::new(Mutex::new(Some(pairing.clone()))),
        session_token: Arc::from(session),
        prompt_lock: Arc::new(AsyncMutex::new(())),
        known_hosts,
        ws_slots: Arc::new(Semaphore::new(2)),
    };
    println!("Wrench local SSH Agent listening at http://127.0.0.1:{port}");
    println!("Allowed web origin: {}", state.origin);
    println!("One-time pairing token (shown once): {pairing}");
    println!("Keep this process running. Approve each SSH target in this terminal.");
    let cors_origin: axum::http::HeaderValue = state.origin.parse()?;
    let app = Router::new()
        .route("/pair", post(pair))
        .route("/health", get(health))
        .route("/ws", get(ws_entry))
        .layer(DefaultBodyLimit::max(4096))
        .layer(
            CorsLayer::new()
                .allow_origin(cors_origin)
                .allow_methods([axum::http::Method::GET, axum::http::Method::POST])
                .allow_headers([axum::http::header::CONTENT_TYPE])
                .allow_private_network(true),
        )
        .with_state(state);
    axum::serve(listener, app).await?;
    Ok(())
}

fn url_origin(input: &str) -> Option<String> {
    let url = input.parse::<axum::http::Uri>().ok()?;
    if url.path() != "/" && !url.path().is_empty() || url.query().is_some() || url.authority().is_none() {
        return None;
    }
    let scheme = url.scheme_str()?;
    let authority = url.authority()?;
    let host = authority.host().trim_matches(['[', ']']);
    let secure = scheme == "https";
    let local_development = scheme == "http" && matches!(host, "localhost" | "127.0.0.1" | "::1");
    if !secure && !local_development {
        return None;
    }
    Some(format!("{}://{}", scheme, authority))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_hostnames_and_special_ips() {
        let base = |host: &str| ConnectRequest {
            kind: "connect".into(),
            connection_id: "x".into(),
            host: host.into(),
            port: 22,
            username: "u".into(),
            password: Some("p".into()),
            private_key: None,
            cols: None,
            rows: None,
        };
        assert!(valid_connect(&base("192.168.1.9")));
        assert!(valid_connect(&base("10.0.0.1")));
        assert!(valid_connect(&base("fe80::1")));
        assert!(!valid_connect(&base("8.8.8.8")));
        assert!(!valid_connect(&base("127.0.0.1")));
        assert!(!valid_connect(&base("nas.local")));
        assert!(!valid_connect(&base("0.0.0.0")));
        assert!(!valid_connect(&base("224.0.0.1")));
    }
    #[test]
    fn origin_must_be_origin_only() {
        assert_eq!(url_origin("https://wrench.example"), Some("https://wrench.example".into()));
        assert_eq!(url_origin("https://wrench.example/path"), None);
        assert_eq!(
            url_origin("https://wrench.example.evil"),
            Some("https://wrench.example.evil".into())
        );
        assert_eq!(url_origin("file:///tmp"), None);
        assert_eq!(url_origin("http://wrench.example"), None);
        assert_eq!(url_origin("http://127.0.0.1:5173"), Some("http://127.0.0.1:5173".into()));
    }
    #[test]
    fn host_header_must_match_loopback_listener_port() {
        let mut headers = HeaderMap::new();
        headers.insert(axum::http::header::HOST, "127.0.0.1:43210".parse().unwrap());
        assert!(host_ok(&headers, 43210));
        assert!(!host_ok(&headers, 43211));
        headers.insert(axum::http::header::HOST, "localhost:43210".parse().unwrap());
        assert!(!host_ok(&headers, 43210));
    }

    #[test]
    fn origin_allowlist_is_exact() {
        let state = AgentState {
            origin: Arc::from("https://wrench.example"),
            port: 43210,
            pairing_token: Arc::new(Mutex::new(None)),
            session_token: Arc::from("session"),
            prompt_lock: Arc::new(AsyncMutex::new(())),
            known_hosts: PathBuf::from("unused"),
            ws_slots: Arc::new(Semaphore::new(2)),
        };
        let mut headers = HeaderMap::new();
        headers.insert(ORIGIN, "https://wrench.example".parse().unwrap());
        assert!(origin_ok(&headers, &state));
        headers.insert(ORIGIN, "https://wrench.example.evil".parse().unwrap());
        assert!(!origin_ok(&headers, &state));
        headers.remove(ORIGIN);
        assert!(!origin_ok(&headers, &state));
    }

    #[test]
    fn token_comparison_includes_length() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"ab"));
    }
}
