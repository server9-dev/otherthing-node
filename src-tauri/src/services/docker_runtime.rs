//! Docker Runtime Implementation
//!
//! Uses the bollard crate to communicate with Docker/Podman daemon.

#![cfg(feature = "container-runtime")]

use async_trait::async_trait;
use bollard::container::{
    Config, CreateContainerOptions, InspectContainerOptions, KillContainerOptions,
    ListContainersOptions, LogsOptions, RemoveContainerOptions, StartContainerOptions,
    StopContainerOptions, WaitContainerOptions,
};
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::image::{CreateImageOptions, ListImagesOptions, RemoveImageOptions};
use bollard::models::{HostConfig, PortBinding};
use bollard::Docker;
use futures_util::StreamExt;
use std::collections::HashMap;

use super::container_runtime::{
    ContainerInfo, ContainerRuntime, ContainerSpec, ContainerState, ExecOutput, ImageInfo, Mount,
    PortMapping, Result, RuntimeError, RuntimeInfo, RuntimeType,
};

/// Docker/Podman runtime implementation
pub struct DockerRuntime {
    docker: Docker,
    runtime_type: RuntimeType,
}

impl DockerRuntime {
    /// Create a new Docker runtime
    pub async fn new() -> Option<Self> {
        let docker = Docker::connect_with_local_defaults().ok()?;

        // Detect if it's Docker or Podman
        let runtime_type = match docker.version().await {
            Ok(version) => {
                let components = version.components.unwrap_or_default();
                let is_podman = components.iter().any(|c| {
                    c.name.to_lowercase().contains("podman")
                });
                if is_podman {
                    RuntimeType::Podman
                } else {
                    RuntimeType::Docker
                }
            }
            Err(_) => return None,
        };

        Some(Self { docker, runtime_type })
    }

    fn convert_port_bindings(ports: &[PortMapping]) -> HashMap<String, Option<Vec<PortBinding>>> {
        let mut bindings = HashMap::new();
        for port in ports {
            let key = format!("{}/{}", port.container_port, port.protocol);
            let binding = PortBinding {
                host_ip: port.host_ip.clone(),
                host_port: Some(port.host_port.to_string()),
            };
            bindings.insert(key, Some(vec![binding]));
        }
        bindings
    }

    fn convert_mounts(mounts: &[Mount]) -> Vec<String> {
        mounts
            .iter()
            .map(|m| {
                let ro = if m.readonly { ":ro" } else { "" };
                format!("{}:{}{}", m.source, m.target, ro)
            })
            .collect()
    }

    fn convert_env(env: &HashMap<String, String>) -> Vec<String> {
        env.iter().map(|(k, v)| format!("{}={}", k, v)).collect()
    }

    fn parse_state(state: &str) -> ContainerState {
        match state.to_lowercase().as_str() {
            "creating" => ContainerState::Creating,
            "created" => ContainerState::Created,
            "running" => ContainerState::Running,
            "paused" => ContainerState::Paused,
            "restarting" => ContainerState::Running,
            "removing" => ContainerState::Stopped,
            "exited" => ContainerState::Exited,
            "dead" => ContainerState::Dead,
            _ => ContainerState::Unknown,
        }
    }
}

#[async_trait]
impl ContainerRuntime for DockerRuntime {
    async fn info(&self) -> Result<RuntimeInfo> {
        let version = self.docker.version().await
            .map_err(|e| RuntimeError::NotAvailable(e.to_string()))?;

        Ok(RuntimeInfo {
            runtime_type: self.runtime_type,
            version: version.version.unwrap_or_default(),
            api_version: version.api_version,
            os: version.os.unwrap_or_default(),
            arch: version.arch.unwrap_or_default(),
            root_dir: None,
            cgroup_driver: None,
        })
    }

    async fn is_available(&self) -> bool {
        self.docker.ping().await.is_ok()
    }

