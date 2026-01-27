use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, delete},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::services::{
    AgentManager, CreateAgentRequest,
    HardwareDetector, IpfsManager, OllamaManager,
};

/// Shared application state
pub struct AppState {
    pub ollama: Arc<OllamaManager>,
    pub ipfs: Arc<IpfsManager>,
    pub agents: AgentManager,
    pub node_id: Arc<RwLock<String>>,
    pub share_key: Arc<RwLock<String>>,
    pub node_running: Arc<RwLock<bool>>,
}

impl AppState {
    pub fn new() -> Self {
        let ollama = Arc::new(OllamaManager::new());
        let ipfs = Arc::new(IpfsManager::new());

        // Generate persistent node ID and share key
        let node_id = generate_or_load_node_id();
        let share_key = generate_share_key();

        Self {
            agents: AgentManager::new(Arc::clone(&ollama)),
            ollama,
            ipfs,
            node_id: Arc::new(RwLock::new(node_id)),
            share_key: Arc::new(RwLock::new(share_key)),
            node_running: Arc::new(RwLock::new(true)), // Running by default
        }
    }
}

fn generate_or_load_node_id() -> String {
    // Try to load from config, or generate new
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("otherthing-node");

    let node_id_file = config_dir.join("node_id");

    if node_id_file.exists() {
        if let Ok(id) = std::fs::read_to_string(&node_id_file) {
            let id = id.trim().to_string();
            if !id.is_empty() {
                return id;
            }
        }
    }

    // Generate new node ID
    let node_id = uuid::Uuid::new_v4().to_string();

    // Save it
    let _ = std::fs::create_dir_all(&config_dir);
    let _ = std::fs::write(&node_id_file, &node_id);

    node_id
}

fn generate_share_key() -> String {
    // Try to load from config, or generate new
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("otherthing-node");

    let share_key_file = config_dir.join("share_key");

    if share_key_file.exists() {
        if let Ok(key) = std::fs::read_to_string(&share_key_file) {
            let key = key.trim().to_string();
            if !key.is_empty() {
                return key;
            }
        }
    }

    // Generate new share key (8 char alphanumeric, easy to type)
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};

    let s = RandomState::new();
    let mut hasher = s.build_hasher();
    hasher.write_u64(std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64);

    let chars: Vec<char> = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".chars().collect();
    let hash = hasher.finish();
    let mut key = String::new();

    for i in 0..8 {
        let idx = ((hash >> (i * 5)) & 0x1F) as usize % chars.len();
        key.push(chars[idx]);
    }

    // Save it
    let _ = std::fs::create_dir_all(&config_dir);
    let _ = std::fs::write(&share_key_file, &key);

    key
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
        // Node
        .route("/api/v1/node/status", get(node_status))
        .route("/api/v1/my-nodes", get(my_nodes))
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
        .route("/api/v1/ipfs/download", post(ipfs_download_binary))
        // Agents
        .route("/api/v1/workspaces/:workspace_id/agents", get(list_agents))
        .route("/api/v1/workspaces/:workspace_id/agents", post(create_agent))
        .route("/api/v1/workspaces/:workspace_id/agents/:execution_id", get(get_agent))
        .route("/api/v1/workspaces/:workspace_id/agents/:execution_id", delete(cancel_agent))
        // Cloud GPU proxy (bypasses CORS)
        .route("/api/v1/gpu/offers", get(gpu_offers))
        .route("/api/v1/gpu/instances", get(gpu_instances))
        .route("/api/v1/gpu/user", get(gpu_user))
        .route("/api/v1/gpu/rent/:offer_id", post(gpu_rent))
        .route("/api/v1/gpu/destroy/:instance_id", delete(gpu_destroy))
        .with_state(state)
}

// ============ Health Handlers ============

async fn health(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let share_key = state.share_key.read().await.clone();
    let node_id = state.node_id.read().await.clone();

    Json(serde_json::json!({
        "status": "ok",
        "version": "1.0.0",
        "mode": "local",
        "shareKey": share_key,
        "nodeId": node_id,
    }))
}

// ============ Node Handlers ============

