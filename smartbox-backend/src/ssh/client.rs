use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

/// Represents an SSH connection managed by the system.
#[derive(Clone)]
pub struct SshConnection {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    connected: std::sync::Arc<AtomicBool>,
    // In a full implementation, this would hold a russh session handle
}

impl SshConnection {
    pub fn new(connection_id: String, host: String, port: u16, username: String) -> Self {
        Self {
            connection_id,
            host,
            port,
            username,
            connected: std::sync::Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn is_connected(&self) -> bool {
        self.connected.load(Ordering::Relaxed)
    }

    pub fn set_connected(&self, connected: bool) {
        self.connected.store(connected, Ordering::Relaxed);
    }
}

/// SSH connection request from client
#[derive(Debug, Deserialize)]
pub struct ConnectRequest {
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<String>,
    pub sudo_password: Option<String>,
}

/// SSH connection result
#[derive(Debug, Serialize)]
pub struct ConnectResult {
    pub connection_id: String,
    pub connected: bool,
    pub error: Option<String>,
}
