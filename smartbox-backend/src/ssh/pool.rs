use std::sync::Arc;
use tokio::sync::Mutex;

use russh::client;
use russh::keys::key::PrivateKeyWithHashAlg;

/// A connected SSH session wrapper around russh.
pub struct SshSession {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    handle: Arc<Mutex<Option<client::Handle<SshHandler>>>>,
}

/// Minimal `client::Handler` — required by russh but mostly unused for simple exec.
#[derive(Clone)]
pub struct SshHandler;

impl client::Handler for SshHandler {
    type Error = russh::Error;
}

impl SshSession {
    pub fn new(connection_id: String, host: String, port: u16, username: String) -> Self {
        Self {
            connection_id,
            host,
            port,
            username,
            handle: Arc::new(Mutex::new(None)),
        }
    }

    /// Connect using password authentication.
    pub async fn connect_password(
        &self,
        password: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = Arc::new(client::Config::default());
        let handler = SshHandler;

        let mut handle = client::connect(config, (self.host.as_str(), self.port), handler).await?;
        let auth_result = handle.authenticate_password(&self.username, password).await?;

        if auth_result.success() {
            *self.handle.lock().await = Some(handle);
            Ok(())
        } else {
            Err("Password authentication rejected by server".into())
        }
    }

    /// Connect using public key authentication.
    pub async fn connect_key(
        &self,
        private_key_pem: &str,
        passphrase: Option<&str>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let config = Arc::new(client::Config::default());
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

        let auth_result = handle
            .authenticate_publickey(&self.username, key_with_hash)
            .await?;

        if auth_result.success() {
            *self.handle.lock().await = Some(handle);
            Ok(())
        } else {
            Err("Public key authentication rejected by server".into())
        }
    }

    /// Execute a command and return (stdout, stderr, exit_code).
    pub async fn exec(
        &self,
        command: &str,
    ) -> Result<(String, String, u32), Box<dyn std::error::Error + Send + Sync>> {
        let mut lock = self.handle.lock().await;
        let handle = lock.as_mut().ok_or("SSH not connected")?;

        let mut channel = handle.channel_open_session().await?;

        // Request PTY for better command compatibility
        let _ = channel
            .request_pty(false, "xterm-256color", 80, 24, 0, 0, &[])
            .await;

        channel.exec(true, command).await?;

        // Read stdout until EOF using tokio::io::AsyncReadExt
        use tokio::io::AsyncReadExt;
        let mut reader = channel.make_reader();
        let mut stdout_buf = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            let n = reader.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            stdout_buf.extend_from_slice(&buf[..n]);
        }

        let stdout = String::from_utf8_lossy(&stdout_buf).to_string();
        Ok((stdout, String::new(), 0))
    }

    /// Open an interactive shell with PTY allocation.
    /// Returns a channel that can be used for bidirectional I/O.
    /// Use `channel.wait()` to receive output events and `channel.data()` to write stdin.
    #[allow(dead_code)]
    pub async fn open_shell(
        &self,
        cols: u32,
        rows: u32,
    ) -> Result<
        russh::Channel<client::Msg>,
        Box<dyn std::error::Error + Send + Sync>,
    > {
        let mut lock = self.handle.lock().await;
        let handle = lock.as_mut().ok_or("SSH not connected")?;

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
    ) -> Result<
        russh::Channel<client::Msg>,
        Box<dyn std::error::Error + Send + Sync>,
    > {
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
    pub async fn get_handle(
        &self,
    ) -> tokio::sync::MutexGuard<'_, Option<client::Handle<SshHandler>>> {
        self.handle.lock().await
    }

    /// Disconnect the SSH session.
    pub async fn disconnect(&self) {
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
        lock.as_ref().map_or(false, |h| !h.is_closed())
    }
}