async fn node_status(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let running = *state.node_running.read().await;
    let node_id = state.node_id.read().await.clone();
    let share_key = state.share_key.read().await.clone();

    // Get hardware for additional info
    let hardware = HardwareDetector::detect();

    Json(serde_json::json!({
        "running": running,
        "connected": running,
        "node_id": node_id,
        "share_key": share_key,
        "hardware": {
            "cpuCores": hardware.cpu.cores,
            "memoryMb": hardware.memory.total / (1024 * 1024),
            "gpuCount": hardware.gpu.len(),
        }
    }))
}

async fn my_nodes(State(state): State<Arc<AppState>>) -> impl IntoResponse {
    let node_id = state.node_id.read().await.clone();
    let share_key = state.share_key.read().await.clone();
    let running = *state.node_running.read().await;

    // Get hardware info
    let hardware = HardwareDetector::detect();

    // Return this node's info
    Json(serde_json::json!({
        "nodes": [{
            "id": node_id,
            "shareKey": share_key,
            "name": "Local Node",
            "status": if running { "online" } else { "offline" },
            "hardware": {
                "cpuCores": hardware.cpu.cores,
                "memoryMb": hardware.memory.total / (1024 * 1024),
                "gpuCount": hardware.gpu.len(),
            },
            "addedAt": chrono::Utc::now().to_rfc3339(),
        }]
    }))
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

async fn ipfs_download_binary(State(_state): State<Arc<AppState>>) -> impl IntoResponse {
    // Download Kubo (IPFS) binary
    match download_ipfs_binary().await {
        Ok(path) => {
            log::info!("IPFS binary downloaded to: {:?}", path);
            (StatusCode::OK, Json(serde_json::json!({ "success": true, "path": path.to_string_lossy() })))
        }
        Err(e) => {
            log::error!("Failed to download IPFS: {}", e);
            (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "success": false, "error": e })))
        }
    }
}

async fn download_ipfs_binary() -> Result<std::path::PathBuf, String> {
    let config_dir = dirs::config_dir()
        .ok_or("Could not find config directory")?
        .join("otherthing-node")
        .join("ipfs");

    std::fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create directory: {}", e))?;

    // Determine platform and architecture
    let version = "v0.32.1";

    #[cfg(target_os = "windows")]
    let (os, arch, archive_ext, bin_ext) = (
        "windows",
        if cfg!(target_arch = "x86_64") { "amd64" } else { "386" },
        "zip",
        ".exe"
    );

    #[cfg(target_os = "macos")]
    let (os, arch, archive_ext, bin_ext) = (
        "darwin",
        if cfg!(target_arch = "aarch64") { "arm64" } else { "amd64" },
        "tar.gz",
        ""
    );

    #[cfg(target_os = "linux")]
    let (os, arch, archive_ext, bin_ext) = (
        "linux",
        if cfg!(target_arch = "x86_64") { "amd64" } else { "arm64" },
        "tar.gz",
        ""
    );

    // Correct URL format: kubo_v0.32.1_windows-amd64.zip
    let filename = format!("kubo_{}_{}-{}", version, os, arch);
    let download_url = format!(
        "https://dist.ipfs.tech/kubo/{}/{}.{}",
        version, filename, archive_ext
    );

    log::info!("Downloading IPFS from: {}", download_url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let bytes = response.bytes().await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    log::info!("Downloaded {} bytes", bytes.len());

    let archive_path = config_dir.join(format!("{}.{}", filename, archive_ext));
    std::fs::write(&archive_path, &bytes)
        .map_err(|e| format!("Failed to write archive: {}", e))?;

    // Extract based on archive type
    #[cfg(target_os = "windows")]
    {
        // Use zip extraction for Windows
        let file = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Failed to open archive: {}", e))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Failed to read zip: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)
                .map_err(|e| format!("Failed to read zip entry: {}", e))?;

            let outpath = match file.enclosed_name() {
                Some(path) => config_dir.join(path),
                None => continue,
            };

            if file.name().ends_with('/') {
                std::fs::create_dir_all(&outpath).ok();
            } else {
                if let Some(p) = outpath.parent() {
                    std::fs::create_dir_all(p).ok();
                }
                let mut outfile = std::fs::File::create(&outpath)
                    .map_err(|e| format!("Failed to create file: {}", e))?;
                std::io::copy(&mut file, &mut outfile)
                    .map_err(|e| format!("Failed to extract file: {}", e))?;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Use tar.gz extraction for Unix
        let tar_gz = std::fs::File::open(&archive_path)
            .map_err(|e| format!("Failed to open archive: {}", e))?;
        let tar = flate2::read::GzDecoder::new(tar_gz);
        let mut archive = tar::Archive::new(tar);
        archive.unpack(&config_dir)
            .map_err(|e| format!("Failed to extract archive: {}", e))?;
    }

    // The binary is in kubo/ipfs
    let binary_path = config_dir.join("kubo").join(format!("ipfs{}", bin_ext));

    if !binary_path.exists() {
        return Err(format!("IPFS binary not found at {:?} after extraction", binary_path));
    }

    log::info!("IPFS binary extracted to: {:?}", binary_path);

    // Make executable on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&binary_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| format!("Failed to set permissions: {}", e))?;
    }

    // Clean up archive
    let _ = std::fs::remove_file(&archive_path);

    Ok(binary_path)
}

// ============ Agent Handlers ============

async fn list_agents(
    State(state): State<Arc<AppState>>,
    Path(workspace_id): Path<String>,
) -> impl IntoResponse {
    let executions = state.agents.list_executions(&workspace_id).await;
    Json(serde_json::json!({ "executions": executions }))
}

async fn get_agent(
    State(state): State<Arc<AppState>>,
    Path((_workspace_id, execution_id)): Path<(String, String)>,
) -> impl IntoResponse {
    match state.agents.get_execution(&execution_id).await {
        Some(exec) => (StatusCode::OK, Json(serde_json::json!({ "execution": exec }))),
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "Execution not found" })),
        ),
    }
}

