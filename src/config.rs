//! Node configuration module
//!
//! Handles loading, saving, and validating node configuration.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeConfig {
    /// Node display name (shown to clients)
    pub name: Option<String>,

    /// Wallet address for receiving payments
    pub wallet_address: Option<String>,

    /// Preferred cryptocurrency for payments
    #[serde(default = "default_currency")]
    pub currency: String,

    /// Pricing configuration
    #[serde(default)]
    pub pricing: PricingConfig,

    /// Resource limits
    #[serde(default)]
    pub limits: ResourceLimits,

    /// Network configuration
    #[serde(default)]
    pub network: NetworkConfig,

    /// List of enabled MCP adapters
    #[serde(default)]
    pub mcp_adapters: Vec<String>,

    /// Auth token from registration (if registered)
    pub auth_token: Option<String>,

    /// Registered node ID (if registered)
    pub node_id: Option<String>,
}

fn default_currency() -> String {
    "USDC".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PricingConfig {
    /// Price per GPU-hour in cents
    #[serde(default = "default_gpu_price")]
    pub gpu_hour_cents: u32,

    /// Price per CPU core-hour in cents
    #[serde(default = "default_cpu_price")]
    pub cpu_core_hour_cents: u32,

    /// Price per GB RAM-hour in cents
    #[serde(default = "default_memory_price")]
    pub memory_gb_hour_cents: u32,

    /// Price per GB storage-hour in cents
    #[serde(default = "default_storage_price")]
    pub storage_gb_hour_cents: u32,

    /// Minimum job cost in cents
    #[serde(default = "default_minimum")]
    pub minimum_cents: u32,
}

fn default_gpu_price() -> u32 { 50 }      // $0.50/hr per GPU
fn default_cpu_price() -> u32 { 5 }        // $0.05/hr per core
fn default_memory_price() -> u32 { 1 }     // $0.01/hr per GB
fn default_storage_price() -> u32 { 1 }    // $0.01/hr per GB
fn default_minimum() -> u32 { 10 }         // $0.10 minimum

impl Default for PricingConfig {
    fn default() -> Self {
        Self {
            gpu_hour_cents: default_gpu_price(),
            cpu_core_hour_cents: default_cpu_price(),
            memory_gb_hour_cents: default_memory_price(),
            storage_gb_hour_cents: default_storage_price(),
            minimum_cents: default_minimum(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// Maximum concurrent jobs
    #[serde(default = "default_max_jobs")]
    pub max_concurrent_jobs: u32,

    /// Maximum memory to allocate to jobs (MB)
    /// None = use all available
    pub max_memory_mb: Option<u64>,

    /// GPUs to expose (by index)
    /// None = all GPUs
    pub gpu_indices: Option<Vec<u32>>,

    /// CPU cores to allocate
    /// None = all cores
    pub cpu_cores: Option<u32>,

    /// Storage quota for job data (GB)
    #[serde(default = "default_storage_quota")]
    pub storage_quota_gb: u64,
}

fn default_max_jobs() -> u32 { 4 }
fn default_storage_quota() -> u64 { 100 }

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            max_concurrent_jobs: default_max_jobs(),
            max_memory_mb: None,
            gpu_indices: None,
            cpu_cores: None,
            storage_quota_gb: default_storage_quota(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    /// Port for local API server
    #[serde(default = "default_api_port")]
    pub api_port: u16,

    /// Whether to expose a public API
    #[serde(default)]
    pub public_api: bool,

    /// Allowed job sources (orchestrator URLs)
    /// Empty = accept from any registered orchestrator
    #[serde(default)]
    pub allowed_orchestrators: Vec<String>,
}

fn default_api_port() -> u16 { 9876 }

impl Default for NetworkConfig {
    fn default() -> Self {
        Self {
            api_port: default_api_port(),
            public_api: false,
            allowed_orchestrators: vec![],
        }
    }
}

impl Default for NodeConfig {
    fn default() -> Self {
        Self {
            name: None,
            wallet_address: None,
            currency: default_currency(),
            pricing: PricingConfig::default(),
            limits: ResourceLimits::default(),
            network: NetworkConfig::default(),
            mcp_adapters: vec![
                "docker".to_string(),
                "llm-inference".to_string(),
            ],
            auth_token: None,
            node_id: None,
        }
    }
}

impl NodeConfig {
    /// Load configuration from a TOML file
    pub fn from_file(path: &str) -> Result<Self> {
        let content = std::fs::read_to_string(path)?;
        let config: NodeConfig = toml::from_str(&content)?;
        Ok(config)
    }

    /// Save configuration to a TOML file
    pub fn save_to_file(&self, path: &str) -> Result<()> {
        let content = toml::to_string_pretty(self)?;

        // Add helpful comments
        let commented = format!(
            r#"# RhizOS Node Configuration
# Generated by rhizos-node init

# Node display name (optional, shown to clients)
# name = "My Compute Node"

# Wallet address for receiving payments (REQUIRED for earning)
# wallet_address = "0x..."

{}
"#,
            content
        );

        std::fs::write(path, commented)?;
        Ok(())
    }

    /// Get the default config file path
    pub fn default_path() -> Option<std::path::PathBuf> {
        dirs::config_dir().map(|d| d.join("rhizos").join("config.toml"))
    }

    /// Load from default location, or return default config
    pub fn load_or_default() -> Self {
        Self::default_path()
            .and_then(|p| Self::from_file(p.to_str()?).ok())
            .unwrap_or_default()
    }
}

// Add toml dependency
use toml;
