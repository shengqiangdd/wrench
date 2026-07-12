use std::sync::Arc;
use std::time::Instant;
use tokio::sync::Mutex;

use russh::client;
use russh::keys::key::PrivateKeyWithHashAlg;
use russh_sftp::client::SftpSession;

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
}

// Default idle timeout: 30 minutes
const IDLE_TIMEOUT_SECS: u64 = 1800;

/// Minimal `client::Handler` — required by russh but mostly unused for simple exec.
#[derive(Clone)]
pub struct SshHandler;

impl client::Handler for SshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn auth_banner(
        &mut self,
        banner: &str,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        tracing::debug!("SSH auth banner: {banner}");
        Ok(())
    }
}

impl SshSession {
    pub fn new(connection_id: String, host: String, port: u16, username: String) -> Self {
        Self {
            connection_id,
            host,
            port,
            username,
            handle: Arc::new(Mutex::new(None)),
            last_used: Arc::new(Mutex::new(Instant::now())),
            sftp_cache: Arc::new(Mutex::new(None)),
        }
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
        let mut config = client::Config::default();
        // Send keepalive probes every 30 seconds to prevent idle disconnects
        config.keepalive_interval = Some(std::time::Duration::from_secs(30));
        // Close connection after 3 missed keepalives (90s total)
        config.keepalive_max = 3;
        // Disable Nagle's algorithm for lower latency on interactive sessions
        config.nodelay = true;
        Arc::new(config)
    }

    /// Connect using password authentication.
    pub async fn connect_password(&self, password: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = Self::build_config();
        let handler = SshHandler;

        let mut handle = client::connect(config, (self.host.as_str(), self.port), handler).await?;
        let auth_result = handle.authenticate_password(&self.username, password).await?;

        if auth_result.success() {
            *self.handle.lock().await = Some(handle);
            self.touch_async().await;
            Ok(())
        } else {
            let remaining = match &auth_result {
                russh::client::AuthResult::Failure { remaining_methods } => {
                    format!("{:?}", remaining_methods)
                }
                _ => "unknown".to_string(),
            };
            tracing::error!(
                "Password auth rejected by {}@{}:{}. Remaining methods: {}",
                self.username, self.host, self.port,
                remaining,
            );
            Err(format!("Password authentication rejected by server (remaining methods: {})", remaining).into())
        }
    }

    /// Connect using public key authentication.
    pub async fn connect_key(
        &self,
        private_key_pem: &str,
        passphrase: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = Self::build_config();
        let handler = SshHandler;

        let mut handle = client::connect(config, (self.host.as_str(), self.port), handler).await?;

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

    /// Clear the cached SFTP session (call after a failed SFTP operation).
    pub async fn clear_sftp_cache(&self) {
        self.sftp_cache.lock().await.take();
    }

    /// Execute a command and return (stdout, stderr, exit_code).
    pub async fn exec(&self, command: &str) -> Result<(String, String, u32), Box<dyn std::error::Error + Send + Sync>> {
        self.touch_async().await;
        let mut lock = self.handle.lock().await;
        let handle = lock.as_mut().ok_or("SSH not connected")?;

        let mut channel = handle.channel_open_session().await?;

        // Request PTY for better command compatibility
        let _ = channel.request_pty(false, "xterm-256color", 80, 24, 0, 0, &[]).await;

        channel.exec(true, command).await?;

        // Read stdout and stderr until EOF using russh's streaming API
        let mut stdout_buf = Vec::new();
        let mut stderr_buf = Vec::new();
        let mut exit_code: u32 = 0;

        loop {
            match channel.wait().await {
                Some(russh::ChannelMsg::Data { ref data }) => {
                    stdout_buf.extend_from_slice(data);
                }
                Some(russh::ChannelMsg::ExtendedData { ref data, .. }) => {
                    stderr_buf.extend_from_slice(data);
                }
                Some(russh::ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = exit_status;
                }
                Some(russh::ChannelMsg::Eof) | None => {
                    break;
                }
                _ => {}
            }
        }

        let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
        let stderr = String::from_utf8_lossy(&stderr_buf).to_string();
        Ok((stdout, stderr, exit_code))
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

        channel.request_shell(false).await?;

        Ok(channel)
    }

    /// Resize the PTY for an active shell channel.
    pub async fn resize_pty(
        &self,
        channel: &russh::Channel<client::Msg>,
        cols: u32,
        rows: u32,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        channel
            .request_pty(false, "xterm-256color", cols, rows, 0, 0, &[])
            .await?;
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
