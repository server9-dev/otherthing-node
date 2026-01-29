pub mod agent;
pub mod container;
pub mod container_runtime;
pub mod hardware;
pub mod ipfs;
pub mod ollama;

#[cfg(feature = "container-runtime")]
pub mod docker_runtime;

#[cfg(all(target_os = "linux", feature = "native-containers"))]
pub mod native_runtime;

pub use agent::{AgentManager, AgentExecution, CreateAgentRequest};
pub use container::{ContainerManager, ContainerInfo, ContainerStatus, CreateContainerRequest, RuntimeInfo, ExecResult};
pub use container_runtime::{ContainerRuntime, ContainerSpec, RuntimeSelector, RuntimeType};
pub use hardware::HardwareDetector;
pub use ipfs::IpfsManager;
pub use ollama::OllamaManager;
