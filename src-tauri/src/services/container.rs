//! Container Runtime Service
//!
//! Provides container orchestration capabilities using Docker/Podman.
//! This is the foundation for ZLayer integration - once ZLayer's dependencies
//! align with our stack, we can add native libcontainer support on Linux.

use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[cfg(feature = "container-runtime")]
use bollard::{
    Docker,
    container::{
        Config, CreateContainerOptions, ListContainersOptions,
        LogsOptions, RemoveContainerOptions, StartContainerOptions,
        StopContainerOptions,
    },
    image::{CreateImageOptions, ListImagesOptions},
    exec::{CreateExecOptions, StartExecResults},
};

#[cfg(feature = "container-runtime")]
use futures_util::StreamExt;

#[derive(Error, Debug)]
pub enum ContainerError {
    #[error("Container runtime not available: {0}")]
    RuntimeNotAvailable(String),

    #[error("Container not found: {0}")]
    NotFound(String),

    #[error("Image not found: {0}")]
    ImageNotFound(String),

    #[error("Container operation failed: {0}")]
    OperationFailed(String),

    #[error("Docker API error: {0}")]
    DockerError(String),

    #[error("Feature not enabled")]
    FeatureNotEnabled,
}

#[cfg(feature = "container-runtime")]
impl From<bollard::errors::Error> for ContainerError {
    fn from(err: bollard::errors::Error) -> Self {
        ContainerError::DockerError(err.to_string())
    }
}

/// Container status
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ContainerStatus {
    Created,
    Running,
    Paused,
    Restarting,
    Removing,
    Exited,
    Dead,
    Unknown,
}

impl From<&str> for ContainerStatus {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "created" => ContainerStatus::Created,
            "running" => ContainerStatus::Running,
            "paused" => ContainerStatus::Paused,
            "restarting" => ContainerStatus::Restarting,
            "removing" => ContainerStatus::Removing,
            "exited" => ContainerStatus::Exited,
            "dead" => ContainerStatus::Dead,
            _ => ContainerStatus::Unknown,
        }
    }
}

/// Container information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: ContainerStatus,
    pub created: i64,
    pub ports: Vec<PortMapping>,
    pub labels: HashMap<String, String>,
}

/// Port mapping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortMapping {
    pub container_port: u16,
    pub host_port: Option<u16>,
    pub protocol: String,
}

/// Image information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageInfo {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size: i64,
    pub created: i64,
}

/// Container creation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateContainerRequest {
    pub name: String,
    pub image: String,
    pub cmd: Option<Vec<String>>,
    pub env: Option<Vec<String>>,
    pub ports: Option<Vec<PortMapping>>,
    pub volumes: Option<Vec<String>>,
    pub labels: Option<HashMap<String, String>>,
    pub memory_limit: Option<i64>,
    pub cpu_shares: Option<i64>,
    pub gpu: Option<bool>,
}

/// Container execution result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecResult {
    pub exit_code: i64,
    pub stdout: String,
    pub stderr: String,
}

/// Runtime information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeInfo {
    pub available: bool,
    pub runtime_type: String,
    pub version: String,
    pub api_version: String,
    pub os: String,
    pub arch: String,
}

/// Container runtime manager
pub struct ContainerManager {
    #[cfg(feature = "container-runtime")]
    docker: Option<Docker>,
    runtime_info: Arc<RwLock<Option<RuntimeInfo>>>,
}

impl ContainerManager {
    /// Create a new container manager
    pub async fn new() -> Self {
        let manager = Self {
            #[cfg(feature = "container-runtime")]
            docker: Docker::connect_with_local_defaults().ok(),
            runtime_info: Arc::new(RwLock::new(None)),
        };

        // Initialize runtime info
        let _ = manager.detect_runtime().await;

        manager
    }

    /// Detect available container runtime
    pub async fn detect_runtime(&self) -> Result<RuntimeInfo, ContainerError> {
        #[cfg(feature = "container-runtime")]
        {
            if let Some(ref docker) = self.docker {
                match docker.version().await {
                    Ok(version) => {
                        let info = RuntimeInfo {
                            available: true,
                            runtime_type: "docker".to_string(),
                            version: version.version.unwrap_or_default(),
                            api_version: version.api_version.unwrap_or_default(),
                            os: version.os.unwrap_or_default(),
                            arch: version.arch.unwrap_or_default(),
                        };

                        let mut cached = self.runtime_info.write().await;
                        *cached = Some(info.clone());

                        return Ok(info);
                    }
                    Err(e) => {
                        return Err(ContainerError::RuntimeNotAvailable(e.to_string()));
                    }
                }
            }

            Err(ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))
        }

