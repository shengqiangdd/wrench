use std::sync::Arc;
use std::time::Instant;
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};
use tokio::time::{Duration, timeout};

use russh::client;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh_sftp::client::SftpSession;

use crate::ssh::known_hosts::KnownHosts;
use crate::utils::escape_sh_arg;

/// A connected SSH session wrapper around russh.
pub struct SshSession {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    handle: Arc<Mutex<Option<client::Handle<SshHandler>>>>,
    last_used: Arc<Mutex<Instant>>,
    /// Cached SFTP session for re-use across operations.
    sftp_cache: Arc<Mutex<Option<Arc<SftpSession>>>>,
    /// Serializes cache misses so concurrent first requests share one subsystem.
    sftp_init_lock: Arc<Mutex<()>>,
    /// Bounds metadata/stat requests sent concurrently over one SSH connection.
    sftp_parallelism: Arc<Semaphore>,
}

// Default idle timeout: 30 minutes
const IDLE_TIMEOUT_SECS: u64 = 1800;
/// Grace period between TERM and KILL when cancelling an API command.
const EXEC_CANCEL_GRACE: Duration = Duration::from_millis(750);

/// Put the user command in its own session/process group. The command is a
/// positional argument, so it is never interpolated into the wrapper script.
/// When sshd forwards TERM to the outer shell, the trap terminates every child
/// in that group, waits briefly, then force-kills any stragglers.
fn cancellable_process_group_command(command: &str) -> String {
    const WRAPPER: &str = r#"child=''
cleanup() {
  if [ -n "$child" ]; then
    kill -TERM -- "-$child" 2>/dev/null || true
    sleep 0.75
    kill -KILL -- "-$child" 2>/dev/null || true
  fi
  exit 143
}
trap cleanup TERM
setsid sh -c "$1" &
child=$!
wait "$child""#;

    format!("bash -c {} -- {}", escape_sh_arg(WRAPPER), escape_sh_arg(command))
}

/// SSH handler with host key verification.
#[derive(Clone)]
pub struct SshHandler {
    known_hosts: KnownHosts,
    host: String,
    port: u16,
}

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server_public_key: &russh::keys::PublicKey) -> Result<bool, Self::Error> {
        // Use known_hosts verification instead of unconditional trust
        match self.known_hosts.verify(&self.host, self.port, server_public_key) {
            Ok(true) => {
                tracing::debug!("Host key verified for {}:{}", self.host, self.port);
                Ok(true)
            }
            Ok(false) => {
                tracing::warn!("Host key verification failed for {}:{} (strict mode)", self.host, self.port);
                Err(russh::Error::NoAuthMethod)
            }
            Err(e) => {
                tracing::error!("Error verifying host key for {}:{}: {}", self.host, self.port, e);
                Err(russh::Error::NoAuthMethod)
            }
        }
    }

    async fn auth_banner(&mut self, banner: &str, _session: &mut client::Session) -> Result<(), Self::Error> {
        tracing::debug!("SSH auth banner: {banner}");
        Ok(())
    }
}

/// Result of a bounded SSH command execution.
#[derive(Debug)]
pub struct ExecOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: u32,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
}

fn append_bounded(buffer: &mut Vec<u8>, data: &[u8], limit: usize) -> bool {
    if buffer.len() >= limit {
        return !data.is_empty();
    }
    let remaining = limit - buffer.len();
    let take = remaining.min(data.len());
    buffer.extend_from_slice(&data[..take]);
    take < data.len()
}

impl SshSession {
    /// Create a new SSH session with known_hosts verification.
    ///
    /// # Arguments
    /// * `connection_id` - Unique connection identifier
    /// * `host` - SSH server hostname or IP
    /// * `port` - SSH server port
    /// * `username` - SSH username
    /// * `known_hosts_path` - Optional path to known_hosts file
    /// * `strict_mode` - If true, reject unknown hosts; if false, auto-accept
    pub fn new(
        connection_id: String,
        host: String,
        port: u16,
        username: String,
        _known_hosts_path: Option<String>,
        _strict_mode: bool,
    ) -> Self {
        Self {
            connection_id,
            host,
            port,
            username,
            handle: Arc::new(Mutex::new(None)),
            last_used: Arc::new(Mutex::new(Instant::now())),
            sftp_cache: Arc::new(Mutex::new(None)),
            sftp_init_lock: Arc::new(Mutex::new(())),
            sftp_parallelism: Arc::new(Semaphore::new(8)),
        }
    }