    async fn create_container(&self, spec: &ContainerSpec) -> Result<String> {
        let mut host_config = HostConfig::default();

        // Port bindings
        if let Some(ports) = &spec.ports {
            host_config.port_bindings = Some(Self::convert_port_bindings(ports));
        }

        // Mounts/Binds
        if let Some(mounts) = &spec.mounts {
            host_config.binds = Some(Self::convert_mounts(mounts));
        }

        // Resource limits
        if let Some(resources) = &spec.resources {
            host_config.memory = resources.memory;
            host_config.memory_swap = resources.memory_swap;
            host_config.cpu_shares = resources.cpu_shares;
            host_config.cpu_quota = resources.cpu_quota;
            host_config.cpu_period = resources.cpu_period;
            host_config.pids_limit = resources.pids_limit;
            if let Some(cpus) = resources.cpus {
                host_config.nano_cpus = Some((cpus * 1_000_000_000.0) as i64);
            }
        }

        // Network mode
        if let Some(network_mode) = &spec.network_mode {
            host_config.network_mode = Some(network_mode.clone());
        }

        // Privileged
        if let Some(privileged) = spec.privileged {
            host_config.privileged = Some(privileged);
        }

        // Read-only
        if let Some(readonly) = spec.readonly_rootfs {
            host_config.readonly_rootfs = Some(readonly);
        }

        // Build command
        let cmd = spec.command.clone().or_else(|| spec.args.clone());

        // Environment
        let env = spec.env.as_ref().map(Self::convert_env);

        // Labels with our managed_by tag
        let mut labels = spec.labels.clone().unwrap_or_default();
        labels.insert("managed_by".to_string(), "otherthing-node".to_string());

        let config = Config {
            image: Some(spec.image.clone()),
            cmd,
            env,
            working_dir: spec.workdir.clone(),
            user: spec.user.clone(),
            hostname: spec.hostname.clone(),
            labels: Some(labels),
            host_config: Some(host_config),
            ..Default::default()
        };

        let options = CreateContainerOptions {
            name: &spec.name,
            platform: None,
        };

        let response = self.docker
            .create_container(Some(options), config)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(response.id)
    }

    async fn start_container(&self, id: &str) -> Result<()> {
        self.docker
            .start_container(id, None::<StartContainerOptions<String>>)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }

    async fn stop_container(&self, id: &str, timeout: Option<u32>) -> Result<()> {
        let options = StopContainerOptions {
            t: timeout.unwrap_or(10) as i64,
        };
        self.docker
            .stop_container(id, Some(options))
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }

    async fn kill_container(&self, id: &str, signal: Option<&str>) -> Result<()> {
        let options = KillContainerOptions {
            signal: signal.unwrap_or("SIGKILL"),
        };
        self.docker
            .kill_container(id, Some(options))
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }

    async fn remove_container(&self, id: &str, force: bool) -> Result<()> {
        let options = RemoveContainerOptions {
            force,
            v: true, // Remove volumes
            ..Default::default()
        };
        self.docker
            .remove_container(id, Some(options))
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }

    async fn pause_container(&self, id: &str) -> Result<()> {
        self.docker
            .pause_container(id)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }

    async fn unpause_container(&self, id: &str) -> Result<()> {
        self.docker
            .unpause_container(id)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }

