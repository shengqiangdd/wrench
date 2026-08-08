//! notify.rs — Standalone notification dispatcher
//!
//! Sends alerts via configured notification channels (Discord, Slack,
//! Telegram) without depending on AppState. Called directly from the
//! alert system when a new alert is triggered.

use serde_json::Value;

/// Alert severity levels matching the frontend.
#[derive(Debug, Clone, PartialEq)]
pub enum AlertLevel {
    Critical,
    Warning,
    Info,
}

impl AlertLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            AlertLevel::Critical => "critical",
            AlertLevel::Warning => "warning",
            AlertLevel::Info => "info",
        }
    }

    pub fn parse_level(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "critical" => AlertLevel::Critical,
            "warning" => AlertLevel::Warning,
            _ => AlertLevel::Info,
        }
    }
}

/// Send an alert notification through the given channel if the channel's
/// filters match the alert level and metric.
///
/// Returns `Ok(true)` if sent, `Ok(false)` if filtered out, `Err(reason)` on failure.
pub async fn dispatch_alert(
    channel: &crate::db::NotificationChannel,
    level: &AlertLevel,
    metric: &str,
    host: &str,
    message: &str,
) -> Result<bool, String> {
    let config: Value = serde_json::from_str(&channel.config).map_err(|e| format!("Invalid channel config: {}", e))?;

    // Check alert filters (optional)
    if let Some(filters) = config.get("alert_filters") {
        if !should_send_alert(filters, level, metric) {
            return Ok(false);
        }
    }

    let body = format_alert_message(level, metric, host, message);

    match channel.channel_type.as_str() {
        "discord" => send_discord(&config, &body).await,
        "slack" => send_slack(&config, &body).await,
        "telegram" => send_telegram(&config, &body).await,
        "email" => {
            tracing::warn!("Email notification requires `lettre` crate — skipped");
            Ok(false)
        }
        t => Err(format!("Unsupported channel type: {}", t)),
    }
}

/// Check if an alert should be sent based on the channel's filter configuration.
fn should_send_alert(filters: &Value, level: &AlertLevel, metric: &str) -> bool {
    // Check level filter
    if let Some(levels) = filters.get("levels").and_then(|v| v.as_array()) {
        if !levels
            .iter()
            .any(|l| l.as_str().is_some_and(|s| AlertLevel::parse_level(s) == *level))
        {
            return false;
        }
    }

    // Check metric filter
    if let Some(metrics) = filters.get("metrics").and_then(|v| v.as_array()) {
        if !metrics.iter().any(|m| m.as_str().is_some_and(|s| metric.contains(s))) {
            return false;
        }
    }

    true
}

fn format_alert_message(level: &AlertLevel, metric: &str, host: &str, message: &str) -> String {
    let emoji = match level {
        AlertLevel::Critical => "🔴",
        AlertLevel::Warning => "🟡",
        AlertLevel::Info => "🔵",
    };
    format!(
        "{} **Wrench Alert**\n**Level**: {}\n**Host**: {}\n**Metric**: {}\n**Message**: {}",
        emoji,
        level.as_str().to_uppercase(),
        host,
        metric,
        message
    )
}

async fn send_discord(config: &Value, body: &str) -> Result<bool, String> {
    let webhook = config
        .get("webhookUrl")
        .and_then(|v| v.as_str())
        .ok_or("Missing webhookUrl")?;

    let payload = serde_json::json!({ "content": body });
    let client = reqwest::Client::new();
    let resp = client
        .post(webhook)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Discord: {}", e))?;

    if resp.status().is_success() {
        Ok(true)
    } else {
        Err(format!("Discord HTTP {}", resp.status()))
    }
}

async fn send_slack(config: &Value, body: &str) -> Result<bool, String> {
    let webhook = config
        .get("webhookUrl")
        .and_then(|v| v.as_str())
        .ok_or("Missing webhookUrl")?;

    let payload = serde_json::json!({ "text": body });
    let client = reqwest::Client::new();
    let resp = client
        .post(webhook)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Slack: {}", e))?;

    if resp.status().is_success() {
        Ok(true)
    } else {
        Err(format!("Slack HTTP {}", resp.status()))
    }
}

async fn send_telegram(config: &Value, body: &str) -> Result<bool, String> {
    let token = config
        .get("botToken")
        .and_then(|v| v.as_str())
        .ok_or("Missing botToken")?;
    let chat_id = config.get("chatId").and_then(|v| v.as_str()).ok_or("Missing chatId")?;

    let url = format!("https://api.telegram.org/bot{}/sendMessage", token);
    let payload = serde_json::json!({
        "chat_id": chat_id,
        "text": body,
        "parse_mode": "Markdown",
    });

    let client = reqwest::Client::new();
    let resp = client
        .post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Telegram: {}", e))?;

    if resp.status().is_success() {
        Ok(true)
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!("Telegram HTTP {}: {}", status, text))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alert_level_from_str() {
        assert_eq!(AlertLevel::parse_level("critical"), AlertLevel::Critical);
        assert_eq!(AlertLevel::parse_level("warning"), AlertLevel::Warning);
        assert_eq!(AlertLevel::parse_level("info"), AlertLevel::Info);
        assert_eq!(AlertLevel::parse_level("unknown"), AlertLevel::Info);
    }

    #[test]
    fn test_alert_level_as_str() {
        assert_eq!(AlertLevel::Critical.as_str(), "critical");
        assert_eq!(AlertLevel::Warning.as_str(), "warning");
        assert_eq!(AlertLevel::Info.as_str(), "info");
    }

    #[test]
    fn test_should_send_alert_no_filters() {
        let filters = serde_json::json!({});
        assert!(should_send_alert(&filters, &AlertLevel::Critical, "cpu"));
    }

    #[test]
    fn test_should_send_alert_level_match() {
        let filters = serde_json::json!({
            "levels": ["critical", "warning"]
        });
        assert!(should_send_alert(&filters, &AlertLevel::Critical, "cpu"));
        assert!(!should_send_alert(&filters, &AlertLevel::Info, "cpu"));
    }

    #[test]
    fn test_should_send_alert_metric_match() {
        let filters = serde_json::json!({
            "metrics": ["cpu", "memory"]
        });
        assert!(should_send_alert(&filters, &AlertLevel::Warning, "cpu"));
        assert!(should_send_alert(&filters, &AlertLevel::Warning, "memory_usage"));
        assert!(!should_send_alert(&filters, &AlertLevel::Warning, "disk"));
    }

    #[test]
    fn test_should_send_alert_level_and_metric() {
        let filters = serde_json::json!({
            "levels": ["critical"],
            "metrics": ["cpu"]
        });
        assert!(should_send_alert(&filters, &AlertLevel::Critical, "cpu_load"));
        assert!(!should_send_alert(&filters, &AlertLevel::Warning, "cpu"));
        assert!(!should_send_alert(&filters, &AlertLevel::Critical, "memory"));
    }

    #[test]
    fn test_format_alert_message() {
        let msg = format_alert_message(&AlertLevel::Critical, "cpu", "server-01", "CPU usage > 90%");
        assert!(msg.contains("CRITICAL"));
        assert!(msg.contains("server-01"));
        assert!(msg.contains("cpu"));
        assert!(msg.contains("CPU usage > 90%"));
    }
}
