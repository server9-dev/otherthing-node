use crate::models::*;
use crate::services::{
    ContainerManager, ContainerInfo, CreateContainerRequest, RuntimeInfo, ExecResult,
    HardwareDetector, IpfsManager, OllamaManager,
};
use std::sync::Arc;
use tauri::State;
use tokio::sync::RwLock;

#[derive(Clone)]
pub struct AppState {
    pub ollama: Arc<OllamaManager>,
    pub ipfs: Arc<IpfsManager>,
    pub containers: Arc<ContainerManager>,
    pub node_running: Arc<RwLock<bool>>,
    pub node_id: Arc<RwLock<Option<String>>>,
    pub share_key: Arc<RwLock<Option<String>>>,
}

impl AppState {
    pub async fn new() -> Self {
        Self {
            ollama: Arc::new(OllamaManager::new()),
            ipfs: Arc::new(IpfsManager::new()),
            containers: Arc::new(ContainerManager::new().await),
            node_running: Arc::new(RwLock::new(false)),
            node_id: Arc::new(RwLock::new(None)),
            share_key: Arc::new(RwLock::new(None)),
        }
    }
}

// Note: AppState now requires async initialization, so Default uses a sync fallback
impl Default for AppState {
    fn default() -> Self {
        // This is a sync fallback - prefer using AppState::new().await
        Self {
            ollama: Arc::new(OllamaManager::new()),
            ipfs: Arc::new(IpfsManager::new()),
            containers: Arc::new(futures::executor::block_on(ContainerManager::new())),
            node_running: Arc::new(RwLock::new(false)),
            node_id: Arc::new(RwLock::new(None)),
            share_key: Arc::new(RwLock::new(None)),
        }
    }
}

// Hardware commands
#[tauri::command]
pub fn get_hardware() -> Hardware {
    HardwareDetector::detect()
}

#[tauri::command]
pub fn get_drives() -> Vec<StorageInfo> {
    HardwareDetector::get_drives()
}

// Node status commands
#[tauri::command]
pub async fn get_node_status(state: State<'_, AppState>) -> Result<NodeStatus, String> {
    let running = *state.node_running.read().await;
    let node_id = state.node_id.read().await.clone();
    let share_key = state.share_key.read().await.clone();

    Ok(NodeStatus {
        running,
        connected: false, // Network connection status
        node_id,
        share_key,
    })
}

#[tauri::command]
pub async fn start_node(state: State<'_, AppState>) -> Result<CommandResult, String> {
    // Generate node ID if not set
    let mut node_id = state.node_id.write().await;
    if node_id.is_none() {
        *node_id = Some(uuid::Uuid::new_v4().to_string());
    }

    // Generate share key
    let mut share_key = state.share_key.write().await;
    if share_key.is_none() {
        *share_key = Some(generate_share_key());
    }

    *state.node_running.write().await = true;

    Ok(CommandResult::ok())
}

#[tauri::command]
pub async fn stop_node(state: State<'_, AppState>) -> Result<CommandResult, String> {
    *state.node_running.write().await = false;
    Ok(CommandResult::ok())
}

// Ollama commands
#[tauri::command]
pub async fn ollama_status(state: State<'_, AppState>) -> Result<OllamaStatus, String> {
    Ok(state.ollama.get_status().await)
}

