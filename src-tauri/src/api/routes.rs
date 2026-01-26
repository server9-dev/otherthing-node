use axum::{
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::services::{HardwareDetector, IpfsManager, OllamaManager};

/// Shared application state
pub struct AppState {
    pub ollama: OllamaManager,
    pub ipfs: IpfsManager,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            ollama: OllamaManager::new(),
            ipfs: IpfsManager::new(),
        }
    }
}

// ============ Response Types ============

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub mode: &'static str,
}

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

// ============ Request Types ============

#[derive(Deserialize)]
pub struct PullModelRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct DeleteModelRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct AddContentRequest {
    pub content: String,
}

// ============ Routes ============

pub fn create_router(state: Arc<AppState>) -> Router {
    Router::new()
        // Health
        .route("/health", get(health))
        // Hardware
        .route("/api/v1/hardware", get(get_hardware))
        .route("/api/v1/drives", get(get_drives))
        // Ollama
        .route("/api/v1/ollama/status", get(ollama_status))
        .route("/api/v1/ollama/start", post(ollama_start))
        .route("/api/v1/ollama/stop", post(ollama_stop))
        .route("/api/v1/ollama/models", get(ollama_models))
        .route("/api/v1/ollama/pull", post(ollama_pull))
        .route("/api/v1/ollama/models/:name", delete(ollama_delete_model))
        // IPFS
        .route("/api/v1/ipfs/status", get(ipfs_status))
        .route("/api/v1/ipfs/start", post(ipfs_start))
        .route("/api/v1/ipfs/stop", post(ipfs_stop))
        .route("/api/v1/ipfs/add", post(ipfs_add))
        .route("/api/v1/ipfs/pin/:cid", post(ipfs_pin))
        .route("/api/v1/ipfs/pin/:cid", delete(ipfs_unpin))
        .with_state(state)
}

// ============ Health Handlers ============

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        version: "1.0.0",
        mode: "local",
    })
}

// ============ Hardware Handlers ============

async fn get_hardware() -> impl IntoResponse {
    let hardware = HardwareDetector::detect();
    Json(hardware)
}

async fn get_drives() -> impl IntoResponse {
    let drives = HardwareDetector::get_drives();
    Json(serde_json::json!({ "drives": drives }))
}

// ============ Ollama Handlers ============

async fn ollama_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let status = state.ollama.get_status().await;
    Json(status)
}

async fn ollama_start(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.ollama.start().await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ollama_stop(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.ollama.stop().await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ollama_models(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.ollama.list_models().await {
        Ok(models) => (StatusCode::OK, Json(serde_json::json!({ "models": models }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn ollama_pull(
    State(state): State<Arc<AppState>>,
    Json(req): Json<PullModelRequest>,
) -> impl IntoResponse {
    // Pull without progress for now (could add WebSocket for progress)
    match state.ollama.pull_model(&req.name, None).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ollama_delete_model(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(name): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.ollama.delete_model(&name).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

// ============ IPFS Handlers ============

async fn ipfs_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let status = state.ipfs.get_status().await;
    Json(status)
}

async fn ipfs_start(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.ipfs.start().await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ipfs_stop(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    match state.ipfs.stop().await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ipfs_add(
    State(state): State<Arc<AppState>>,
    Json(req): Json<AddContentRequest>,
) -> impl IntoResponse {
    match state.ipfs.add_content(&req.content).await {
        Ok(cid) => (StatusCode::OK, Json(serde_json::json!({ "success": true, "cid": cid }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ipfs_pin(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(cid): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.ipfs.pin(&cid).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

async fn ipfs_unpin(
    State(state): State<Arc<AppState>>,
    axum::extract::Path(cid): axum::extract::Path<String>,
) -> impl IntoResponse {
    match state.ipfs.unpin(&cid).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}
