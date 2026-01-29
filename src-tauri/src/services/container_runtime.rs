//! Container Runtime Abstraction
//!
//! Provides a unified interface for container operations that can be
//! implemented by different backends:
//! - Docker/Podman via bollard (cross-platform)
//! - Native libcontainer/youki (Linux only, no daemon required)

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Container runtime error
#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("Runtime not available: {0}")]
    NotAvailable(String),

    #[error("Container not found: {0}")]
    ContainerNotFound(String),

    #[error("Image not found: {0}")]
    ImageNotFound(String),

    #[error("Operation failed: {0}")]
    OperationFailed(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Configuration error: {0}")]
    Config(String),
}

pub type Result<T> = std::result::Result<T, RuntimeError>;

/// Runtime type identifier
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeType {
    Docker,
    Podman,
    Native,
    Unknown,
}

impl std::fmt::Display for RuntimeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RuntimeType::Docker => write!(f, "docker"),
            RuntimeType::Podman => write!(f, "podman"),
            RuntimeType::Native => write!(f, "native"),
            RuntimeType::Unknown => write!(f, "unknown"),
        }
    }
}

/// Container state
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ContainerState {
    Creating,
    Created,
    Running,
    Paused,
    Stopped,
    Exited,
    Dead,
    Unknown,
}

/// Container specification for creation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerSpec {
    /// Container name
    pub name: String,
    /// Image reference
    pub image: String,
    /// Command to run
    pub command: Option<Vec<String>>,
    /// Arguments
    pub args: Option<Vec<String>>,
    /// Environment variables
    pub env: Option<HashMap<String, String>>,
    /// Working directory
    pub workdir: Option<String>,
    /// Port mappings (host:container)
    pub ports: Option<Vec<PortMapping>>,
    /// Volume mounts
    pub mounts: Option<Vec<Mount>>,
    /// Resource limits
    pub resources: Option<ResourceLimits>,
    /// Labels
    pub labels: Option<HashMap<String, String>>,
    /// User to run as
    pub user: Option<String>,
    /// Hostname
    pub hostname: Option<String>,
    /// Network mode
    pub network_mode: Option<String>,
    /// Privileged mode
    pub privileged: Option<bool>,
    /// Read-only root filesystem
    pub readonly_rootfs: Option<bool>,
}

/// Port mapping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String, // tcp, udp
    pub host_ip: Option<String>,
}

/// Mount specification
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mount {
    pub source: String,
    pub target: String,
    pub mount_type: MountType,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MountType {
    Bind,
    Volume,
    Tmpfs,
}

/// Resource limits
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// Memory limit in bytes
    pub memory: Option<i64>,
    /// Memory + swap limit in bytes
    pub memory_swap: Option<i64>,
    /// CPU shares (relative weight)
    pub cpu_shares: Option<i64>,
    /// CPU quota in microseconds per period
    pub cpu_quota: Option<i64>,
    /// CPU period in microseconds
    pub cpu_period: Option<i64>,
    /// Number of CPUs
    pub cpus: Option<f64>,
    /// PIDs limit
    pub pids_limit: Option<i64>,
}

/// Container information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: ContainerState,
    pub created: i64,
    pub started: Option<i64>,
    pub finished: Option<i64>,
    pub exit_code: Option<i32>,
    pub pid: Option<u32>,
    pub ports: Vec<PortMapping>,
    pub mounts: Vec<Mount>,
    pub labels: HashMap<String, String>,
}

/// Image information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub repo_digests: Vec<String>,
    pub size: i64,
    pub created: i64,
}

/// Exec result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Runtime information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub runtime_type: RuntimeType,
    pub version: String,
    pub api_version: Option<String>,
    pub os: String,
    pub arch: String,
    pub root_dir: Option<PathBuf>,
    pub cgroup_driver: Option<String>,
}

/// Container runtime trait
///
/// This trait defines the interface that all container runtime backends must implement.
#[async_trait]
pub trait ContainerRuntime: Send + Sync {
    /// Get runtime information
    async fn info(&self) -> Result<RuntimeInfo>;

    /// Check if the runtime is available
    async fn is_available(&self) -> bool;

    // ============ Container Operations ============

    /// Create a container
    async fn create_container(&self, spec: &ContainerSpec) -> Result<String>;

    /// Start a container
    async fn start_container(&self, id: &str) -> Result<()>;

    /// Stop a container
    async fn stop_container(&self, id: &str, timeout: Option<u32>) -> Result<()>;

    /// Kill a container
    async fn kill_container(&self, id: &str, signal: Option<&str>) -> Result<()>;

    /// Remove a container
    async fn remove_container(&self, id: &str, force: bool) -> Result<()>;

    /// Pause a container
    async fn pause_container(&self, id: &str) -> Result<()>;

    /// Unpause a container
    async fn unpause_container(&self, id: &str) -> Result<()>;

    /// Get container information
    async fn inspect_container(&self, id: &str) -> Result<ContainerInfo>;

    /// List containers
    async fn list_containers(&self, all: bool) -> Result<Vec<ContainerInfo>>;

    /// Get container logs
    async fn logs(&self, id: &str, tail: Option<usize>, follow: bool) -> Result<String>;

    /// Execute a command in a container
    async fn exec(&self, id: &str, cmd: &[String], tty: bool) -> Result<ExecOutput>;

    /// Wait for container to exit
    async fn wait_container(&self, id: &str) -> Result<i32>;

    // ============ Image Operations ============

    /// Pull an image
    async fn pull_image(&self, reference: &str) -> Result<()>;

    /// List images
    async fn list_images(&self) -> Result<Vec<ImageInfo>>;

    /// Remove an image
    async fn remove_image(&self, reference: &str, force: bool) -> Result<()>;

    /// Check if image exists
    async fn image_exists(&self, reference: &str) -> Result<bool>;
}

/// Runtime detection and selection
pub struct RuntimeSelector;

impl RuntimeSelector {
    /// Detect available runtimes and return the best one
    pub async fn detect() -> Option<Box<dyn ContainerRuntime>> {
        // Try native runtime first on Linux (if feature enabled)
        #[cfg(all(target_os = "linux", feature = "native-containers"))]
        {
            if let Some(runtime) = super::native_runtime::NativeRuntime::new().await {
                if runtime.is_available().await {
                    log::info!("Using native container runtime (libcontainer)");
                    return Some(Box::new(runtime));
                }
            }
        }

        // Fall back to Docker/Podman
        #[cfg(feature = "container-runtime")]
        {
            if let Some(runtime) = super::docker_runtime::DockerRuntime::new().await {
                if runtime.is_available().await {
                    log::info!("Using Docker/Podman container runtime");
                    return Some(Box::new(runtime));
                }
            }
        }

        log::warn!("No container runtime available");
        None
    }

    /// Get a specific runtime type
    pub async fn get(runtime_type: RuntimeType) -> Option<Box<dyn ContainerRuntime>> {
        match runtime_type {
            #[cfg(all(target_os = "linux", feature = "native-containers"))]
            RuntimeType::Native => {
                super::native_runtime::NativeRuntime::new()
                    .await
                    .map(|r| Box::new(r) as Box<dyn ContainerRuntime>)
            }
            #[cfg(feature = "container-runtime")]
            RuntimeType::Docker | RuntimeType::Podman => {
                super::docker_runtime::DockerRuntime::new()
                    .await
                    .map(|r| Box::new(r) as Box<dyn ContainerRuntime>)
            }
            _ => None,
        }
    }
}
