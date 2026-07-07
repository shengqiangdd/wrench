//! Notification Channels API — send alerts to external services.
//!
//! Supports: Discord, Slack, Telegram, Email (SMTP).
//!
//! Endpoints:
//!   GET    /api/notifications          — List channels
//!   POST   /api/notifications          — Create/update channel
//!   DELETE /api/notifications/:id      — Delete channel
//!   POST   /api/notifications/test/:id — Send test alert

use axum::{extract::Path, extract::State, Json};
use std::sync::Arc;

use crate::api_types::{NotificationChannelEntry, NotificationChannelsResponse};
use crate::app_state::AppState;
use crate::db::NotificationChannel;
use crate::error::AppError;
use crate::response::ApiResponse;

const SUPPORTED_TYPES: &[&str] = &["discord", "slack", "telegram", "email"];

/// List notification channels (GET /api/notifications)
pub async fn list_channels(
    State(state): State<Arc<AppState>>,
) -> Result<ApiResponse<NotificationChannelsResponse>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let channels = db
        .list_notification_channels()
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    let entries: Vec<NotificationChannelEntry> = channels
        .iter()
        .map(|ch| {
            let config: serde_json::Value = serde_json::from_str(&ch.config).unwrap_or_default();
            NotificationChannelEntry {
                id: ch.id.clone(),
                channel_type: ch.channel_type.clone(),
                name: ch.name.clone(),
                config,
                enabled: ch.enabled,
                created_at: ch.created_at.clone(),
                updated_at: ch.updated_at.clone(),
            }
        })
        .collect();

    let total = entries.len();
    Ok(ApiResponse::success(NotificationChannelsResponse { total, channels: entries }))
}

/// Create or update a notification channel (POST /api/notifications)
pub async fn upsert_channel(
    State(state): State<Arc<AppState>>,
    Json(body): Json<serde_json::Value>,
) -> Result<ApiResponse<NotificationChannelEntry>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let name = body.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let channel_type = body.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let config = body.get("config").cloned().unwrap_or_default();
    let enabled = body.get("enabled").and_then(|v| v.as_bool()).unwrap_or(true);

    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".into()));
    }
    if !SUPPORTED_TYPES.contains(&channel_type.as_str()) {
        return Err(AppError::BadRequest(format!(
            "unsupported type: {}. Supported: {:?}",
            channel_type, SUPPORTED_TYPES
        )));
    }

    let id = body
        .get("id")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let config_str = serde_json::to_string(&config).unwrap_or_else(|_| "{}".into());

    let channel = NotificationChannel {
        id: id.clone(),
        name,
        channel_type,
        config: config_str,
        enabled,
        created_at: now.clone(),
        updated_at: now,
    };

    db.upsert_notification_channel(&channel)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    Ok(ApiResponse::success(NotificationChannelEntry {
        id: channel.id,
        channel_type: channel.channel_type,
        name: channel.name,
        config,
        enabled: channel.enabled,
        created_at: channel.created_at,
        updated_at: channel.updated_at,
    }))
}

/// Delete a notification channel (DELETE /api/notifications/:id)
pub async fn delete_channel(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<String>,
) -> Result<ApiResponse<()>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let deleted = db
        .delete_notification_channel(&channel_id)
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    if !deleted {
        return Err(AppError::NotFound("Channel not found".into()));
    }

    Ok(ApiResponse::success(()))
}

/// Send a test alert to a channel (POST /api/notifications/test/:id)
pub async fn test_channel(
    State(state): State<Arc<AppState>>,
    Path(channel_id): Path<String>,
) -> Result<ApiResponse<String>, AppError> {
    let db = state
        .db
        .as_ref()
        .ok_or_else(|| AppError::NotFound("Database not available".into()))?;

    let channels = db
        .list_notification_channels()
        .await
        .map_err(|e| AppError::Internal(format!("DB error: {}", e)))?;

    let channel = channels
        .into_iter()
        .find(|ch| ch.id == channel_id)
        .ok_or_else(|| AppError::NotFound("Channel not found".into()))?;

    let config: serde_json::Value = serde_json::from_str(&channel.config).unwrap_or_default();

    // Send test message
    let test_result = match channel.channel_type.as_str() {
        "discord" => send_discord_test(&config).await,
        "slack" => send_slack_test(&config).await,
        "telegram" => send_telegram_test(&config).await,
        "email" => send_email_test(&config).await,
        _ => Err("Unsupported channel type".into()),
    };

    match test_result {
        Ok(msg) => Ok(ApiResponse::success(msg)),
        Err(e) => Err(AppError::Internal(format!("Test failed: {}", e))),
    }
}

async fn send_discord_test(config: &serde_json::Value) -> Result<String, String> {
    let webhook = config
        .get("webhookUrl")
        .and_then(|v| v.as_str())
        .ok_or("Missing webhookUrl")?;
    let client = reqwest::Client::new();
    let resp = client
        .post(webhook)
        .json(&serde_json::json!({
            "content": "✅ **Wrench Test Alert**\nNotification channel is working correctly!",
            "username": "Wrench",
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if resp.status().is_success() {
        Ok("Discord test message sent".into())
    } else {
        Err(format!("Discord responded with status: {}", resp.status()))
    }
}

async fn send_slack_test(config: &serde_json::Value) -> Result<String, String> {
    let webhook = config
        .get("webhookUrl")
        .and_then(|v| v.as_str())
        .ok_or("Missing webhookUrl")?;
    let client = reqwest::Client::new();
    let resp = client
        .post(webhook)
        .json(&serde_json::json!({
            "text": "✅ *Wrench Test Alert*\nNotification channel is working correctly!"
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if resp.status().is_success() {
        Ok("Slack test message sent".into())
    } else {
        Err(format!("Slack responded with status: {}", resp.status()))
    }
}

async fn send_telegram_test(config: &serde_json::Value) -> Result<String, String> {
    let bot_token = config
        .get("botToken")
        .and_then(|v| v.as_str())
        .ok_or("Missing botToken")?;
    let chat_id = config.get("chatId").and_then(|v| v.as_str()).ok_or("Missing chatId")?;
    let client = reqwest::Client::new();
    let url = format!("https://api.telegram.org/bot{}/sendMessage", bot_token);
    let resp = client
        .post(&url)
        .json(&serde_json::json!({
            "chat_id": chat_id,
            "text": "✅ *Wrench Test Alert*\nNotification channel is working correctly!",
            "parse_mode": "Markdown",
        }))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if resp.status().is_success() {
        Ok("Telegram test message sent".into())
    } else {
        let err_text = resp.text().await.unwrap_or_default();
        Err(format!("Telegram error: {}", err_text))
    }
}

async fn send_email_test(config: &serde_json::Value) -> Result<String, String> {
    let _smtp_host = config
        .get("smtpHost")
        .and_then(|v| v.as_str())
        .ok_or("Missing smtpHost")?;
    let _smtp_port = config.get("smtpPort").and_then(|v| v.as_u64()).unwrap_or(587);
    let _username = config
        .get("username")
        .and_then(|v| v.as_str())
        .ok_or("Missing username")?;
    let _password = config
        .get("password")
        .and_then(|v| v.as_str())
        .ok_or("Missing password")?;
    let _from = config.get("from").and_then(|v| v.as_str()).ok_or("Missing from")?;
    let _to = config.get("to").and_then(|v| v.as_str()).ok_or("Missing to")?;

    // SMTP sending would go here — requires `lettre` or similar crate
    // For now, return a placeholder
    Err("SMTP sending requires the `lettre` crate — not yet implemented".into())
}
