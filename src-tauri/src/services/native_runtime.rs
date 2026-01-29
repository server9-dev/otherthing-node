//! Native Container Runtime Implementation
//!
//! Uses libcontainer (youki) for direct container execution on Linux.
//! No Docker daemon required - communicates directly with the kernel.

#![cfg(all(target_os = "linux", feature = "native-containers"))]

use async_trait::async_trait;
use libcontainer::container::builder::ContainerBuilder;
use libcontainer::container::Container;
use libcontainer::syscall::syscall::SyscallType;
use oci_spec::runtime::{
    LinuxBuilder, LinuxNamespaceBuilder, LinuxNamespaceType, LinuxResourcesBuilder,
    MountBuilder, ProcessBuilder, RootBuilder, Spec, SpecBuilder, UserBuilder,
};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::sync::RwLock;

use super::container_runtime::{
    ContainerInfo, ContainerRuntime, ContainerSpec, ContainerState, ExecOutput, ImageInfo, Mount,
    MountType, PortMapping, Result, RuntimeError, RuntimeInfo, RuntimeType,
};

/// Root directory for container state
const DEFAULT_ROOT_DIR: &str = "/var/lib/otherthing-node/containers";

/// Native container runtime using libcontainer
pub struct NativeRuntime {
    root_dir: PathBuf,
    containers: Arc<RwLock<HashMap<String, ContainerState>>>,
}