    /// Create an SshHandler with known_hosts verification configured.
    fn create_handler(&self, known_hosts_path: Option<String>, strict_mode: bool) -> SshHandler {
        let path = known_hosts_path.map(std::path::PathBuf::from);
        let known_hosts = KnownHosts::new(path, strict_mode);
        SshHandler { known_hosts, host: self.host.clone(), port: self.port }
    }

    /// Update the last-used timestamp (call after every operation).
    pub fn touch(&self) {
        *self.last_used.blocking_lock() = Instant::now();
    }

    /// Async variant of touch for use in async contexts.
    pub async fn touch_async(&self) {
        *self.last_used.lock().await = Instant::now();
    }

    /// Check if this session has been idle longer than the timeout.
    pub fn is_idle(&self) -> bool {
        self.last_used.blocking_lock().elapsed().as_secs() > IDLE_TIMEOUT_SECS
    }

    /// Async variant of is_idle for use in async contexts.
    pub async fn is_idle_async(&self) -> bool {
        self.last_used.lock().await.elapsed().as_secs() > IDLE_TIMEOUT_SECS
    }

    /// Build a client config with keepalive and nodelay enabled.
    fn build_config() -> Arc<client::Config> {
        let config = client::Config {
            // Send keepalive probes every 30 seconds to prevent idle disconnects
            keepalive_interval: Some(std::time::Duration::from_secs(30)),
            // Close connection after 3 missed keepalives (90s total)
            keepalive_max: 3,
            // Disable Nagle's algorithm for lower latency on interactive sessions
            nodelay: true,
            ..Default::default()
        };
        Arc::new(config)
    }

    /// 出口策略把关 + 建连（唯一咽喉点）。
    ///
    /// Wrench 的目标主机来自客户端请求，所有 SSH/SFTP 通路（REST、WebSocket 终端、
    /// 健康探测）都必须经过这里。策略在这里强制，而不是只在上层 API 里做校验，
    /// 否则 WebSocket 那条路径可以绕过。
    ///
    /// 连接使用策略校验过的 **IP**（而不是主机名），防止 DNS rebinding：
    /// 校验和连接之间不能有第二次解析。Host key 校验仍用原始主机名
    /// （`SshHandler.host`），所以 known_hosts 的按名匹配不受影响。
    async fn connect_authorized(
        &self,
        known_hosts_path: Option<String>,
        strict_mode: bool,
    ) -> Result<client::Handle<SshHandler>, Box<dyn std::error::Error + Send + Sync>> {
        let addrs = match crate::egress::policy()
            .resolve_target(&self.host, self.port, crate::egress::Channel::Tcp)
            .await
        {
            Ok(addrs) => addrs,
            Err(denied) => {
                tracing::warn!(
                    target: "wrench_backend",
                    "出口策略拒绝 {}@{}:{} — {}",
                    self.username, self.host, self.port, denied
                );
                return Err(Box::new(denied));
            }
        };

        let mut last_err: Option<Box<dyn std::error::Error + Send + Sync>> = None;
        for ip in addrs {
            let target = std::net::SocketAddr::new(ip, self.port);
            let config = Self::build_config();
            let handler = self.create_handler(known_hosts_path.clone(), strict_mode);
            match client::connect(config, target, handler).await {
                Ok(handle) => return Ok(handle),
                Err(e) => {
                    tracing::warn!("SSH 连接 {}（{}）失败：{}", self.host, target, e);
                    last_err = Some(Box::new(e));
                }
            }
        }

        Err(last_err.unwrap_or_else(|| "出口策略未放行任何可连接地址".into()))
    }

