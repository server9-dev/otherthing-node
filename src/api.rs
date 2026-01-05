//! Local API server module
//!
//! Provides a local HTTP API for monitoring and controlling the node agent.
//! Used by the UI and for local debugging.

use axum::{
    routing::{get, post},
    Router,
    Json,
    extract::State,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::info;

use crate::config::NodeConfig;
use crate::hardware::NodeCapabilities;

// ============ API State ============

pub struct ApiState {
    pub capabilities: NodeCapabilities,
    pub config: NodeConfig,
    pub status: RwLock<NodeStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub connected: bool,
    pub orchestrator_url: Option<String>,
    pub current_jobs: u32,
    pub total_jobs_completed: u64,
    pub total_earnings_cents: u64,
    pub uptime_seconds: u64,
}

// ============ API Endpoints ============

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}

#[derive(Debug, Serialize)]
struct InfoResponse {
    node_id: String,
    version: String,
    capabilities: NodeCapabilities,
    status: NodeStatus,
}

#[derive(Debug, Serialize)]
struct StatsResponse {
    current_jobs: u32,
    total_jobs_completed: u64,
    total_earnings_cents: u64,
    uptime_seconds: u64,
    earnings_by_currency: std::collections::HashMap<String, u64>,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    })
}

async fn info(State(state): State<Arc<ApiState>>) -> Json<InfoResponse> {
    let status = state.status.read().await.clone();

    Json(InfoResponse {
        node_id: state.capabilities.node_id.clone(),
        version: state.capabilities.node_version.clone(),
        capabilities: state.capabilities.clone(),
        status,
    })
}

async fn stats(State(state): State<Arc<ApiState>>) -> Json<StatsResponse> {
    let status = state.status.read().await;

    let mut earnings_by_currency = std::collections::HashMap::new();
    earnings_by_currency.insert(state.config.currency.clone(), status.total_earnings_cents);

    Json(StatsResponse {
        current_jobs: status.current_jobs,
        total_jobs_completed: status.total_jobs_completed,
        total_earnings_cents: status.total_earnings_cents,
        uptime_seconds: status.uptime_seconds,
        earnings_by_currency,
    })
}

async fn capabilities(State(state): State<Arc<ApiState>>) -> Json<NodeCapabilities> {
    Json(state.capabilities.clone())
}

#[derive(Debug, Deserialize)]
struct UpdatePricingRequest {
    gpu_hour_cents: Option<u32>,
    cpu_core_hour_cents: Option<u32>,
    memory_gb_hour_cents: Option<u32>,
    minimum_cents: Option<u32>,
}

async fn update_pricing(
    State(_state): State<Arc<ApiState>>,
    Json(_request): Json<UpdatePricingRequest>,
) -> Json<serde_json::Value> {
    // TODO: Update pricing in config
    Json(serde_json::json!({
        "success": true,
        "message": "Pricing update not yet implemented"
    }))
}

// ============ Router ============

pub fn create_router(state: Arc<ApiState>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/info", get(info))
        .route("/stats", get(stats))
        .route("/capabilities", get(capabilities))
        .route("/pricing", post(update_pricing))
        .with_state(state)
}

// ============ Server ============

pub async fn start_api_server(
    capabilities: NodeCapabilities,
    config: NodeConfig,
) -> anyhow::Result<()> {
    let port = config.network.api_port;

    let state = Arc::new(ApiState {
        capabilities,
        config,
        status: RwLock::new(NodeStatus {
            connected: false,
            orchestrator_url: None,
            current_jobs: 0,
            total_jobs_completed: 0,
            total_earnings_cents: 0,
            uptime_seconds: 0,
        }),
    });

    let app = create_router(state);

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{}", port)).await?;
    info!("Local API server listening on http://127.0.0.1:{}", port);

    axum::serve(listener, app).await?;

    Ok(())
}