impl NativeRuntime {
    /// Create a new native runtime
    pub async fn new() -> Option<Self> {
        let root_dir = PathBuf::from(DEFAULT_ROOT_DIR);

        // Check if we have permissions (need root or user namespaces)
        if !Self::check_permissions() {
            log::warn!("Native runtime: insufficient permissions");
            return None;
        }

        // Create root directory
        if let Err(e) = std::fs::create_dir_all(&root_dir) {
            log::warn!("Native runtime: failed to create root dir: {}", e);
            return None;
        }

        Some(Self {
            root_dir,
            containers: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    fn check_permissions() -> bool {
        // Check if running as root or if user namespaces are available
        if nix::unistd::geteuid().is_root() {
            return true;
        }

        // Check for unprivileged user namespaces
        if let Ok(content) = std::fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone") {
            if content.trim() == "1" {
                return true;
            }
        }

        false
    }

    fn container_dir(&self, id: &str) -> PathBuf {
        self.root_dir.join(id)
    }

    fn build_oci_spec(&self, spec: &ContainerSpec) -> Result<Spec> {
        // Build process
        let mut process_builder = ProcessBuilder::default()
            .terminal(false)
            .user(UserBuilder::default().uid(0u32).gid(0u32).build().unwrap());

        if let Some(cmd) = &spec.command {
            process_builder = process_builder.args(cmd.clone());
        }

        if let Some(workdir) = &spec.workdir {
            process_builder = process_builder.cwd(PathBuf::from(workdir));
        }

        if let Some(env) = &spec.env {
            let env_vec: Vec<String> = env.iter().map(|(k, v)| format!("{}={}", k, v)).collect();
            process_builder = process_builder.env(env_vec);
        }

        let process = process_builder.build()
            .map_err(|e| RuntimeError::Config(e.to_string()))?;

        // Build root
        let rootfs_path = self.container_dir(&spec.name).join("rootfs");
        let root = RootBuilder::default()
            .path(rootfs_path)
            .readonly(spec.readonly_rootfs.unwrap_or(false))
            .build()
            .map_err(|e| RuntimeError::Config(e.to_string()))?;

        // Build mounts
        let mut mounts = vec![
            // Standard mounts
            MountBuilder::default()
                .destination(PathBuf::from("/proc"))
                .typ("proc")
                .source(PathBuf::from("proc"))
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination(PathBuf::from("/dev"))
                .typ("tmpfs")
                .source(PathBuf::from("tmpfs"))
                .options(vec!["nosuid".to_string(), "strictatime".to_string(), "mode=755".to_string(), "size=65536k".to_string()])
                .build()
                .unwrap(),
            MountBuilder::default()
                .destination(PathBuf::from("/sys"))
                .typ("sysfs")
                .source(PathBuf::from("sysfs"))
                .options(vec!["nosuid".to_string(), "noexec".to_string(), "nodev".to_string(), "ro".to_string()])
                .build()
                .unwrap(),
        ];

        // Add user mounts
        if let Some(user_mounts) = &spec.mounts {
            for m in user_mounts {
                let mut mount_builder = MountBuilder::default()
                    .destination(PathBuf::from(&m.target))
                    .source(PathBuf::from(&m.source));

                match m.mount_type {
                    MountType::Bind => {
                        mount_builder = mount_builder.typ("bind");
                        let mut opts = vec!["rbind".to_string()];
                        if m.readonly {
                            opts.push("ro".to_string());
                        }
                        mount_builder = mount_builder.options(opts);
                    }
                    MountType::Tmpfs => {
                        mount_builder = mount_builder.typ("tmpfs");
                    }
                    MountType::Volume => {
                        mount_builder = mount_builder.typ("bind");
                    }
                }

                if let Ok(mount) = mount_builder.build() {
                    mounts.push(mount);
                }
            }
        }

        // Build Linux config with namespaces
        let namespaces = vec![
            LinuxNamespaceBuilder::default()
                .typ(LinuxNamespaceType::Pid)
                .build()
                .unwrap(),
            LinuxNamespaceBuilder::default()
                .typ(LinuxNamespaceType::Network)
                .build()
                .unwrap(),
            LinuxNamespaceBuilder::default()
                .typ(LinuxNamespaceType::Ipc)
                .build()
                .unwrap(),
            LinuxNamespaceBuilder::default()
                .typ(LinuxNamespaceType::Uts)
                .build()
                .unwrap(),
            LinuxNamespaceBuilder::default()
                .typ(LinuxNamespaceType::Mount)
                .build()
                .unwrap(),
        ];

        let mut linux_builder = LinuxBuilder::default()
            .namespaces(namespaces);

        // Resource limits
        if let Some(resources) = &spec.resources {
            let mut resources_builder = LinuxResourcesBuilder::default();

            // Memory limits
            if resources.memory.is_some() || resources.memory_swap.is_some() {
                use oci_spec::runtime::LinuxMemoryBuilder;
                let mut memory_builder = LinuxMemoryBuilder::default();
                if let Some(mem) = resources.memory {
                    memory_builder = memory_builder.limit(mem);
                }
                if let Some(swap) = resources.memory_swap {
                    memory_builder = memory_builder.swap(swap);
                }
                if let Ok(memory) = memory_builder.build() {
                    resources_builder = resources_builder.memory(memory);
                }
            }

            // CPU limits
            if resources.cpu_shares.is_some() || resources.cpu_quota.is_some() || resources.cpu_period.is_some() {
                use oci_spec::runtime::LinuxCpuBuilder;
                let mut cpu_builder = LinuxCpuBuilder::default();
                if let Some(shares) = resources.cpu_shares {
                    cpu_builder = cpu_builder.shares(shares as u64);
                }
                if let Some(quota) = resources.cpu_quota {
                    cpu_builder = cpu_builder.quota(quota);
                }
                if let Some(period) = resources.cpu_period {
                    cpu_builder = cpu_builder.period(period as u64);
                }
                if let Ok(cpu) = cpu_builder.build() {
                    resources_builder = resources_builder.cpu(cpu);
                }
            }

            // PIDs limit
            if let Some(pids) = resources.pids_limit {
                use oci_spec::runtime::LinuxPidsBuilder;
                if let Ok(pids_config) = LinuxPidsBuilder::default().limit(pids).build() {
                    resources_builder = resources_builder.pids(pids_config);
                }
            }

            if let Ok(linux_resources) = resources_builder.build() {
                linux_builder = linux_builder.resources(linux_resources);
            }
        }

        let linux = linux_builder.build()
            .map_err(|e| RuntimeError::Config(e.to_string()))?;

        // Build final spec
        let oci_spec = SpecBuilder::default()
            .version("1.0.2")
            .root(root)
            .process(process)
            .mounts(mounts)
            .linux(linux)
            .hostname(spec.hostname.clone().unwrap_or_else(|| spec.name.clone()))
            .build()
            .map_err(|e| RuntimeError::Config(e.to_string()))?;

        Ok(oci_spec)
    }

    async fn get_container(&self, id: &str) -> Result<Container> {
        let container_dir = self.container_dir(id);
        if !container_dir.exists() {
            return Err(RuntimeError::ContainerNotFound(id.to_string()));
        }

        Container::load(container_dir)
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))
    }
}