    async fn inspect_container(&self, id: &str) -> Result<ContainerInfo> {
        let inspect = self.docker
            .inspect_container(id, None::<InspectContainerOptions>)
            .await
            .map_err(|e| RuntimeError::ContainerNotFound(e.to_string()))?;

        let state = inspect.state.as_ref();
        let container_state = state
            .and_then(|s| s.status.as_ref())
            .map(|s| Self::parse_state(&format!("{:?}", s)))
            .unwrap_or(ContainerState::Unknown);

        // Parse ports
        let ports = inspect
            .network_settings
            .as_ref()
            .and_then(|ns| ns.ports.as_ref())
            .map(|ports| {
                ports
                    .iter()
                    .filter_map(|(port_str, bindings)| {
                        let parts: Vec<&str> = port_str.split('/').collect();
                        let container_port = parts.first()?.parse().ok()?;
                        let protocol = parts.get(1).unwrap_or(&"tcp").to_string();
                        let binding = bindings.as_ref()?.first()?;
                        Some(PortMapping {
                            container_port,
                            host_port: binding.host_port.as_ref()?.parse().ok()?,
                            protocol,
                            host_ip: binding.host_ip.clone(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(ContainerInfo {
            id: inspect.id.unwrap_or_default(),
            name: inspect.name.unwrap_or_default().trim_start_matches('/').to_string(),
            image: inspect.config.and_then(|c| c.image).unwrap_or_default(),
            state: container_state,
            created: 0, // Would need to parse timestamp
            started: None,
            finished: None,
            exit_code: state.and_then(|s| s.exit_code).map(|c| c as i32),
            pid: state.and_then(|s| s.pid).map(|p| p as u32),
            ports,
            mounts: vec![],
            labels: HashMap::new(),
        })
    }

    async fn list_containers(&self, all: bool) -> Result<Vec<ContainerInfo>> {
        let options = ListContainersOptions::<String> {
            all,
            ..Default::default()
        };

        let containers = self.docker
            .list_containers(Some(options))
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(containers
            .into_iter()
            .map(|c| {
                let ports = c.ports.unwrap_or_default()
                    .into_iter()
                    .filter_map(|p| {
                        Some(PortMapping {
                            container_port: p.private_port as u16,
                            host_port: p.public_port.map(|hp| hp as u16)?,
                            protocol: p.typ.map(|t| format!("{:?}", t).to_lowercase()).unwrap_or_else(|| "tcp".to_string()),
                            host_ip: p.ip,
                        })
                    })
                    .collect();

                ContainerInfo {
                    id: c.id.unwrap_or_default(),
                    name: c.names.and_then(|n| n.first().cloned())
                        .unwrap_or_default()
                        .trim_start_matches('/')
                        .to_string(),
                    image: c.image.unwrap_or_default(),
                    state: c.state.as_deref()
                        .map(Self::parse_state)
                        .unwrap_or(ContainerState::Unknown),
                    created: c.created.unwrap_or(0),
                    started: None,
                    finished: None,
                    exit_code: None,
                    pid: None,
                    ports,
                    mounts: vec![],
                    labels: c.labels.unwrap_or_default(),
                }
            })
            .collect())
    }

    async fn logs(&self, id: &str, tail: Option<usize>, _follow: bool) -> Result<String> {
        let options = LogsOptions::<String> {
            stdout: true,
            stderr: true,
            tail: tail.map(|t| t.to_string()).unwrap_or_else(|| "100".to_string()),
            ..Default::default()
        };

        let mut stream = self.docker.logs(id, Some(options));
        let mut output = String::new();

        while let Some(result) = stream.next().await {
            match result {
                Ok(log) => output.push_str(&log.to_string()),
                Err(e) => return Err(RuntimeError::OperationFailed(e.to_string())),
            }
        }

        Ok(output)
    }

    async fn exec(&self, id: &str, cmd: &[String], tty: bool) -> Result<ExecOutput> {
        let exec_options = CreateExecOptions {
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            tty: Some(tty),
            cmd: Some(cmd.to_vec()),
            ..Default::default()
        };

        let exec = self.docker
            .create_exec(id, exec_options)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        let mut stdout = String::new();
        let mut stderr = String::new();

        if let StartExecResults::Attached { mut output, .. } = self.docker
            .start_exec(&exec.id, None)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?
        {
            while let Some(result) = output.next().await {
                match result {
                    Ok(log) => match log {
                        bollard::container::LogOutput::StdOut { message } => {
                            stdout.push_str(&String::from_utf8_lossy(&message));
                        }
                        bollard::container::LogOutput::StdErr { message } => {
                            stderr.push_str(&String::from_utf8_lossy(&message));
                        }
                        _ => {}
                    },
                    Err(e) => return Err(RuntimeError::OperationFailed(e.to_string())),
                }
            }
        }

        // Get exit code
        let inspect = self.docker
            .inspect_exec(&exec.id)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(ExecOutput {
            exit_code: inspect.exit_code.unwrap_or(-1) as i32,
            stdout,
            stderr,
        })
    }

    async fn wait_container(&self, id: &str) -> Result<i32> {
        let options = WaitContainerOptions {
            condition: "not-running",
        };

        let mut stream = self.docker.wait_container(id, Some(options));

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => return Ok(response.status_code as i32),
                Err(e) => return Err(RuntimeError::OperationFailed(e.to_string())),
            }
        }

        Err(RuntimeError::OperationFailed("Wait stream ended unexpectedly".to_string()))
    }

    async fn pull_image(&self, reference: &str) -> Result<()> {
        let options = CreateImageOptions {
            from_image: reference,
            ..Default::default()
        };

        let mut stream = self.docker.create_image(Some(options), None, None);

        while let Some(result) = stream.next().await {
            match result {
                Ok(_info) => {
                    // Progress update - could emit events
                }
                Err(e) => return Err(RuntimeError::OperationFailed(e.to_string())),
            }
        }

        Ok(())
    }

    async fn list_images(&self) -> Result<Vec<ImageInfo>> {
        let images = self.docker
            .list_images(Some(ListImagesOptions::<String> {
                all: false,
                ..Default::default()
            }))
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(images
            .into_iter()
            .map(|i| ImageInfo {
                id: i.id,
                repo_tags: i.repo_tags,
                repo_digests: i.repo_digests,
                size: i.size,
                created: i.created,
            })
            .collect())
    }

    async fn remove_image(&self, reference: &str, force: bool) -> Result<()> {
        let options = RemoveImageOptions {
            force,
            ..Default::default()
        };

        self.docker
            .remove_image(reference, Some(options), None)
            .await
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(())
    }

    async fn image_exists(&self, reference: &str) -> Result<bool> {
        match self.docker.inspect_image(reference).await {
            Ok(_) => Ok(true),
            Err(bollard::errors::Error::DockerResponseServerError { status_code: 404, .. }) => Ok(false),
            Err(e) => Err(RuntimeError::OperationFailed(e.to_string())),
        }
    }
}
