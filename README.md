# RhizOS Node Agent

A lightweight agent that shares your compute resources (CPU/GPU) with the RhizOS network.

## Features

- **GPU Detection**: Automatically detects NVIDIA GPUs via `nvidia-smi`
- **Hardware Monitoring**: Reports CPU, RAM, and GPU utilization
- **Job Execution**: Runs containerized workloads via Docker
- **Auto-reconnect**: Maintains connection to orchestrator

## Quick Install

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Huck-dev/rhizos-node/main/install.sh | bash
```

Or manually:

```bash
# Download binary
wget https://github.com/Huck-dev/rhizos-node/releases/latest/download/rhizos-node-linux-amd64
chmod +x rhizos-node-linux-amd64
sudo mv rhizos-node-linux-amd64 /usr/local/bin/rhizos-node

# Run
rhizos-node --orchestrator http://ORCHESTRATOR_IP:8080
```

### Windows

Download from [Releases](https://github.com/Huck-dev/rhizos-node/releases) or use PowerShell:

```powershell
irm https://raw.githubusercontent.com/Huck-dev/rhizos-node/main/install.ps1 | iex
```

### Docker

```bash
docker run -d \
  --gpus all \
  --name rhizos-node \
  -e ORCHESTRATOR_URL=http://ORCHESTRATOR_IP:8080 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  ghcr.io/huck-dev/rhizos-node:latest
```

## Building from Source

Requires Rust 1.75+:

```bash
git clone https://github.com/Huck-dev/rhizos-node.git
cd rhizos-node
cargo build --release
./target/release/rhizos-node --help
```

## Usage

```bash
# Connect to local orchestrator
rhizos-node --orchestrator http://localhost:8080

# Connect to remote orchestrator
rhizos-node --orchestrator http://192.168.1.100:8080

# Custom node name
rhizos-node --orchestrator http://localhost:8080 --name "my-gpu-rig"

# Show hardware info only
rhizos-node info
```

## Configuration

Create `~/.rhizos/config.toml`:

```toml
[node]
name = "my-node"
orchestrator_url = "http://localhost:8080"

[hardware]
max_memory_percent = 80
max_gpu_percent = 90

[docker]
enabled = true
```

## Requirements

- **CPU**: 4+ cores recommended
- **RAM**: 8GB minimum
- **GPU**: Optional - NVIDIA with CUDA 11.8+ for GPU workloads
- **Docker**: Required for running containerized jobs

## License

MIT