    /// Connect using password authentication.
    ///
    /// # Arguments
    /// * `password` - SSH password
    /// * `known_hosts_path` - Optional path to known_hosts file
    /// * `strict_mode` - If true, reject unknown hosts; if false, auto-accept
    pub async fn connect_password(
        &self,
        password: &str,
        known_hosts_path: Option<String>,
        strict_mode: bool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut handle = self.connect_authorized(known_hosts_path, strict_mode).await?;
        let auth_result = handle.authenticate_password(&self.username, password).await?;

        if auth_result.success() {
            *self.handle.lock().await = Some(handle);
            self.touch_async().await;
            Ok(())
        } else {
            let remaining = match &auth_result {
                russh::client::AuthResult::Failure { remaining_methods, partial_success: _ } => {
                    format!("{:?}", remaining_methods)
                }
                _ => "unknown".to_string(),
            };
            tracing::error!(
                "Password auth rejected by {}@{}:{}. Remaining methods: {}",
                self.username,
                self.host,
                self.port,
                remaining,
            );
            Err(format!("Password authentication rejected by server (remaining methods: {})", remaining).into())
        }
    }

    /// Connect using public key authentication.
    ///
    /// # Arguments
    /// * `private_key_pem` - PEM-encoded private key
    /// * `passphrase` - Optional passphrase for encrypted keys
    /// * `known_hosts_path` - Optional path to known_hosts file
    /// * `strict_mode` - If true, reject unknown hosts; if false, auto-accept
    pub async fn connect_key(
        &self,
        private_key_pem: &str,
        passphrase: Option<&str>,
        known_hosts_path: Option<String>,
        strict_mode: bool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut handle = self.connect_authorized(known_hosts_path, strict_mode).await?;

        // Parse the private key using russh's internal ssh-key crate
        let mut private_key = russh::keys::ssh_key::PrivateKey::from_openssh(private_key_pem)?;

        // Decrypt if encrypted and passphrase provided
        if private_key.is_encrypted() {
            if let Some(pw) = passphrase {
                private_key = private_key.decrypt(pw)?;
            } else {
                return Err("Private key is encrypted but no passphrase provided".into());
            }
        }

        let key_with_hash = PrivateKeyWithHashAlg::new(Arc::new(private_key), None);

        let auth_result = handle.authenticate_publickey(&self.username, key_with_hash).await?;

        if auth_result.success() {
            *self.handle.lock().await = Some(handle);
            self.touch_async().await;
            Ok(())
        } else {
            Err("Public key authentication rejected by server".into())
        }
    }

    /// Get a cached SFTP session, creating one if necessary.
    ///
    /// SFTP sessions are spawned as a channel on the SSH connection and
    /// can be reused for multiple file operations, avoiding the overhead
    /// of repeatedly negotiating the SFTP protocol.
    pub async fn get_sftp_session(&self) -> Result<Arc<SftpSession>, Box<dyn std::error::Error + Send + Sync>> {
        use russh_sftp::client::SftpSession;

        self.touch_async().await;

        // Check cache first
        {
            let cache = self.sftp_cache.lock().await;
            if let Some(sftp) = cache.as_ref() {
                return Ok(sftp.clone());
            }
        }

        // Serialize cache misses, then check again before opening a channel.
        let _init_guard = self.sftp_init_lock.lock().await;
        {
            let cache = self.sftp_cache.lock().await;
            if let Some(sftp) = cache.as_ref() {
                return Ok(sftp.clone());
            }
        }

        // Create new SFTP session
        let mut handle_lock = self.handle.lock().await;
        let handle = handle_lock.as_mut().ok_or_else(|| "SSH not connected".to_string())?;

        let channel = handle.channel_open_session().await?;
        channel
            .request_subsystem(true, "sftp")
            .await
            .map_err(|e| format!("SFTP subsystem request failed: {}", e))?;

        let stream = channel.into_stream();
        let raw = SftpSession::new(stream)
            .await
            .map_err(|e| format!("SFTP session init failed: {}", e))?;

        let sftp = Arc::new(raw);

        // Cache for future reuse
        *self.sftp_cache.lock().await = Some(sftp.clone());

        Ok(sftp)
    }

    pub async fn acquire_sftp_permit(&self) -> OwnedSemaphorePermit {
        self.sftp_parallelism
            .clone()
            .acquire_owned()
            .await
            .expect("SFTP parallelism semaphore closed")
    }

    /// Clear the cached SFTP session (call after a failed SFTP operation).
    pub async fn clear_sftp_cache(&self) {
        self.sftp_cache.lock().await.take();
    }

