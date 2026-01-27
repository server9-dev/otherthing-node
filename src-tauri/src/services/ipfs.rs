use crate::models::{IpfsStats, IpfsStatus};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

pub struct IpfsManager {
    process: Mutex<Option<Child>>,
    binary_path: Mutex<Option<PathBuf>>,
    repo_path: Mutex<Option<PathBuf>>,
}

impl IpfsManager {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            binary_path: Mutex::new(None),
            repo_path: Mutex::new(None),
        }
    }

    pub fn get_ipfs_path(&self) -> PathBuf {
        if let Some(path) = self.binary_path.lock().unwrap().as_ref() {
            return path.clone();
        }

        // Check multiple locations
        let config_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("otherthing-node")
            .join("ipfs")
            .join("kubo");

        #[cfg(target_os = "windows")]
        let binary_name = "ipfs.exe";
        #[cfg(not(target_os = "windows"))]
        let binary_name = "ipfs";

        // First check our download location
        let downloaded_path = config_dir.join(binary_name);
        if downloaded_path.exists() {
            return downloaded_path;
        }

        // Check system paths
        #[cfg(target_os = "windows")]
        {
            let app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
            let system_path = PathBuf::from(&app_data).join("Programs/IPFS/ipfs.exe");
            if system_path.exists() {
                return system_path;
            }
        }

        #[cfg(target_os = "macos")]
        {
            let homebrew_path = PathBuf::from("/opt/homebrew/bin/ipfs");
            if homebrew_path.exists() {
                return homebrew_path;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            let usr_local = PathBuf::from("/usr/local/bin/ipfs");
            if usr_local.exists() {
                return usr_local;
            }
        }

        // Return expected path even if doesn't exist yet
        downloaded_path
    }

    pub fn has_binary(&self) -> bool {
        self.get_ipfs_path().exists()
    }

    pub fn is_running(&self) -> bool {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(ref mut child) = *guard {
                match child.try_wait() {
                    Ok(None) => return true,
                    Ok(Some(_)) => {
                        *guard = None;
                    }
                    Err(_) => {}
                }
            }
        }

        // Check API
        Self::check_api_running()
    }

    fn check_api_running() -> bool {
        std::thread::spawn(|| {
            reqwest::blocking::get("http://localhost:5001/api/v0/id").is_ok()
        })
        .join()
        .unwrap_or(false)
    }

    pub async fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        let path = self.get_ipfs_path();
        if !path.exists() {
            return Err("IPFS binary not found. Please download it first.".to_string());
        }

        // Initialize IPFS repo if needed
        let repo_path = self.get_repo_path();
        if !repo_path.join("config").exists() {
            log::info!("Initializing IPFS repo at {:?}", repo_path);
            let status = Command::new(&path)
                .arg("init")
                .env("IPFS_PATH", &repo_path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .map_err(|e| format!("Failed to init IPFS: {}", e))?;

            if !status.success() {
                return Err("IPFS init failed".to_string());
            }

            // Configure gateway to use port 8088 instead of 8080 to avoid conflict
            log::info!("Configuring IPFS gateway port to 8088");
            let _ = Command::new(&path)
                .args(["config", "Addresses.Gateway", "/ip4/127.0.0.1/tcp/8088"])
                .env("IPFS_PATH", &repo_path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();

            // Disable gateway redirect (optional, for security)
            let _ = Command::new(&path)
                .args(["config", "--json", "Gateway.NoFetch", "true"])
                .env("IPFS_PATH", &repo_path)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }

        log::info!("Starting IPFS daemon");
        let child = Command::new(&path)
            .arg("daemon")
            .arg("--enable-gc")
            .env("IPFS_PATH", &repo_path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start IPFS: {}", e))?;

        *self.process.lock().unwrap() = Some(child);

        // Wait for API
        for i in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if Self::check_api_running() {
                log::info!("IPFS daemon started successfully");
                return Ok(());
            }
            if i % 10 == 0 {
                log::info!("Waiting for IPFS API... ({}/30)", i);
            }
        }

        Err("IPFS started but API not responding after 15 seconds".to_string())
    }

    pub async fn stop(&self) -> Result<(), String> {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut child) = guard.take() {
                child.kill().map_err(|e| format!("Failed to stop IPFS: {}", e))?;
            }
        }
        Ok(())
    }

    fn get_repo_path(&self) -> PathBuf {
        if let Some(path) = self.repo_path.lock().unwrap().as_ref() {
            return path.clone();
        }

        #[cfg(target_os = "windows")]
        {
            let app_data = std::env::var("APPDATA").unwrap_or_default();
            PathBuf::from(&app_data).join("otherthing-node/ipfs/repo")
        }

        #[cfg(not(target_os = "windows"))]
        {
            dirs::home_dir()
                .unwrap_or_default()
                .join(".otherthing-node/ipfs/repo")
        }
    }

    pub async fn get_status(&self) -> IpfsStatus {
        let has_binary = self.has_binary();
        let running = self.is_running();
        let peer_id = if running {
            self.get_peer_id().await.ok()
        } else {
            None
        };
        let stats = if running {
            self.get_stats().await.ok()
        } else {
            None
        };

        IpfsStatus { running, has_binary, peer_id, stats }
    }

    pub async fn get_peer_id(&self) -> Result<String, String> {
        let client = reqwest::Client::new();
        let response = client
            .post("http://localhost:5001/api/v0/id")
            .send()
            .await
            .map_err(|e| format!("Failed to get peer ID: {}", e))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        data["ID"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No peer ID in response".to_string())
    }

    pub async fn get_stats(&self) -> Result<IpfsStats, String> {
        let client = reqwest::Client::new();

        // Get repo stats
        let repo_response = client
            .post("http://localhost:5001/api/v0/repo/stat")
            .send()
            .await
            .map_err(|e| format!("Failed to get repo stats: {}", e))?;

        let repo_data: serde_json::Value = repo_response
            .json()
            .await
            .map_err(|e| format!("Failed to parse repo stats: {}", e))?;

        // Get swarm peers
        let peers_response = client
            .post("http://localhost:5001/api/v0/swarm/peers")
            .send()
            .await
            .map_err(|e| format!("Failed to get peers: {}", e))?;

        let peers_data: serde_json::Value = peers_response
            .json()
            .await
            .map_err(|e| format!("Failed to parse peers: {}", e))?;

        Ok(IpfsStats {
            repo_size: repo_data["RepoSize"].as_u64().unwrap_or(0),
            num_objects: repo_data["NumObjects"].as_u64().unwrap_or(0),
            peers: peers_data["Peers"]
                .as_array()
                .map(|p| p.len() as u32)
                .unwrap_or(0),
        })
    }

    pub async fn add_content(&self, content: &str) -> Result<String, String> {
        let client = reqwest::Client::new();

        let form = reqwest::multipart::Form::new()
            .text("file", content.to_string());

        let response = client
            .post("http://localhost:5001/api/v0/add")
            .multipart(form)
            .send()
            .await
            .map_err(|e| format!("Failed to add content: {}", e))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        data["Hash"]
            .as_str()
            .map(|s| s.to_string())
            .ok_or_else(|| "No CID in response".to_string())
    }

    pub async fn pin(&self, cid: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        client
            .post(format!("http://localhost:5001/api/v0/pin/add?arg={}", cid))
            .send()
            .await
            .map_err(|e| format!("Failed to pin: {}", e))?;
        Ok(())
    }

    pub async fn unpin(&self, cid: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        client
            .post(format!("http://localhost:5001/api/v0/pin/rm?arg={}", cid))
            .send()
            .await
            .map_err(|e| format!("Failed to unpin: {}", e))?;
        Ok(())
    }
}

impl Default for IpfsManager {
    fn default() -> Self {
        Self::new()
    }
}
