use serde::Serialize;

/// Real-time container resource stats
#[derive(Debug, Serialize)]
pub struct ContainerStats {
    pub cpu_percent: f64,
    pub mem_usage: u64,
    pub mem_limit: u64,
    pub mem_percent: f64,
    pub net_rx: u64,
    pub net_tx: u64,
    pub block_read: u64,
    pub block_write: u64,
    pub timestamp: String,
}

/// Stream container stats periodically.
/// In a full implementation, this uses bollard to get Docker stats.
pub async fn stream_stats(_container_id: &str, _callback: impl Fn(ContainerStats) + Send + 'static) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

        let stats = ContainerStats {
            cpu_percent: 0.0,
            mem_usage: 0,
            mem_limit: 0,
            mem_percent: 0.0,
            net_rx: 0,
            net_tx: 0,
            block_read: 0,
            block_write: 0,
            timestamp: chrono::Local::now().to_rfc3339(),
        };

        _callback(stats);
    }
}
