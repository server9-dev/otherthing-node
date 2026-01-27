pub mod agent;
pub mod hardware;
pub mod ipfs;
pub mod ollama;

pub use agent::{AgentManager, AgentExecution, CreateAgentRequest};
pub use hardware::HardwareDetector;
pub use ipfs::IpfsManager;
pub use ollama::OllamaManager;