async fn create_agent(
    State(state): State<Arc<AppState>>,
    Path(workspace_id): Path<String>,
    Json(req): Json<CreateAgentRequest>,
) -> impl IntoResponse {
    match state.agents.create_execution(&workspace_id, req).await {
        Ok(exec) => (StatusCode::OK, Json(serde_json::json!({ "execution": exec }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e })),
        ),
    }
}

async fn cancel_agent(
    State(state): State<Arc<AppState>>,
    Path((_workspace_id, execution_id)): Path<(String, String)>,
) -> impl IntoResponse {
    match state.agents.cancel_execution(&execution_id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "success": true }))),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "success": false, "error": e })),
        ),
    }
}

// ============ Cloud GPU Proxy Handlers ============

#[derive(Deserialize)]
pub struct GpuQuery {
    api_key: String,
    #[serde(default)]
    max_price: Option<f64>,
    #[serde(default)]
    gpu_type: Option<String>,
}

async fn gpu_offers(
    axum::extract::Query(params): axum::extract::Query<GpuQuery>,
) -> impl IntoResponse {
    use axum::http::header;

    let client = reqwest::Client::new();

    // Build Vast API query
    let mut query = serde_json::json!({
        "rentable": {"eq": true},
        "rented": {"eq": false},
        "type": "on-demand",
        "order": [["dph_total", "asc"]]
    });

    if let Some(max_price) = params.max_price {
        if max_price < 10.0 {
            query["dph_total"] = serde_json::json!({"lte": max_price});
        }
    }

    if let Some(ref gpu_type) = params.gpu_type {
        if gpu_type != "any" {
            query["gpu_name"] = serde_json::json!({"eq": gpu_type});
        }
    }

    let url = format!(
        "https://console.vast.ai/api/v0/bundles/?q={}",
        urlencoding::encode(&query.to_string())
    );

    log::info!("[GPU] Fetching offers from: {}", url);

    match client
        .get(&url)
        .header("Authorization", format!("Bearer {}", params.api_key))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => {
                    log::info!("[GPU] Got response: {} bytes, status: {}", body.len(), status);
                    (
                        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                        [(header::CONTENT_TYPE, "application/json")],
                        body
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    format!("{{\"error\":\"{}\"}}", e)
                ),
            }
        }
        Err(e) => {
            log::error!("[GPU] Request failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "application/json")],
                format!("{{\"error\":\"{}\"}}", e)
            )
        }
    }
}

