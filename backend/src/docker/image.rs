use serde::{Deserialize, Serialize};

/// Docker image summary
#[derive(Debug, Serialize, Deserialize)]
pub struct ImageSummary {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size: i64,
    pub created: String,
}

/// List Docker images
pub async fn list_images() -> Vec<ImageSummary> {
    Vec::new()
}

/// Pull a Docker image
pub async fn pull_image(_image: &str) -> Result<(), String> {
    Ok(())
}

/// Remove a Docker image
pub async fn remove_image(_id: &str, _force: bool) -> Result<(), String> {
    Ok(())
}
