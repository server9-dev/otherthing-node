use crate::models::{CpuInfo, GpuInfo, Hardware, MemoryInfo, StorageInfo};
use sysinfo::{Disks, System};

pub struct HardwareDetector;

impl HardwareDetector {
    pub fn detect() -> Hardware {
        let mut sys = System::new_all();
        sys.refresh_all();

        let cpu = Self::get_cpu_info(&sys);
        let memory = Self::get_memory_info(&sys);
        let gpu = Self::get_gpu_info();
        let storage = Self::get_storage_info();

        Hardware { cpu, memory, gpu, storage }
    }

    fn get_cpu_info(sys: &System) -> CpuInfo {
        let cpus = sys.cpus();
        let model = cpus.first()
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown".to_string());

        let cores = sys.physical_core_count().unwrap_or(1) as u32;
        let threads = cpus.len() as u32;
        let speed = cpus.first()
            .map(|c| c.frequency() as f64 / 1000.0)
            .unwrap_or(0.0);

        CpuInfo { model, cores, threads, speed }
    }

    fn get_memory_info(sys: &System) -> MemoryInfo {
        MemoryInfo {
            total: sys.total_memory(),
            available: sys.available_memory(),
        }
    }

    fn get_gpu_info() -> Vec<GpuInfo> {
        // GPU detection is platform-specific
        // On Windows, we could use DXGI or WMI
        // For now, return empty - can be enhanced later
        vec![]
    }

    fn get_storage_info() -> Vec<StorageInfo> {
        let disks = Disks::new_with_refreshed_list();

        disks.iter().map(|disk| {
            StorageInfo {
                name: disk.name().to_string_lossy().to_string(),
                mount: disk.mount_point().to_string_lossy().to_string(),
                total: disk.total_space(),
                available: disk.available_space(),
                disk_type: match disk.kind() {
                    sysinfo::DiskKind::SSD => "SSD".to_string(),
                    sysinfo::DiskKind::HDD => "HDD".to_string(),
                    _ => "Unknown".to_string(),
                },
            }
        }).collect()
    }

    pub fn get_drives() -> Vec<StorageInfo> {
        Self::get_storage_info()
    }
}
