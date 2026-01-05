//! Job execution module
//!
//! Handles running containers and MCP adapters for job execution.

use anyhow::Result;
use bollard::Docker;
use bollard::container::{Config, CreateContainerOptions, StartContainerOptions, WaitContainerOptions};
use bollard::image::CreateImageOptions;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing::{info, warn, error, debug};

use crate::config::NodeConfig;
use crate::orchestrator::{JobData, JobResultData};

// ============ Job State ============

#[derive(Debug, Clone)]
struct RunningJob {
    id: String,
    container_id: Option<String>,
    started_at: std::time::Instant,
    cancelled: bool,
}

// ============ Executor ============

pub struct JobExecutor {
    docker: Docker,
    config: NodeConfig,
    running_jobs: Arc<RwLock<HashMap<String, RunningJob>>>,
}

impl JobExecutor {
    pub async fn new(config: &NodeConfig) -> Result<Self> {
        // Connect to Docker
        let docker = Docker::connect_with_local_defaults()?;

        // Verify Docker is working
        let info = docker.info().await?;
        debug!("Connected to Docker: {:?}", info.name);

        Ok(Self {
            docker,
            config: config.clone(),
            running_jobs: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    pub async fn is_available(&self) -> bool {
        // Check if we can accept new jobs
        let jobs = self.running_jobs.read().await;
        jobs.len() < self.config.limits.max_concurrent_jobs as usize
    }

    pub async fn current_job_count(&self) -> u32 {
        let jobs = self.running_jobs.read().await;
        jobs.len() as u32
    }

    pub async fn execute(&mut self, job: JobData) -> Result<JobResultData> {
        let start_time = std::time::Instant::now();

        // Track this job
        {
            let mut jobs = self.running_jobs.write().await;
            jobs.insert(job.id.clone(), RunningJob {
                id: job.id.clone(),
                container_id: None,
                started_at: start_time,
                cancelled: false,
            });
        }

        // Execute based on payload type
        let result = self.execute_payload(&job).await;

        // Remove from tracking
        {
            let mut jobs = self.running_jobs.write().await;
            jobs.remove(&job.id);
        }

        let execution_time_ms = start_time.elapsed().as_millis() as u64;

        match result {
            Ok(outputs) => Ok(JobResultData {
                success: true,
                outputs: Some(outputs),
                error: None,
                execution_time_ms,
                actual_cost_cents: self.calculate_cost(execution_time_ms, &job),
            }),
            Err(e) => Ok(JobResultData {
                success: false,
                outputs: None,
                error: Some(e.to_string()),
                execution_time_ms,
                actual_cost_cents: 0, // No charge on failure
            }),
        }
    }

    async fn execute_payload(&mut self, job: &JobData) -> Result<Vec<serde_json::Value>> {
        // Determine job type from payload
        let job_type = job.payload.get("type")
            .and_then(|t| t.as_str())
            .unwrap_or("docker");

        match job_type {
            "docker" => self.execute_docker_job(job).await,
            "llm-inference" => self.execute_llm_job(job).await,
            "image-gen" => self.execute_image_gen_job(job).await,
            "mcp" => self.execute_mcp_job(job).await,
            _ => anyhow::bail!("Unknown job type: {}", job_type),
        }
    }

    async fn execute_docker_job(&mut self, job: &JobData) -> Result<Vec<serde_json::Value>> {
        let image = job.payload.get("image")
            .and_then(|i| i.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'image' in docker job payload"))?;

        let command = job.payload.get("command")
            .and_then(|c| c.as_array())
            .map(|arr| arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect::<Vec<_>>());

        let env = job.payload.get("env")
            .and_then(|e| e.as_object())
            .map(|obj| obj.iter()
                .filter_map(|(k, v)| v.as_str().map(|s| format!("{}={}", k, s)))
                .collect::<Vec<_>>());

        info!("Pulling image: {}", image);

        // Pull the image
        let mut pull_stream = self.docker.create_image(
            Some(CreateImageOptions {
                from_image: image,
                ..Default::default()
            }),
            None,
            None,
        );

        while let Some(result) = pull_stream.next().await {
            match result {
                Ok(info) => debug!("Pull progress: {:?}", info),
                Err(e) => warn!("Pull warning: {}", e),
            }
        }

        info!("Creating container for job {}", job.id);

        // Create container
        let container_config = Config {
            image: Some(image.to_string()),
            cmd: command,
            env,
            host_config: Some(bollard::service::HostConfig {
                // Resource limits
                memory: self.config.limits.max_memory_mb.map(|m| (m * 1024 * 1024) as i64),
                nano_cpus: self.config.limits.cpu_cores.map(|c| (c as i64) * 1_000_000_000),
                // GPU access only if job requires it and nvidia-docker is available
                // For now, skip GPU requests since we detect no GPUs
                ..Default::default()
            }),
            ..Default::default()
        };

        let container_name = format!("rhizos-{}", job.id);
        let container = self.docker
            .create_container(
                Some(CreateContainerOptions::<String> { name: container_name.clone(), platform: None }),
                container_config,
            )
            .await?;

        let container_id = container.id.clone();

        // Update job tracking with container ID
        {
            let mut jobs = self.running_jobs.write().await;
            if let Some(running_job) = jobs.get_mut(&job.id) {
                running_job.container_id = Some(container_id.clone());
            }
        }

        info!("Starting container {}", container_id);

        // Start container
        self.docker.start_container(&container_id, None::<StartContainerOptions<String>>).await?;

        // Wait for completion (with timeout)
        let timeout = tokio::time::Duration::from_secs(job.timeout_seconds);
        let wait_result = tokio::time::timeout(
            timeout,
            self.wait_for_container(&container_id),
        ).await;

        // Get logs
        let logs = self.get_container_logs(&container_id).await?;

        // Cleanup container
        let _ = self.docker.remove_container(&container_id, None).await;

        match wait_result {
            Ok(Ok(exit_code)) => {
                if exit_code == 0 {
                    Ok(vec![serde_json::json!({
                        "type": "inline",
                        "data": logs,
                        "mime_type": "text/plain"
                    })])
                } else {
                    anyhow::bail!("Container exited with code {}: {}", exit_code, logs)
                }
            }
            Ok(Err(e)) => anyhow::bail!("Container error: {}", e),
            Err(_) => {
                // Timeout - kill container
                let _ = self.docker.kill_container(&container_id, None::<bollard::container::KillContainerOptions<String>>).await;
                let _ = self.docker.remove_container(&container_id, None).await;
                anyhow::bail!("Job timed out after {} seconds", job.timeout_seconds)
            }
        }
    }

    async fn wait_for_container(&self, container_id: &str) -> Result<i64> {
        let mut wait_stream = self.docker.wait_container(
            container_id,
            Some(WaitContainerOptions { condition: "not-running" }),
        );

        if let Some(result) = wait_stream.next().await {
            let response = result?;
            Ok(response.status_code)
        } else {
            anyhow::bail!("Container wait stream ended unexpectedly")
        }
    }

    async fn get_container_logs(&self, container_id: &str) -> Result<String> {
        use bollard::container::LogsOptions;

        let mut logs = String::new();
        let mut log_stream = self.docker.logs(
            container_id,
            Some(LogsOptions::<String> {
                stdout: true,
                stderr: true,
                tail: "1000".to_string(),
                ..Default::default()
            }),
        );

        while let Some(result) = log_stream.next().await {
            match result {
                Ok(output) => {
                    logs.push_str(&output.to_string());
                }
                Err(e) => warn!("Log read error: {}", e),
            }
        }

        Ok(logs)
    }

    async fn execute_llm_job(&mut self, job: &JobData) -> Result<Vec<serde_json::Value>> {
        // LLM inference job - would be handled by MCP adapter
        // For now, stub implementation
        let model = job.payload.get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("unknown");

        let prompt = job.payload.get("prompt")
            .and_then(|p| p.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'prompt' in LLM job payload"))?;

        info!("LLM inference job: model={}, prompt_len={}", model, prompt.len());

        // TODO: Call MCP adapter for LLM inference
        anyhow::bail!("LLM inference not yet implemented - requires MCP adapter")
    }

    async fn execute_image_gen_job(&mut self, job: &JobData) -> Result<Vec<serde_json::Value>> {
        // Image generation job - would be handled by MCP adapter
        let model = job.payload.get("model")
            .and_then(|m| m.as_str())
            .unwrap_or("sdxl");

        info!("Image generation job: model={}", model);

        // TODO: Call MCP adapter for image generation
        anyhow::bail!("Image generation not yet implemented - requires MCP adapter")
    }

    async fn execute_mcp_job(&mut self, job: &JobData) -> Result<Vec<serde_json::Value>> {
        // Generic MCP adapter call
        let adapter = job.payload.get("adapter")
            .and_then(|a| a.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'adapter' in MCP job payload"))?;

        let method = job.payload.get("method")
            .and_then(|m| m.as_str())
            .ok_or_else(|| anyhow::anyhow!("Missing 'method' in MCP job payload"))?;

        info!("MCP job: adapter={}, method={}", adapter, method);

        // TODO: Call appropriate MCP adapter
        anyhow::bail!("MCP adapter '{}' not yet implemented", adapter)
    }

    pub async fn cancel(&self, job_id: &str) {
        let container_id = {
            let mut jobs = self.running_jobs.write().await;
            if let Some(job) = jobs.get_mut(job_id) {
                job.cancelled = true;
                job.container_id.clone()
            } else {
                None
            }
        };

        if let Some(cid) = container_id {
            info!("Killing container {} for cancelled job {}", cid, job_id);
            let _ = self.docker.kill_container(&cid, None::<bollard::container::KillContainerOptions<String>>).await;
        }
    }

    fn calculate_cost(&self, execution_time_ms: u64, _job: &JobData) -> u32 {
        // Simple cost calculation based on time
        // In production, would be based on actual resource usage
        let hours = execution_time_ms as f64 / 1000.0 / 3600.0;

        // Use configured pricing
        let gpu_cost = (hours * self.config.pricing.gpu_hour_cents as f64) as u32;
        let cpu_cost = (hours * self.config.pricing.cpu_core_hour_cents as f64
            * self.config.limits.cpu_cores.unwrap_or(1) as f64) as u32;

        let total = gpu_cost + cpu_cost;

        // Apply minimum
        std::cmp::max(total, self.config.pricing.minimum_cents)
    }
}