#[tauri::command]
pub async fn ollama_start(state: State<'_, AppState>) -> Result<CommandResult, String> {
    state.ollama.start().await.map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub async fn ollama_stop(state: State<'_, AppState>) -> Result<CommandResult, String> {
    state.ollama.stop().await.map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub async fn ollama_models(state: State<'_, AppState>) -> Result<Vec<OllamaModel>, String> {
    state.ollama.list_models().await
}

#[tauri::command]
pub async fn ollama_pull_model(
    state: State<'_, AppState>,
    name: String,
) -> Result<CommandResult, String> {
    state.ollama.pull_model(&name, None).await
        .map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub async fn ollama_delete_model(
    state: State<'_, AppState>,
    name: String,
) -> Result<CommandResult, String> {
    state.ollama.delete_model(&name).await
        .map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub fn ollama_set_path(state: State<'_, AppState>, path: String) -> CommandResult {
    if state.ollama.set_path(std::path::PathBuf::from(&path)) {
        CommandResult::ok()
    } else {
        CommandResult::err("Invalid path - file not found")
    }
}

#[tauri::command]
pub fn ollama_get_path(state: State<'_, AppState>) -> String {
    state.ollama.get_ollama_path().to_string_lossy().to_string()
}

// IPFS commands
#[tauri::command]
pub async fn ipfs_status(state: State<'_, AppState>) -> Result<IpfsStatus, String> {
    Ok(state.ipfs.get_status().await)
}

#[tauri::command]
pub async fn ipfs_start(state: State<'_, AppState>) -> Result<CommandResult, String> {
    state.ipfs.start().await.map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub async fn ipfs_stop(state: State<'_, AppState>) -> Result<CommandResult, String> {
    state.ipfs.stop().await.map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub async fn ipfs_add_content(
    state: State<'_, AppState>,
    content: String,
) -> Result<String, String> {
    state.ipfs.add_content(&content).await
}

#[tauri::command]
pub async fn ipfs_pin(state: State<'_, AppState>, cid: String) -> Result<CommandResult, String> {
    state.ipfs.pin(&cid).await.map(|_| CommandResult::ok())
        .map_err(|e| e)
}

#[tauri::command]
pub async fn ipfs_unpin(state: State<'_, AppState>, cid: String) -> Result<CommandResult, String> {
    state.ipfs.unpin(&cid).await.map(|_| CommandResult::ok())
        .map_err(|e| e)
}

// Window commands
#[tauri::command]
pub fn window_minimize(window: tauri::Window) {
    let _ = window.minimize();
}

#[tauri::command]
pub fn window_maximize(window: tauri::Window) {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
}

#[tauri::command]
pub fn window_close(window: tauri::Window) {
    let _ = window.close();
}

#[tauri::command]
pub fn window_fullscreen(window: tauri::Window) {
    let is_fullscreen = window.is_fullscreen().unwrap_or(false);
    let _ = window.set_fullscreen(!is_fullscreen);
}

#[tauri::command]
pub fn window_is_fullscreen(window: tauri::Window) -> bool {
    window.is_fullscreen().unwrap_or(false)
}

// Container commands
#[tauri::command]
pub async fn container_runtime_info(state: State<'_, AppState>) -> Result<Option<RuntimeInfo>, String> {
    Ok(state.containers.get_runtime_info().await)
}

#[tauri::command]
pub async fn container_detect_runtime(state: State<'_, AppState>) -> Result<RuntimeInfo, String> {
    state.containers.detect_runtime().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_list(state: State<'_, AppState>, all: bool) -> Result<Vec<ContainerInfo>, String> {
    state.containers.list_containers(all).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_list_images(state: State<'_, AppState>) -> Result<Vec<crate::services::container::ImageInfo>, String> {
    state.containers.list_images().await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_pull_image(state: State<'_, AppState>, image: String) -> Result<CommandResult, String> {
    state.containers.pull_image(&image).await
        .map(|_| CommandResult::ok())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_create(state: State<'_, AppState>, request: CreateContainerRequest) -> Result<String, String> {
    state.containers.create_container(request).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_start(state: State<'_, AppState>, container_id: String) -> Result<CommandResult, String> {
    state.containers.start_container(&container_id).await
        .map(|_| CommandResult::ok())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_stop(state: State<'_, AppState>, container_id: String, timeout: Option<i64>) -> Result<CommandResult, String> {
    state.containers.stop_container(&container_id, timeout).await
        .map(|_| CommandResult::ok())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_remove(state: State<'_, AppState>, container_id: String, force: bool) -> Result<CommandResult, String> {
    state.containers.remove_container(&container_id, force).await
        .map(|_| CommandResult::ok())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_logs(state: State<'_, AppState>, container_id: String, tail: Option<usize>) -> Result<String, String> {
    state.containers.get_logs(&container_id, tail).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_exec(state: State<'_, AppState>, container_id: String, cmd: Vec<String>) -> Result<ExecResult, String> {
    state.containers.exec_in_container(&container_id, cmd).await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn container_inspect(state: State<'_, AppState>, container_id: String) -> Result<ContainerInfo, String> {
    state.containers.inspect_container(&container_id).await
        .map_err(|e| e.to_string())
}

// Helper function
fn generate_share_key() -> String {
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

    key
}