    /// Execute a command and return (stdout, stderr, exit_code).
    ///
    /// This keeps the historical unbounded behavior for generic SSH callers.
    pub async fn exec(&self, command: &str) -> Result<(String, String, u32), Box<dyn std::error::Error + Send + Sync>> {
        let output = self
            .exec_with_limits(command, usize::MAX, usize::MAX, true, None, None)
            .await?;
        Ok((output.stdout, output.stderr, output.exit_code))
    }

    /// A bounded command result for callers that expose remote output over an API.
    /// The channel is still drained after the limit is reached, so the SSH session
    /// remains reusable while memory use is bounded.
    pub async fn exec_limited(
        &self,
        command: &str,
        max_stdout_bytes: usize,
        max_stderr_bytes: usize,
    ) -> Result<ExecOutput, Box<dyn std::error::Error + Send + Sync>> {
        // Keep the bounded API path without a PTY so SSH preserves stderr.
        self.exec_with_limits(
            command,
            max_stdout_bytes,
            max_stderr_bytes,
            false,
            Some(Duration::from_secs(300)),
            None,
        )
        .await
    }

    /// Execute a bounded command that supports remote process-group
    /// cancellation: SIGTERM → short wait → SIGKILL.
    pub async fn exec_limited_cancellable(
        &self,
        command: &str,
        max_stdout_bytes: usize,
        max_stderr_bytes: usize,
        cancel: tokio_util::sync::CancellationToken,
    ) -> Result<ExecOutput, Box<dyn std::error::Error + Send + Sync>> {
        self.exec_with_limits(
            &cancellable_process_group_command(command),
            max_stdout_bytes,
            max_stderr_bytes,
            false,
            Some(Duration::from_secs(300)),
            Some(cancel),
        )
        .await
    }
    async fn exec_with_limits(
        &self,
        command: &str,
        max_stdout_bytes: usize,
        max_stderr_bytes: usize,
        request_pty: bool,
        read_timeout: Option<Duration>,
        cancel: Option<tokio_util::sync::CancellationToken>,
    ) -> Result<ExecOutput, Box<dyn std::error::Error + Send + Sync>> {
        self.touch_async().await;
        let mut lock = self.handle.lock().await;
        let handle = lock.as_mut().ok_or("SSH not connected")?;

        let channel = handle.channel_open_session().await?;

        if request_pty {
            // Preserve the historical generic exec behavior.
            let _ = channel.request_pty(false, "xterm-256color", 80, 24, 0, 0, &[]).await;
        }

        channel.exec(true, command).await?;

        // Read stdout and stderr until EOF using russh's streaming API
        let (mut channel, cancel_channel) = channel.split();
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();
        let mut stdout_truncated = false;
        let mut stderr_truncated = false;
        let mut exit_code: u32 = 0;

        {
            let read_output = async {
                loop {
                    match channel.wait().await {
                        Some(russh::ChannelMsg::Data { ref data }) => {
                            stdout_truncated |= append_bounded(&mut stdout_buf, data, max_stdout_bytes);
                        }
                        Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                            stderr_truncated |= append_bounded(&mut stderr_buf, data, max_stderr_bytes);
                        }
                        Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                            exit_code = exit_status;
                        }
                        Some(russh::ChannelMsg::Eof) | None => break,
                        _ => {}
                    }
                }
            };
            let read_output = async {
                if let Some(duration) = read_timeout {
                    timeout(duration, read_output)
                        .await
                        .map_err(|_| format!("SSH exec timed out after {} seconds", duration.as_secs()))?;
                } else {
                    read_output.await;
                }
                Ok::<(), Box<dyn std::error::Error + Send + Sync>>(())
            };
            tokio::pin!(read_output);

