use std::sync::Arc;

use axum::{
    Json,
    extract::{Extension, State},
};
use serde::{Deserialize, Serialize};

use crate::{
    app_state::AppState,
    config::EgressProfile,
    response::{ApiError, ApiResponse},
    space::SpaceCtx,
};

const PREF_KEY: &str = "ssh_egress_profile";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EgressProfilesResponse {
    profiles: Vec<EgressProfile>,
    selected_profile_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateEgressProfileRequest {
    profile_id: Option<String>,
}

/// Resolve only a server-approved profile id stored for the current browser space.
pub async fn selected_profile(state: &AppState, space_id: &str) -> anyhow::Result<Option<EgressProfile>> {
    let Some(db) = state.db.as_ref() else { return Ok(None) };
    let Some(id) = db.get_space_preference(space_id, PREF_KEY).await? else {
        return Ok(None);
    };
    if id.is_empty() {
        return Ok(None);
    }
    state
        .config
        .egress_profiles
        .iter()
        .find(|profile| profile.id == id)
        .cloned()
        .map(Some)
        .ok_or_else(|| anyhow::anyhow!("configured egress profile {id:?} is no longer available"))
}

pub async fn list(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
) -> Result<Json<ApiResponse<EgressProfilesResponse>>, ApiError> {
    let selected = selected_profile(&state, &space.id)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to load egress preference: {e}")))?;
    Ok(Json(ApiResponse::success(EgressProfilesResponse {
        profiles: state.config.egress_profiles.clone(),
        selected_profile_id: selected.map(|profile| profile.id),
    })))
}

pub async fn update(
    State(state): State<Arc<AppState>>,
    Extension(space): Extension<SpaceCtx>,
    Json(body): Json<UpdateEgressProfileRequest>,
) -> Result<Json<ApiResponse<EgressProfilesResponse>>, ApiError> {
    if body
        .profile_id
        .as_ref()
        .is_some_and(|id| !state.config.egress_profiles.iter().any(|profile| profile.id == *id))
    {
        return Err(ApiError::bad_request("Unknown egress profile"));
    }
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| ApiError::internal("Space preferences are unavailable"))?;
    db.set_space_preference(&space.id, PREF_KEY, body.profile_id.as_deref().unwrap_or(""))
        .await
        .map_err(|e| ApiError::internal(format!("Failed to save egress preference: {e}")))?;
    let selected = selected_profile(&state, &space.id)
        .await
        .map_err(|e| ApiError::internal(format!("Failed to load egress preference: {e}")))?;
    Ok(Json(ApiResponse::success(EgressProfilesResponse {
        profiles: state.config.egress_profiles.clone(),
        selected_profile_id: selected.map(|profile| profile.id),
    })))
}