async fn gpu_instances(
    axum::extract::Query(params): axum::extract::Query<GpuQuery>,
) -> impl IntoResponse {
    use axum::http::header;
    let client = reqwest::Client::new();

    match client
        .get("https://console.vast.ai/api/v0/instances/")
        .header("Authorization", format!("Bearer {}", params.api_key))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    [(header::CONTENT_TYPE, "application/json")],
                    body
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    format!("{{\"error\":\"{}\"}}", e)
                ),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "application/json")],
            format!("{{\"error\":\"{}\"}}", e)
        ),
    }
}

async fn gpu_user(
    axum::extract::Query(params): axum::extract::Query<GpuQuery>,
) -> impl IntoResponse {
    use axum::http::header;
    let client = reqwest::Client::new();

    match client
        .get("https://console.vast.ai/api/v0/users/current/")
        .header("Authorization", format!("Bearer {}", params.api_key))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    [(header::CONTENT_TYPE, "application/json")],
                    body
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    format!("{{\"error\":\"{}\"}}", e)
                ),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "application/json")],
            format!("{{\"error\":\"{}\"}}", e)
        ),
    }
}

#[derive(Deserialize)]
pub struct GpuRentRequest {
    api_key: String,
    image: Option<String>,
    disk: Option<u32>,
}

async fn gpu_rent(
    Path(offer_id): Path<u64>,
    Json(req): Json<GpuRentRequest>,
) -> impl IntoResponse {
    use axum::http::header;
    let client = reqwest::Client::new();

    let payload = serde_json::json!({
        "client_id": "me",
        "image": req.image.unwrap_or_else(|| "ollama/ollama".to_string()),
        "disk": req.disk.unwrap_or(20),
        "label": "otherthing-workspace",
        "onstart": "#!/bin/bash\nollama serve &\nsleep 5\necho 'Ollama ready on port 11434'",
        "runtype": "ssh_direc ssh_proxy",
        "env": {
            "OLLAMA_HOST": "0.0.0.0"
        }
    });

    let url = format!("https://console.vast.ai/api/v0/asks/{}/", offer_id);
    log::info!("[GPU] Renting offer {} with payload: {:?}", offer_id, payload);

    match client
        .put(&url)
        .header("Authorization", format!("Bearer {}", req.api_key))
        .json(&payload)
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => {
                    log::info!("[GPU] Rent response: {} - {}", status, body);
                    (
                        StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                        [(header::CONTENT_TYPE, "application/json")],
                        body
                    )
                }
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    format!("{{\"error\":\"{}\"}}", e)
                ),
            }
        }
        Err(e) => {
            log::error!("[GPU] Rent failed: {}", e);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                [(header::CONTENT_TYPE, "application/json")],
                format!("{{\"error\":\"{}\"}}", e)
            )
        }
    }
}

async fn gpu_destroy(
    Path(instance_id): Path<u64>,
    axum::extract::Query(params): axum::extract::Query<GpuQuery>,
) -> impl IntoResponse {
    use axum::http::header;
    let client = reqwest::Client::new();

    let url = format!("https://console.vast.ai/api/v0/instances/{}/", instance_id);
    log::info!("[GPU] Destroying instance {}", instance_id);

    match client
        .delete(&url)
        .header("Authorization", format!("Bearer {}", params.api_key))
        .send()
        .await
    {
        Ok(resp) => {
            let status = resp.status();
            match resp.text().await {
                Ok(body) => (
                    StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                    [(header::CONTENT_TYPE, "application/json")],
                    body
                ),
                Err(e) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    [(header::CONTENT_TYPE, "application/json")],
                    format!("{{\"error\":\"{}\"}}", e)
                ),
            }
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            [(header::CONTENT_TYPE, "application/json")],
            format!("{{\"error\":\"{}\"}}", e)
        ),
    }
}
