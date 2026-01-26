use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hardware {
    pub cpu: CpuInfo,
    pub memory: MemoryInfo,
    pub gpu: Vec<GpuInfo>,
    pub storage: Vec<StorageInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuInfo {
    pub model: String,
    pub cores: u32,
    pub threads: u32,
    pub speed: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryInfo {
    pub total: u64,
    pub available: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuInfo {
    pub model: String,
    pub vram: Option<u64>,
    pub vendor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub available: u64,
    #[serde(rename = "type")]
    pub disk_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub running: bool,
    pub connected: bool,
    pub node_id: Option<String>,
    pub share_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaStatus {
    pub installed: bool,
    pub running: bool,
    pub models: Vec<OllamaModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OllamaModel {
    pub name: String,
    pub size: u64,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpfsStatus {
    pub running: bool,
    pub has_binary: bool,
    pub peer_id: Option<String>,
    pub stats: Option<IpfsStats>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpfsStats {
    pub repo_size: u64,
    pub num_objects: u64,
    pub peers: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    pub max_cpu_percent: u32,
    pub max_memory_mb: u64,
    pub max_storage_gb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandResult {
    pub success: bool,
    pub error: Option<String>,
}

impl CommandResult {
    pub fn ok() -> Self {
        Self { success: true, error: None }
    }

    pub fn err(msg: impl Into<String>) -> Self {
        Self { success: false, error: Some(msg.into()) }
    }
}