#[async_trait]
impl ContainerRuntime for NativeRuntime {
    async fn info(&self) -> Result<RuntimeInfo> {
        let uname = nix::sys::utsname::uname()
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(RuntimeInfo {
            runtime_type: RuntimeType::Native,
            version: env!("CARGO_PKG_VERSION").to_string(),
            api_version: Some("1.0.2".to_string()), // OCI spec version
            os: uname.sysname().to_string_lossy().to_string(),
            arch: uname.machine().to_string_lossy().to_string(),
            root_dir: Some(self.root_dir.clone()),
            cgroup_driver: Some("systemd".to_string()),
        })
    }

    async fn is_available(&self) -> bool {
        Self::check_permissions() && self.root_dir.exists()
    }

    async fn create_container(&self, spec: &ContainerSpec) -> Result<String> {
        let container_id = uuid::Uuid::new_v4().to_string();
        let container_dir = self.container_dir(&container_id);

        // Create container directory
        std::fs::create_dir_all(&container_dir)
            .map_err(|e| RuntimeError::Io(e))?;

        // Create rootfs directory (would normally extract from image)
        let rootfs_dir = container_dir.join("rootfs");
        std::fs::create_dir_all(&rootfs_dir)
            .map_err(|e| RuntimeError::Io(e))?;

        // Build OCI spec
        let oci_spec = self.build_oci_spec(spec)?;

        // Write config.json
        let config_path = container_dir.join("config.json");
        let config_json = serde_json::to_string_pretty(&oci_spec)
            .map_err(|e| RuntimeError::Config(e.to_string()))?;
        std::fs::write(&config_path, config_json)
            .map_err(|e| RuntimeError::Io(e))?;

        // Track container
        {
            let mut containers = self.containers.write().await;
            containers.insert(container_id.clone(), ContainerState::Created);
        }

        log::info!("Native runtime: created container {}", container_id);
        Ok(container_id)
    }

    async fn start_container(&self, id: &str) -> Result<()> {
        let container_dir = self.container_dir(id);

        // Use ContainerBuilder to create and start
        let syscall = SyscallType::default();
        let mut container = ContainerBuilder::new(id.to_string(), syscall)
            .with_root_path(container_dir.clone())
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?
            .as_init(&container_dir)
            .with_systemd(false)
            .build()
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        container.start()
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        // Update state
        {
            let mut containers = self.containers.write().await;
            containers.insert(id.to_string(), ContainerState::Running);
        }

        log::info!("Native runtime: started container {}", id);
        Ok(())
    }

    async fn stop_container(&self, id: &str, timeout: Option<u32>) -> Result<()> {
        let mut container = self.get_container(id).await?;

        // Send SIGTERM first
        container.kill(nix::sys::signal::Signal::SIGTERM, true)
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        // Wait for timeout then SIGKILL if needed
        let timeout_secs = timeout.unwrap_or(10);
        tokio::time::sleep(std::time::Duration::from_secs(timeout_secs as u64)).await;

        // Force kill if still running
        if let Ok(state) = container.state() {
            if state.status == libcontainer::container::ContainerStatus::Running {
                container.kill(nix::sys::signal::Signal::SIGKILL, true)
                    .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;
            }
        }

        // Update state
        {
            let mut containers = self.containers.write().await;
            containers.insert(id.to_string(), ContainerState::Stopped);
        }

        log::info!("Native runtime: stopped container {}", id);
        Ok(())
    }

    async fn kill_container(&self, id: &str, signal: Option<&str>) -> Result<()> {
        let mut container = self.get_container(id).await?;

        let sig = match signal {
            Some("SIGTERM") | Some("15") => nix::sys::signal::Signal::SIGTERM,
            Some("SIGINT") | Some("2") => nix::sys::signal::Signal::SIGINT,
            Some("SIGHUP") | Some("1") => nix::sys::signal::Signal::SIGHUP,
            _ => nix::sys::signal::Signal::SIGKILL,
        };

        container.kill(sig, true)
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        Ok(())
    }

    async fn remove_container(&self, id: &str, force: bool) -> Result<()> {
        let container_dir = self.container_dir(id);

        if force {
            // Try to kill first
            let _ = self.kill_container(id, None).await;
        }

        // Delete container
        if let Ok(mut container) = self.get_container(id).await {
            container.delete(force)
                .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;
        }

        // Remove directory
        if container_dir.exists() {
            std::fs::remove_dir_all(&container_dir)
                .map_err(|e| RuntimeError::Io(e))?;
        }

        // Remove from tracking
        {
            let mut containers = self.containers.write().await;
            containers.remove(id);
        }

        log::info!("Native runtime: removed container {}", id);
        Ok(())
    }

