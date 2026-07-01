use serde::{Deserialize, Serialize};

/// Docker Compose project
#[derive(Debug, Serialize, Deserialize)]
pub struct ComposeProject {
    pub name: String,
    pub config_files: Vec<String>,
    pub working_dir: String,
}

/// List Docker Compose projects
pub async fn list_projects() -> Vec<ComposeProject> {
    Vec::new()
}

/// docker-compose up
pub async fn compose_up(_project: &str) -> Result<(), String> {
    Ok(())
}

/// docker-compose down
pub async fn compose_down(_project: &str) -> Result<(), String> {
    Ok(())
}