        #[cfg(not(feature = "container-runtime"))]
        {
            Err(ContainerError::FeatureNotEnabled)
        }
    }

    /// Check if runtime is available
    pub async fn is_available(&self) -> bool {
        let cached = self.runtime_info.read().await;
        cached.as_ref().map(|r| r.available).unwrap_or(false)
    }

    /// Get runtime info
    pub async fn get_runtime_info(&self) -> Option<RuntimeInfo> {
        let cached = self.runtime_info.read().await;
        cached.clone()
    }

    /// List all containers
    #[cfg(feature = "container-runtime")]
    pub async fn list_containers(&self, all: bool) -> Result<Vec<ContainerInfo>, ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let options = ListContainersOptions::<String> {
            all,
            ..Default::default()
        };

        let containers = docker.list_containers(Some(options)).await?;

        Ok(containers.into_iter().map(|c| {
            let ports = c.ports.unwrap_or_default().into_iter().map(|p| {
                PortMapping {
                    container_port: p.private_port as u16,
                    host_port: p.public_port.map(|hp| hp as u16),
                    protocol: p.typ.map(|t| format!("{:?}", t).to_lowercase()).unwrap_or_else(|| "tcp".to_string()),
                }
            }).collect();

            ContainerInfo {
                id: c.id.unwrap_or_default(),
                name: c.names.and_then(|n| n.first().cloned()).unwrap_or_default()
                    .trim_start_matches('/').to_string(),
                image: c.image.unwrap_or_default(),
                status: c.state.as_deref().map(ContainerStatus::from).unwrap_or(ContainerStatus::Unknown),
                created: c.created.unwrap_or(0),
                ports,
                labels: c.labels.unwrap_or_default(),
            }
        }).collect())
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn list_containers(&self, _all: bool) -> Result<Vec<ContainerInfo>, ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// List images
    #[cfg(feature = "container-runtime")]
    pub async fn list_images(&self) -> Result<Vec<ImageInfo>, ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let images = docker.list_images(Some(ListImagesOptions::<String> {
            all: false,
            ..Default::default()
        })).await?;

        Ok(images.into_iter().map(|i| {
            ImageInfo {
                id: i.id,
                repo_tags: i.repo_tags,
                size: i.size,
                created: i.created,
            }
        }).collect())
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn list_images(&self) -> Result<Vec<ImageInfo>, ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Pull an image
    #[cfg(feature = "container-runtime")]
    pub async fn pull_image(&self, image: &str) -> Result<(), ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let options = CreateImageOptions {
            from_image: image,
            ..Default::default()
        };

        let mut stream = docker.create_image(Some(options), None, None);

        while let Some(result) = stream.next().await {
            match result {
                Ok(_info) => {
                    // Progress update - could emit events here
                }
                Err(e) => {
                    return Err(ContainerError::OperationFailed(format!("Pull failed: {}", e)));
                }
            }
        }

        Ok(())
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn pull_image(&self, _image: &str) -> Result<(), ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Create a container
    #[cfg(feature = "container-runtime")]
    pub async fn create_container(&self, request: CreateContainerRequest) -> Result<String, ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let mut labels = request.labels.unwrap_or_default();
        labels.insert("managed_by".to_string(), "otherthing-node".to_string());

        let config = Config {
            image: Some(request.image.clone()),
            cmd: request.cmd,
            env: request.env,
            labels: Some(labels),
            host_config: Some(bollard::models::HostConfig {
                memory: request.memory_limit,
                cpu_shares: request.cpu_shares,
                binds: request.volumes,
                ..Default::default()
            }),
            ..Default::default()
        };

        let options = CreateContainerOptions {
            name: request.name,
            platform: None,
        };

        let response = docker.create_container(Some(options), config).await?;

        Ok(response.id)
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn create_container(&self, _request: CreateContainerRequest) -> Result<String, ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Start a container
    #[cfg(feature = "container-runtime")]
    pub async fn start_container(&self, container_id: &str) -> Result<(), ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        docker.start_container(container_id, None::<StartContainerOptions<String>>).await?;

        Ok(())
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn start_container(&self, _container_id: &str) -> Result<(), ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Stop a container
    #[cfg(feature = "container-runtime")]
    pub async fn stop_container(&self, container_id: &str, timeout: Option<i64>) -> Result<(), ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let options = StopContainerOptions {
            t: timeout.unwrap_or(10) as i64,
        };

        docker.stop_container(container_id, Some(options)).await?;

        Ok(())
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn stop_container(&self, _container_id: &str, _timeout: Option<i64>) -> Result<(), ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Remove a container
    #[cfg(feature = "container-runtime")]
    pub async fn remove_container(&self, container_id: &str, force: bool) -> Result<(), ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let options = RemoveContainerOptions {
            force,
            ..Default::default()
        };

        docker.remove_container(container_id, Some(options)).await?;

        Ok(())
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn remove_container(&self, _container_id: &str, _force: bool) -> Result<(), ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Get container logs
    #[cfg(feature = "container-runtime")]
    pub async fn get_logs(&self, container_id: &str, tail: Option<usize>) -> Result<String, ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let options = LogsOptions::<String> {
            stdout: true,
            stderr: true,
            tail: tail.map(|t| t.to_string()).unwrap_or_else(|| "100".to_string()),
            ..Default::default()
        };

        let mut stream = docker.logs(container_id, Some(options));
        let mut output = String::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(log) => {
                    output.push_str(&log.to_string());
                }
                Err(e) => {
                    return Err(ContainerError::OperationFailed(format!("Log fetch failed: {}", e)));
                }
            }
        }

        Ok(output)
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn get_logs(&self, _container_id: &str, _tail: Option<usize>) -> Result<String, ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Execute command in container
    #[cfg(feature = "container-runtime")]
    pub async fn exec_in_container(&self, container_id: &str, cmd: Vec<String>) -> Result<ExecResult, ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let exec_options = CreateExecOptions {
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            cmd: Some(cmd),
            ..Default::default()
        };

        let exec = docker.create_exec(container_id, exec_options).await?;

        let mut stdout = String::new();
        let mut stderr = String::new();

        if let StartExecResults::Attached { mut output, .. } = docker.start_exec(&exec.id, None).await? {
            while let Some(result) = output.next().await {
                match result {
                    Ok(log) => {
                        match log {
                            bollard::container::LogOutput::StdOut { message } => {
                                stdout.push_str(&String::from_utf8_lossy(&message));
                            }
                            bollard::container::LogOutput::StdErr { message } => {
                                stderr.push_str(&String::from_utf8_lossy(&message));
                            }
                            _ => {}
                        }
                    }
                    Err(e) => {
                        return Err(ContainerError::OperationFailed(format!("Exec failed: {}", e)));
                    }
                }
            }
        }

        // Get exit code
        let inspect = docker.inspect_exec(&exec.id).await?;
        let exit_code = inspect.exit_code.unwrap_or(-1);

        Ok(ExecResult {
            exit_code,
            stdout,
            stderr,
        })
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn exec_in_container(&self, _container_id: &str, _cmd: Vec<String>) -> Result<ExecResult, ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }

    /// Inspect a container
    #[cfg(feature = "container-runtime")]
    pub async fn inspect_container(&self, container_id: &str) -> Result<ContainerInfo, ContainerError> {
        let docker = self.docker.as_ref()
            .ok_or_else(|| ContainerError::RuntimeNotAvailable("Docker not connected".to_string()))?;

        let inspect = docker.inspect_container(container_id, None).await?;

        let ports = inspect.network_settings
            .and_then(|ns| ns.ports)
            .map(|ports| {
                ports.into_iter()
                    .filter_map(|(port_str, bindings)| {
                        let parts: Vec<&str> = port_str.split('/').collect();
                        let container_port = parts.first()?.parse().ok()?;
                        let protocol = parts.get(1).unwrap_or(&"tcp").to_string();
                        let host_port = bindings
                            .and_then(|b| b.first().cloned())
                            .and_then(|b| b.host_port)
                            .and_then(|p| p.parse().ok());

                        Some(PortMapping {
                            container_port,
                            host_port,
                            protocol,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(ContainerInfo {
            id: inspect.id.unwrap_or_default(),
            name: inspect.name.unwrap_or_default().trim_start_matches('/').to_string(),
            image: inspect.config.and_then(|c| c.image).unwrap_or_default(),
            status: inspect.state
                .and_then(|s| s.status)
                .map(|s| ContainerStatus::from(format!("{:?}", s).to_lowercase().as_str()))
                .unwrap_or(ContainerStatus::Unknown),
            created: 0, // Would need to parse the timestamp
            ports,
            labels: HashMap::new(),
        })
    }

    #[cfg(not(feature = "container-runtime"))]
    pub async fn inspect_container(&self, _container_id: &str) -> Result<ContainerInfo, ContainerError> {
        Err(ContainerError::FeatureNotEnabled)
    }
}
