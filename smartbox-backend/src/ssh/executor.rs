use crate::ssh::pool::SshSession;
use serde::Serialize;
use std::sync::Arc;

/// SSH command execution result
#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

/// Execute a single command on an SSH connection.
pub async fn execute_command(session: &Arc<SshSession>, command: &str) -> Result<ExecResult, String> {
    match session.exec(command).await {
        Ok((stdout, stderr, exit_code)) => Ok(ExecResult { stdout, stderr, exit_code: exit_code as i32 }),
        Err(e) => Err(format!("SSH exec failed: {}", e)),
    }
}

/// Execute a command on multiple hosts concurrently.
pub async fn batch_execute(_connection_ids: &[String], _command: &str) -> Vec<(String, Result<ExecResult, String>)> {
    // Future: concurrent execution across multiple SSH sessions
    Vec::new()
}
