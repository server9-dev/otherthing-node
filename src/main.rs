//! RhizOS Node Agent
//!
//! The installable application that exposes hardware to the RhizOS network.
//! Contributors run this to offer their compute resources and earn crypto.

mod config;
mod hardware;
mod orchestrator;
mod executor;
mod api;

use clap::{Parser, Subcommand};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

#[derive(Parser)]
#[command(name = "rhizos-node")]
#[command(about = "Expose your hardware to the RhizOS network and earn crypto")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Enable verbose logging
    #[arg(short, long, global = true)]
    verbose: bool,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the node agent
    Start {
        /// Path to configuration file
        #[arg(short, long)]
        config: Option<String>,

        /// Orchestrator URL to connect to
        #[arg(short, long, default_value = "https://orchestrator.rhizos.cloud")]
        orchestrator: String,
    },

    /// Show detected hardware capabilities
    Info,

    /// Generate a default configuration file
    Init {
        /// Output path for config file
        #[arg(short, long)]
        output: Option<String>,
    },

    /// Register this node with an orchestrator
    Register {
        /// Orchestrator URL
        #[arg(short, long)]
        orchestrator: String,

        /// Wallet address for receiving payments
        #[arg(short, long)]
        wallet: String,
    },

    /// Run a quick benchmark to measure hardware performance
    Benchmark,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Initialize logging
    let log_level = if cli.verbose { Level::DEBUG } else { Level::INFO };
    let subscriber = FmtSubscriber::builder()
        .with_max_level(log_level)
        .with_target(false)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    match cli.command {
        Commands::Start { config: config_path, orchestrator } => {
            info!("Starting RhizOS Node Agent...");

            // Load configuration
            let config = match config_path {
                Some(path) => config::NodeConfig::from_file(&path)?,
                None => config::NodeConfig::default(),
            };

            // Detect hardware
            info!("Detecting hardware capabilities...");
            let capabilities = hardware::detect_capabilities().await?;
            info!("Found {} GPU(s), {} CPU cores, {} MB RAM",
                capabilities.gpus.len(),
                capabilities.cpu.cores,
                capabilities.memory.total_mb
            );

            // Connect to orchestrator
            info!("Connecting to orchestrator at {}...", orchestrator);
            let mut node = orchestrator::NodeConnection::new(
                &orchestrator,
                capabilities,
                config,
            ).await?;

            // Start the main loop
            node.run().await?;
        }

        Commands::Info => {
            println!("RhizOS Node - Hardware Information\n");
            println!("=====================================\n");

            let caps = hardware::detect_capabilities().await?;

            println!("CPU:");
            println!("  Model: {}", caps.cpu.model);
            println!("  Vendor: {}", caps.cpu.vendor);
            println!("  Cores: {} physical, {} threads", caps.cpu.cores, caps.cpu.threads);
            println!("  Architecture: {:?}", caps.cpu.architecture);
            println!("  Features: {}", caps.cpu.features.join(", "));
            println!();

            println!("Memory:");
            println!("  Total: {} MB ({:.1} GB)", caps.memory.total_mb, caps.memory.total_mb as f64 / 1024.0);
            println!("  Available: {} MB ({:.1} GB)", caps.memory.available_mb, caps.memory.available_mb as f64 / 1024.0);
            println!();

            if caps.gpus.is_empty() {
                println!("GPUs: None detected");
            } else {
                println!("GPUs:");
                for (i, gpu) in caps.gpus.iter().enumerate() {
                    println!("  [{}] {} {}", i, gpu.vendor, gpu.model);
                    println!("      VRAM: {} MB ({:.1} GB)", gpu.vram_mb, gpu.vram_mb as f64 / 1024.0);
                    println!("      Driver: {}", gpu.driver_version);
                    let supports: Vec<&str> = [
                        gpu.supports.cuda.then_some("CUDA"),
                        gpu.supports.rocm.then_some("ROCm"),
                        gpu.supports.vulkan.then_some("Vulkan"),
                        gpu.supports.opencl.then_some("OpenCL"),
                        gpu.supports.metal.then_some("Metal"),
                    ].into_iter().flatten().collect();
                    println!("      Supports: {}", supports.join(", "));
                    if let Some(cc) = &gpu.compute_capability {
                        println!("      Compute Capability: {}", cc);
                    }
                }
            }
            println!();

            println!("Storage:");
            println!("  Total: {} GB", caps.storage.total_gb);
            println!("  Available: {} GB", caps.storage.available_gb);
            println!("  Type: {:?}", caps.storage.storage_type);
            println!();

            println!("Docker: {}", caps.docker_version.as_deref().unwrap_or("Not detected"));
        }

        Commands::Init { output } => {
            let config = config::NodeConfig::default();
            let output_path = output.unwrap_or_else(|| "rhizos-node.toml".to_string());

            config.save_to_file(&output_path)?;
            println!("Configuration file created at: {}", output_path);
            println!("\nEdit this file to customize your node settings, then run:");
            println!("  rhizos-node start --config {}", output_path);
        }

        Commands::Register { orchestrator, wallet } => {
            info!("Registering node with orchestrator...");

            let caps = hardware::detect_capabilities().await?;
            let result = orchestrator::register_node(&orchestrator, &wallet, caps).await?;

            println!("Node registered successfully!");
            println!("Node ID: {}", result.node_id);
            println!("Auth Token: {}", result.auth_token);
            println!("\nSave this information! You'll need the auth token to start your node.");
        }

        Commands::Benchmark => {
            println!("Running hardware benchmarks...\n");
            let results = hardware::run_benchmarks().await?;

            println!("Benchmark Results:");
            println!("  CPU Score: {:.2}", results.cpu_score);
            if let Some(gpu) = results.gpu_score {
                println!("  GPU Score: {:.2}", gpu);
            }
            println!("  Memory Bandwidth: {:.2} GB/s", results.memory_bandwidth_gbps);
            println!("  Storage Speed: {:.2} MB/s", results.storage_speed_mbps);
        }
    }

    Ok(())
}