            if let Some(cancel) = cancel {
                // The write half signals while the read half continues draining
                // during the grace period, allowing a clean remote exit.
                tokio::select! {
                    result = &mut read_output => result?,
                    _ = cancel.cancelled() => {
                        let _ = cancel_channel.signal(russh::Sig::TERM).await;
                        if timeout(EXEC_CANCEL_GRACE, &mut read_output).await.is_err() {
                            let _ = cancel_channel.signal(russh::Sig::KILL).await;
                        }
                        return Err("SSH exec cancelled (remote process group terminated)".into());
                    }
                }
            } else {
                read_output.await?;
            }
        }

        let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
        let stderr = String::from_utf8_lossy(&stderr_buf).to_string();
        Ok(ExecOutput { stdout, stderr, exit_code, stdout_truncated, stderr_truncated })
    }

    /// Open an interactive shell with PTY allocation.
    /// Returns a channel that can be used for bidirectional I/O.
    /// Use `channel.wait()` to receive output events and `channel.data()` to write stdin.
    #[allow(dead_code)]
    pub async fn open_shell(
        &self,
        cols: u32,
        rows: u32,
    ) -> Result<russh::Channel<client::Msg>, Box<dyn std::error::Error + Send + Sync>> {
        let mut lock = self.handle.lock().await;
        let handle = lock.as_mut().ok_or_else(|| {
            let msg = format!(
                "SSH not connected: handle is None for {}@{}:{} (conn_id={})",
                self.username, self.host, self.port, self.connection_id
            );
            tracing::error!("{}", msg);
            msg
        })?;

        let channel = handle.channel_open_session().await?;

        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await?;

        // Keep the interactive shell unmodified. Plain progress is an explicit,
        // local choice in the Docker API/display controls; injecting it here
        // changes the user's entire SSH environment and affects non-Docker tools.
        channel.exec(true, "bash -i").await?;

        Ok(channel)
    }

    /// Resize the PTY for an active shell channel.
    /// Must use `window_change` (SSH_MSG_CHANNEL_REQUEST "window-change"); calling
    /// `request_pty` again on an established channel does nothing.
    pub async fn resize_pty(
        &self,
        channel: &russh::Channel<client::Msg>,
        cols: u32,
        rows: u32,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        channel.window_change(cols, rows, 0, 0).await?;
        Ok(())
    }

    /// Execute a command and return the channel for streaming output (e.g., tail -f).
    /// The caller is responsible for reading from the channel using channel.wait().
    pub async fn stream_exec(
        &self,
        command: &str,
        cols: u32,
        rows: u32,
    ) -> Result<russh::Channel<client::Msg>, Box<dyn std::error::Error + Send + Sync>> {
        let mut lock = self.handle.lock().await;
        let handle = lock.as_mut().ok_or("SSH not connected")?;

        let channel = handle.channel_open_session().await?;

        // Request PTY for better compatibility
        let _ = channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await;

        channel.exec(true, command).await?;

        Ok(channel)
    }

    /// Get a lock to access the underlying client handle (for advanced channel management).
    pub async fn get_handle(&self) -> tokio::sync::MutexGuard<'_, Option<client::Handle<SshHandler>>> {
        self.handle.lock().await
    }

    /// Disconnect the SSH session and clear SFTP cache.
    pub async fn disconnect(&self) {
        self.sftp_cache.lock().await.take();
        let mut lock = self.handle.lock().await;
        if let Some(handle) = lock.take() {
            let _ = handle
                .disconnect(russh::Disconnect::ByApplication, "client disconnect", "en")
                .await;
        }
    }

    /// Check if the session is still connected.
    pub async fn is_connected(&self) -> bool {
        let lock = self.handle.lock().await;
        lock.as_ref().is_some_and(|h| !h.is_closed())
    }
}

#[cfg(test)]
mod tests {
    use super::append_bounded;

    #[test]
    fn append_bounded_caps_bytes_and_reports_truncation() {
        let mut buffer = Vec::new();
        assert!(!append_bounded(&mut buffer, b"abc", 5));
        assert_eq!(buffer, b"abc");
        assert!(append_bounded(&mut buffer, b"def", 5));
        assert_eq!(buffer, b"abcde");
        assert!(!append_bounded(&mut buffer, b"", 5));
    }

    #[test]
    fn append_bounded_handles_zero_limit() {
        let mut buffer = Vec::new();
        assert!(append_bounded(&mut buffer, b"output", 0));
        assert!(buffer.is_empty());
    }
}

#[test]
fn cancellable_command_uses_a_process_group_and_escapes_the_user_command() {
    let wrapped = cancellable_process_group_command("sleep 30; echo '$danger'");
    assert!(wrapped.starts_with("bash -c "));
    assert!(wrapped.contains("setsid sh -c \"$1\""));
    assert!(wrapped.contains("kill -TERM -- \"-$child\""));
    assert!(wrapped.contains("kill -KILL -- \"-$child\""));
    assert!(wrapped.ends_with("'sleep 30; echo '\\''$danger'\\'''"));
}
