import * as si from 'systeminformation';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface HardwareInfo {
  cpu: {
    model: string;
    cores: number;
    threads: number;
    frequency_mhz: number;
  };
  memory: {
    total_mb: number;
    available_mb: number;
  };
  gpus: Array<{
    vendor: string;
    model: string;
    vram_mb: number;
    driver_version: string;
  }>;
  storage: {
    total_gb: number;
    available_gb: number;
  };
  docker_version: string | null;
  node_version: string;
}

export class HardwareDetector {
  static async detect(): Promise<HardwareInfo> {
    const [cpu, mem, graphics, disk, dockerVersion] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.graphics(),
      si.fsSize(),
      this.getDockerVersion(),
    ]);

    // Parse GPUs
    const gpus = graphics.controllers
      .filter((g) => g.vram && g.vram > 0)
      .map((g) => ({
        vendor: this.normalizeVendor(g.vendor),
        model: g.model,
        vram_mb: g.vram || 0,
        driver_version: g.driverVersion || 'unknown',
      }));

    // Calculate total storage
    const totalStorage = disk.reduce((acc, d) => acc + d.size, 0);
    const availableStorage = disk.reduce((acc, d) => acc + d.available, 0);

    return {
      cpu: {
        model: cpu.brand || cpu.manufacturer,
        cores: cpu.physicalCores,
        threads: cpu.cores,
        frequency_mhz: cpu.speed * 1000,
      },
      memory: {
        total_mb: Math.round(mem.total / (1024 * 1024)),
        available_mb: Math.round(mem.available / (1024 * 1024)),
      },
      gpus,
      storage: {
        total_gb: Math.round(totalStorage / (1024 * 1024 * 1024)),
        available_gb: Math.round(availableStorage / (1024 * 1024 * 1024)),
      },
      docker_version: dockerVersion,
      node_version: process.version,
    };
  }

  private static normalizeVendor(vendor: string): string {
    const v = vendor.toLowerCase();
    if (v.includes('nvidia')) return 'nvidia';
    if (v.includes('amd') || v.includes('radeon')) return 'amd';
    if (v.includes('intel')) return 'intel';
    if (v.includes('apple')) return 'apple';
    return vendor;
  }

  private static async getDockerVersion(): Promise<string | null> {
    try {
      const { stdout } = await execAsync('docker --version');
      const match = stdout.match(/Docker version ([^,]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}
