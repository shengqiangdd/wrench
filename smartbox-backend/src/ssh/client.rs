use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::ssh::SshSession;

/// Represents an SSH connection including its active session.
pub struct SshConnection {
    pub connection_id: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: String,
    pub session: Option<Arc<SshSession>>,
}

impl SshConnection {
    pub fn new(
        connection_id: String,
        host: String,
        port: u16,
        username: String,
        auth_method: String,
    ) -> Self {
        Self {
            connection_id,
            host,
            port,
            username,
            auth_method,
            session: None,
        }
    }

    pub fn is_connected(&self) -> bool {
        self.session.is_some()
    }

    pub fn set_session(&mut self, session: Arc<SshSession>) {
        self.session = Some(session);
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
