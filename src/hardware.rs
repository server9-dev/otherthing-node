//! Hardware detection module
//!
//! Detects available compute resources: CPUs, GPUs, memory, storage.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use sysinfo::{System, Disks, CpuRefreshKind, RefreshKind};
use tracing::{debug, warn};

// ============ Capability Types ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeCapabilities {
    pub node_id: String,
    pub node_version: String,
    pub gpus: Vec<GpuCapability>,
    pub cpu: CpuCapability,
    pub memory: MemoryCapability,
    pub storage: StorageCapability,
    pub docker_version: Option<String>,
    pub container_runtimes: Vec<String>,
    pub mcp_adapters: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuCapability {
    pub vendor: String,
    pub model: String,
    pub vram_mb: u64,
    pub compute_capability: Option<String>,
    pub driver_version: String,
    pub supports: GpuSupports,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GpuSupports {
    pub cuda: bool,
    pub rocm: bool,
    pub vulkan: bool,
    pub metal: bool,
    pub opencl: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CpuCapability {
    pub vendor: String,
    pub model: String,
    pub cores: u32,
    pub threads: u32,
    pub frequency_mhz: u64,
    pub architecture: CpuArchitecture,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CpuArchitecture {
    X86_64,
    Aarch64,
    Arm,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MemoryCapability {
    pub total_mb: u64,
    pub available_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageCapability {
    pub total_gb: u64,
    pub available_gb: u64,
    pub storage_type: StorageType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum StorageType {
    Ssd,
    Hdd,
    Nvme,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BenchmarkResults {
    pub cpu_score: f64,
    pub gpu_score: Option<f64>,
    pub memory_bandwidth_gbps: f64,
    pub storage_speed_mbps: f64,
}

// ============ Detection Functions ============

pub async fn detect_capabilities() -> Result<NodeCapabilities> {
    let node_id = get_or_create_node_id()?;
    let node_version = env!("CARGO_PKG_VERSION").to_string();

    // Detect all hardware in parallel where possible
    let (cpu, memory, storage) = detect_system_info()?;
    let gpus = detect_gpus().await?;
    let docker_version = detect_docker().await;
    let container_runtimes = detect_container_runtimes().await;

    Ok(NodeCapabilities {
        node_id,
        node_version,
        gpus,
        cpu,
        memory,
        storage,
        docker_version,
        container_runtimes,
        mcp_adapters: vec![], // Will be populated from config
    })
}

fn get_or_create_node_id() -> Result<String> {
    // Try to load existing node ID from config directory
    if let Some(config_dir) = dirs::config_dir() {
        let node_id_path = config_dir.join("rhizos").join("node_id");
        if node_id_path.exists() {
            if let Ok(id) = std::fs::read_to_string(&node_id_path) {
                return Ok(id.trim().to_string());
            }
        }

        // Generate new node ID
        let node_id = uuid::Uuid::new_v4().to_string();
        std::fs::create_dir_all(node_id_path.parent().unwrap())?;
        std::fs::write(&node_id_path, &node_id)?;
        return Ok(node_id);
    }

    // Fallback: generate ephemeral ID
    Ok(uuid::Uuid::new_v4().to_string())
}

fn detect_system_info() -> Result<(CpuCapability, MemoryCapability, StorageCapability)> {
    let mut sys = System::new_all();
    sys.refresh_all();

    // CPU detection
    let cpu_info = sys.cpus().first();
    let cpu = CpuCapability {
        vendor: cpu_info.map(|c| c.vendor_id().to_string()).unwrap_or_else(|| "Unknown".to_string()),
        model: cpu_info.map(|c| c.brand().to_string()).unwrap_or_else(|| "Unknown".to_string()),
        cores: sys.physical_core_count().unwrap_or(1) as u32,
        threads: sys.cpus().len() as u32,
        frequency_mhz: cpu_info.map(|c| c.frequency()).unwrap_or(0),
        architecture: detect_cpu_architecture(),
        features: detect_cpu_features(),
    };

    // Memory detection
    let memory = MemoryCapability {
        total_mb: sys.total_memory() / 1024 / 1024,
        available_mb: sys.available_memory() / 1024 / 1024,
    };

    // Storage detection (use the largest disk)
    let disks = Disks::new_with_refreshed_list();
    let largest_disk = disks.iter().max_by_key(|d| d.total_space());

    let storage = if let Some(disk) = largest_disk {
        StorageCapability {
            total_gb: disk.total_space() / 1024 / 1024 / 1024,
            available_gb: disk.available_space() / 1024 / 1024 / 1024,
            storage_type: detect_storage_type(disk),
        }
    } else {
        StorageCapability {
            total_gb: 0,
            available_gb: 0,
            storage_type: StorageType::Unknown,
        }
    };

    Ok((cpu, memory, storage))
}

fn detect_cpu_architecture() -> CpuArchitecture {
    #[cfg(target_arch = "x86_64")]
    return CpuArchitecture::X86_64;

    #[cfg(target_arch = "aarch64")]
    return CpuArchitecture::Aarch64;

    #[cfg(target_arch = "arm")]
    return CpuArchitecture::Arm;

    #[cfg(not(any(target_arch = "x86_64", target_arch = "aarch64", target_arch = "arm")))]
    return CpuArchitecture::Unknown;
}

fn detect_cpu_features() -> Vec<String> {
    let mut features = Vec::new();

    #[cfg(target_arch = "x86_64")]
    {
        if is_x86_feature_detected!("avx") {
            features.push("avx".to_string());
        }
        if is_x86_feature_detected!("avx2") {
            features.push("avx2".to_string());
        }
        if is_x86_feature_detected!("avx512f") {
            features.push("avx512".to_string());
        }
        if is_x86_feature_detected!("sse4.2") {
            features.push("sse4.2".to_string());
        }
        if is_x86_feature_detected!("fma") {
            features.push("fma".to_string());
        }
    }

    features
}

fn detect_storage_type(disk: &sysinfo::Disk) -> StorageType {
    // Try to determine storage type from disk name/path
    let name = disk.name().to_string_lossy().to_lowercase();

    if name.contains("nvme") {
        StorageType::Nvme
    } else if name.contains("ssd") {
        StorageType::Ssd
    } else {
        // Default assumption for modern systems
        StorageType::Ssd
    }
}

async fn detect_gpus() -> Result<Vec<GpuCapability>> {
    let mut gpus = Vec::new();

    // Try NVIDIA detection first via NVML
    match detect_nvidia_gpus() {
        Ok(nvidia_gpus) if !nvidia_gpus.is_empty() => gpus.extend(nvidia_gpus),
        Ok(_) | Err(_) => {
            // NVML failed or found nothing, try nvidia-smi fallback (works better in WSL)
            debug!("NVML detection failed, trying nvidia-smi fallback");
            match detect_nvidia_gpus_smi().await {
                Ok(nvidia_gpus) => gpus.extend(nvidia_gpus),
                Err(e) => debug!("nvidia-smi fallback failed: {}", e),
            }
        }
    }

    // Try AMD detection
    match detect_amd_gpus().await {
        Ok(amd_gpus) => gpus.extend(amd_gpus),
        Err(e) => debug!("No AMD GPUs detected: {}", e),
    }

    Ok(gpus)
}

fn detect_nvidia_gpus() -> Result<Vec<GpuCapability>> {
    use nvml_wrapper::Nvml;

    let nvml = Nvml::init()?;
    let device_count = nvml.device_count()?;

    let mut gpus = Vec::new();

    for i in 0..device_count {
        if let Ok(device) = nvml.device_by_index(i) {
            let name = device.name().unwrap_or_else(|_| "Unknown NVIDIA GPU".to_string());
            let memory = device.memory_info().map(|m| m.total / 1024 / 1024).unwrap_or(0);
            let driver = nvml.sys_driver_version().unwrap_or_else(|_| "Unknown".to_string());

            let compute_cap = device.cuda_compute_capability()
                .map(|cc| format!("{}.{}", cc.major, cc.minor))
                .ok();

            gpus.push(GpuCapability {
                vendor: "nvidia".to_string(),
                model: name,
                vram_mb: memory,
                compute_capability: compute_cap,
                driver_version: driver,
                supports: GpuSupports {
                    cuda: true,
                    rocm: false,
                    vulkan: true, // Most modern NVIDIA cards support Vulkan
                    metal: false,
                    opencl: true,
                },
            });
        }
    }

    Ok(gpus)
}

async fn detect_nvidia_gpus_smi() -> Result<Vec<GpuCapability>> {
    // Use nvidia-smi as fallback (works better in WSL)
    let output = tokio::process::Command::new("nvidia-smi")
        .args(["--query-gpu=name,memory.total,driver_version,compute_cap", "--format=csv,noheader,nounits"])
        .output()
        .await?;

    if !output.status.success() {
        anyhow::bail!("nvidia-smi failed");
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut gpus = Vec::new();

    for line in stdout.lines() {
        let parts: Vec<&str> = line.split(", ").collect();
        if parts.len() >= 3 {
            let name = parts[0].trim().to_string();
            let vram_mb: u64 = parts[1].trim().parse().unwrap_or(0);
            let driver = parts[2].trim().to_string();
            let compute_cap = parts.get(3).map(|s| s.trim().to_string());

            gpus.push(GpuCapability {
                vendor: "nvidia".to_string(),
                model: name,
                vram_mb,
                compute_capability: compute_cap,
                driver_version: driver,
                supports: GpuSupports {
                    cuda: true,
                    rocm: false,
                    vulkan: true,
                    metal: false,
                    opencl: true,
                },
            });
        }
    }

    Ok(gpus)
}

async fn detect_amd_gpus() -> Result<Vec<GpuCapability>> {
    // AMD detection via rocm-smi or similar
    // This is more complex as there's no equivalent to NVML
    // For now, try to parse rocm-smi output

    let output = tokio::process::Command::new("rocm-smi")
        .arg("--showproductname")
        .arg("--showmeminfo")
        .arg("vram")
        .arg("--json")
        .output()
        .await;

    match output {
        Ok(out) if out.status.success() => {
            // Parse rocm-smi JSON output
            // This is simplified - real implementation would be more robust
            let stdout = String::from_utf8_lossy(&out.stdout);
            debug!("rocm-smi output: {}", stdout);

            // For now, return empty - full AMD parsing is TODO
            warn!("AMD GPU detection is work in progress");
            Ok(vec![])
        }
        _ => {
            // rocm-smi not available
            Ok(vec![])
        }
    }
}

async fn detect_docker() -> Option<String> {
    let output = tokio::process::Command::new("docker")
        .arg("--version")
        .output()
        .await
        .ok()?;

    if output.status.success() {
        let version = String::from_utf8_lossy(&output.stdout);
        // Parse "Docker version 24.0.5, build ced0996"
        version
            .split("version ")
            .nth(1)
            .and_then(|v| v.split(',').next())
            .map(|v| v.trim().to_string())
    } else {
        None
    }
}

async fn detect_container_runtimes() -> Vec<String> {
    let mut runtimes = Vec::new();

    // Check Docker
    if tokio::process::Command::new("docker")
        .arg("info")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        runtimes.push("docker".to_string());

        // Check nvidia-docker
        let nvidia_check = tokio::process::Command::new("docker")
            .args(["info", "--format", "{{.Runtimes}}"])
            .output()
            .await;

        if let Ok(out) = nvidia_check {
            let output = String::from_utf8_lossy(&out.stdout);
            if output.contains("nvidia") {
                runtimes.push("nvidia-docker".to_string());
            }
        }
    }

    // Check Podman
    if tokio::process::Command::new("podman")
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
    {
        runtimes.push("podman".to_string());
    }

    runtimes
}

// ============ Benchmarking ============

pub async fn run_benchmarks() -> Result<BenchmarkResults> {
    // Simple CPU benchmark: calculate prime numbers
    let cpu_score = benchmark_cpu();

    // GPU benchmark if available
    let gpu_score = benchmark_gpu().await;

    // Memory bandwidth test
    let memory_bandwidth_gbps = benchmark_memory();

    // Storage speed test
    let storage_speed_mbps = benchmark_storage().await?;

    Ok(BenchmarkResults {
        cpu_score,
        gpu_score,
        memory_bandwidth_gbps,
        storage_speed_mbps,
    })
}

fn benchmark_cpu() -> f64 {
    use std::time::Instant;

    let start = Instant::now();
    let mut count = 0u64;

    // Count primes up to 100000
    for n in 2..100000 {
        let mut is_prime = true;
        for i in 2..=(n as f64).sqrt() as u64 {
            if n % i == 0 {
                is_prime = false;
                break;
            }
        }
        if is_prime {
            count += 1;
        }
    }

    let elapsed = start.elapsed().as_secs_f64();

    // Score is primes per second, normalized
    (count as f64 / elapsed) / 1000.0
}

async fn benchmark_gpu() -> Option<f64> {
    // GPU benchmarking would require running a CUDA/OpenCL kernel
    // For now, return None - this is TODO
    None
}

fn benchmark_memory() -> f64 {
    use std::time::Instant;

    let size = 100 * 1024 * 1024; // 100 MB
    let mut data: Vec<u8> = vec![0; size];

    let start = Instant::now();

    // Write pass
    for i in 0..size {
        data[i] = (i % 256) as u8;
    }

    // Read pass
    let mut sum: u64 = 0;
    for i in 0..size {
        sum = sum.wrapping_add(data[i] as u64);
    }

    let elapsed = start.elapsed().as_secs_f64();

    // Prevent optimization
    std::hint::black_box(sum);

    // GB/s = (bytes * 2 passes) / (elapsed * 1e9)
    (size as f64 * 2.0) / (elapsed * 1_000_000_000.0)
}

async fn benchmark_storage() -> Result<f64> {
    use std::time::Instant;
    use tokio::io::AsyncWriteExt;

    let temp_path = std::env::temp_dir().join("rhizos_bench_temp");
    let size = 50 * 1024 * 1024; // 50 MB
    let data = vec![0u8; size];

    let start = Instant::now();

    // Write test
    let mut file = tokio::fs::File::create(&temp_path).await?;
    file.write_all(&data).await?;
    file.sync_all().await?;

    let elapsed = start.elapsed().as_secs_f64();

    // Cleanup
    let _ = tokio::fs::remove_file(&temp_path).await;

    // MB/s
    Ok((size as f64 / 1024.0 / 1024.0) / elapsed)
}
