use crate::models::{OllamaModel, OllamaStatus};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tokio::sync::mpsc;

pub struct OllamaManager {
    process: Mutex<Option<Child>>,
    custom_path: Mutex<Option<PathBuf>>,
}

impl OllamaManager {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
            custom_path: Mutex::new(None),
        }
    }

    pub fn get_ollama_path(&self) -> PathBuf {
        if let Some(path) = self.custom_path.lock().unwrap().as_ref() {
            return path.clone();
        }

        // Default paths by platform
        #[cfg(target_os = "windows")]
        {
            // Check common Windows locations
            let local_app_data = std::env::var("LOCALAPPDATA").unwrap_or_default();
            let paths = vec![
                PathBuf::from(&local_app_data).join("Programs/Ollama/ollama.exe"),
                PathBuf::from("C:/Program Files/Ollama/ollama.exe"),
                PathBuf::from("ollama.exe"), // In PATH
            ];

            for path in paths {
                if path.exists() {
                    return path;
                }
            }
            PathBuf::from("ollama")
        }

        #[cfg(target_os = "macos")]
        {
            PathBuf::from("/usr/local/bin/ollama")
        }

        #[cfg(target_os = "linux")]
        {
            PathBuf::from("/usr/bin/ollama")
        }
    }

    pub fn set_path(&self, path: PathBuf) -> bool {
        if path.exists() {
            *self.custom_path.lock().unwrap() = Some(path);
            true
        } else {
            false
        }
    }

    pub fn is_installed(&self) -> bool {
        let path = self.get_ollama_path();
        if path.exists() {
            return true;
        }

        // Try running ollama to see if it's in PATH
        Command::new("ollama")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
    }

    pub fn is_running(&self) -> bool {
        // Check if our managed process is running
        if let Ok(mut guard) = self.process.lock() {
            if let Some(ref mut child) = *guard {
                match child.try_wait() {
                    Ok(None) => return true, // Still running
                    Ok(Some(_)) => {
                        *guard = None; // Process exited
                    }
                    Err(_) => {}
                }
            }
        }

        // Also check if ollama is running via API
        Self::check_api_running()
    }

    fn check_api_running() -> bool {
        // Sync check for ollama API
        std::thread::spawn(|| {
            reqwest::blocking::get("http://localhost:11434/api/tags").is_ok()
        })
        .join()
        .unwrap_or(false)
    }

    pub async fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }

        let path = self.get_ollama_path();

        let child = Command::new(&path)
            .arg("serve")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start Ollama: {}", e))?;

        *self.process.lock().unwrap() = Some(child);

        // Wait for API to be ready
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            if Self::check_api_running() {
                return Ok(());
            }
        }

        Err("Ollama started but API not responding".to_string())
    }

    pub async fn stop(&self) -> Result<(), String> {
        if let Ok(mut guard) = self.process.lock() {
            if let Some(mut child) = guard.take() {
                child.kill().map_err(|e| format!("Failed to stop Ollama: {}", e))?;
            }
        }
        Ok(())
    }

    pub async fn get_status(&self) -> OllamaStatus {
        let installed = self.is_installed();
        let running = self.is_running();
        let models = if running {
            self.list_models().await.unwrap_or_default()
        } else {
            vec![]
        };

        OllamaStatus { installed, running, models }
    }

    pub async fn list_models(&self) -> Result<Vec<OllamaModel>, String> {
        let client = reqwest::Client::new();
        let response = client
            .get("http://localhost:11434/api/tags")
            .send()
            .await
            .map_err(|e| format!("Failed to list models: {}", e))?;

        let data: serde_json::Value = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        let models = data["models"]
            .as_array()
            .unwrap_or(&vec![])
            .iter()
            .filter_map(|m| {
                Some(OllamaModel {
                    name: m["name"].as_str()?.to_string(),
                    size: m["size"].as_u64().unwrap_or(0),
                    modified_at: m["modified_at"].as_str().unwrap_or("").to_string(),
                })
            })
            .collect();

        Ok(models)
    }

    pub async fn pull_model(
        &self,
        name: &str,
        progress_tx: Option<mpsc::Sender<(String, Option<f64>)>>,
    ) -> Result<(), String> {
        let client = reqwest::Client::new();
        let response = client
            .post("http://localhost:11434/api/pull")
            .json(&serde_json::json!({ "name": name, "stream": true }))
            .send()
            .await
            .map_err(|e| format!("Failed to pull model: {}", e))?;

        let mut stream = response.bytes_stream();
        use futures_util::StreamExt;

        while let Some(chunk) = stream.next().await {
            if let Ok(bytes) = chunk {
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    for line in text.lines() {
                        if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                            let status = json["status"].as_str().unwrap_or("").to_string();
                            let percent = json["completed"]
                                .as_f64()
                                .and_then(|c| json["total"].as_f64().map(|t| c / t * 100.0));

                            if let Some(ref tx) = progress_tx {
                                let _ = tx.send((status, percent)).await;
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    pub async fn delete_model(&self, name: &str) -> Result<(), String> {
        let client = reqwest::Client::new();
        client
            .delete("http://localhost:11434/api/delete")
            .json(&serde_json::json!({ "name": name }))
            .send()
            .await
            .map_err(|e| format!("Failed to delete model: {}", e))?;

        Ok(())
    }
}

impl Default for OllamaManager {
    fn default() -> Self {
        Self::new()
    }
}