    async fn pause_container(&self, id: &str) -> Result<()> {
        let mut container = self.get_container(id).await?;
        container.pause()
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        {
            let mut containers = self.containers.write().await;
            containers.insert(id.to_string(), ContainerState::Paused);
        }

        Ok(())
    }

    async fn unpause_container(&self, id: &str) -> Result<()> {
        let mut container = self.get_container(id).await?;
        container.resume()
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        {
            let mut containers = self.containers.write().await;
            containers.insert(id.to_string(), ContainerState::Running);
        }

        Ok(())
    }

    async fn inspect_container(&self, id: &str) -> Result<ContainerInfo> {
        let container = self.get_container(id).await?;
        let state = container.state()
            .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

        let container_state = match state.status {
            libcontainer::container::ContainerStatus::Creating => ContainerState::Creating,
            libcontainer::container::ContainerStatus::Created => ContainerState::Created,
            libcontainer::container::ContainerStatus::Running => ContainerState::Running,
            libcontainer::container::ContainerStatus::Stopped => ContainerState::Stopped,
            libcontainer::container::ContainerStatus::Paused => ContainerState::Paused,
        };

        Ok(ContainerInfo {
            id: id.to_string(),
            name: id.to_string(),
            image: "".to_string(), // Native runtime doesn't track image
            state: container_state,
            created: state.created.map(|t| t.timestamp()).unwrap_or(0),
            started: None,
            finished: None,
            exit_code: None,
            pid: state.pid.map(|p| p.as_raw() as u32),
            ports: vec![],
            mounts: vec![],
            labels: HashMap::new(),
        })
    }

    async fn list_containers(&self, all: bool) -> Result<Vec<ContainerInfo>> {
        let mut result = Vec::new();

        // Read container directories
        if let Ok(entries) = std::fs::read_dir(&self.root_dir) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    let id = entry.file_name().to_string_lossy().to_string();
                    if let Ok(info) = self.inspect_container(&id).await {
                        if all || info.state == ContainerState::Running {
                            result.push(info);
                        }
                    }
                }
            }
        }

        Ok(result)
    }

    async fn logs(&self, _id: &str, _tail: Option<usize>, _follow: bool) -> Result<String> {
        // Native runtime would need to implement log collection
        // For now, return empty - logs would be in container's stdout/stderr files
        Ok(String::new())
    }

    async fn exec(&self, id: &str, cmd: &[String], _tty: bool) -> Result<ExecOutput> {
        let container = self.get_container(id).await?;

        // Execute command in container namespace
        // This is a simplified implementation
        let output = std::process::Command::new("nsenter")
            .args([
                "-t", &container.state()
                    .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?
                    .pid
                    .map(|p| p.to_string())
                    .unwrap_or_default(),
                "-m", "-u", "-i", "-n", "-p",
                "--",
            ])
            .args(cmd)
            .output()
            .map_err(|e| RuntimeError::Io(e))?;

        Ok(ExecOutput {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    async fn wait_container(&self, id: &str) -> Result<i32> {
        loop {
            let container = self.get_container(id).await?;
            let state = container.state()
                .map_err(|e| RuntimeError::OperationFailed(e.to_string()))?;

            if state.status == libcontainer::container::ContainerStatus::Stopped {
                return Ok(0); // Would need to track actual exit code
            }

            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        }
    }

    async fn pull_image(&self, _reference: &str) -> Result<()> {
        // Native runtime would need image pulling implementation
        // Could use skopeo or implement OCI registry client
        Err(RuntimeError::OperationFailed(
            "Image pulling not yet implemented for native runtime. Use Docker/Podman to pull images first.".to_string()
        ))
    }

    async fn list_images(&self) -> Result<Vec<ImageInfo>> {
        // Native runtime doesn't manage images directly
        Ok(vec![])
    }

    async fn remove_image(&self, _reference: &str, _force: bool) -> Result<()> {
        Err(RuntimeError::OperationFailed(
            "Image management not implemented for native runtime".to_string()
        ))
    }

    async fn image_exists(&self, _reference: &str) -> Result<bool> {
        // Would need to check extracted rootfs or image store
        Ok(false)
    }
}
