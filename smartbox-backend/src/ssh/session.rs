use std::collections::HashMap;

/// Session management for SSH connections.
/// Each terminal tab or split pane has its own session.
#[derive(Debug)]
pub struct SshSession {
    pub session_id: String,
    pub connection_id: String,
    pub shell_type: String, // "shell", "exec", "docker_shell"
    pub cols: u32,
    pub rows: u32,
}

/// Manager for SSH sessions
#[derive(Debug, Default)]
pub struct SessionManager {
    sessions: HashMap<String, SshSession>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }

    pub fn create_session(&mut self, connection_id: String, shell_type: String) -> String {
        let session_id = uuid::Uuid::new_v4().to_string();
        let session = SshSession { session_id: session_id.clone(), connection_id, shell_type, cols: 80, rows: 24 };
        self.sessions.insert(session_id.clone(), session);
        session_id
    }

    pub fn get_session(&self, session_id: &str) -> Option<&SshSession> {
        self.sessions.get(session_id)
    }

    pub fn remove_session(&mut self, session_id: &str) {
        self.sessions.remove(session_id);
    }
}
