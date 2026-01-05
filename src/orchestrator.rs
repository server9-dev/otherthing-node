//! Orchestrator connection module
//!
//! Handles communication with the RhizOS orchestrator service.
//! Uses WebSocket for real-time job assignment and status updates.

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn, error, debug};

use crate::config::NodeConfig;
use crate::hardware::NodeCapabilities;
use crate::executor::JobExecutor;

// ============ Protocol Messages ============

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeMessage {
    /// Register this node with capabilities
    Register {
        capabilities: NodeCapabilities,
        auth_token: Option<String>,
    },

    /// Heartbeat to keep connection alive
    Heartbeat {
        available: bool,
        current_jobs: u32,
    },

    /// Job status update
    JobStatus {
        job_id: String,
        status: JobStatusUpdate,
    },

    /// Job result
    JobResult {
        job_id: String,
        result: JobResultData,
    },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum OrchestratorMessage {
    /// Registration accepted
    Registered {
        node_id: String,
    },

    /// New job assignment
    JobAssignment {
        job: JobData,
    },

    /// Job cancellation request
    CancelJob {
        job_id: String,
    },

    /// Configuration update
    ConfigUpdate {
        config: serde_json::Value,
    },

    /// Error from orchestrator
    Error {
        code: String,
        message: String,
    },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JobData {
    pub id: String,
    pub client_id: String,
    pub payload: serde_json::Value,
    pub timeout_seconds: u64,
    pub max_cost_cents: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatusUpdate {
    Accepted,
    Preparing,
    Running,
    Completed,
    Failed { error: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct JobResultData {
    pub success: bool,
    pub outputs: Option<Vec<serde_json::Value>>,
    pub error: Option<String>,
    pub execution_time_ms: u64,
    pub actual_cost_cents: u32,
}

// ============ Registration ============

#[derive(Debug, Serialize, Deserialize)]
pub struct RegistrationResult {
    pub node_id: String,
    pub auth_token: String,
}

pub async fn register_node(
    orchestrator_url: &str,
    wallet_address: &str,
    capabilities: NodeCapabilities,
) -> Result<RegistrationResult> {
    let client = reqwest::Client::new();

    let response = client
        .post(format!("{}/api/v1/nodes/register", orchestrator_url))
        .json(&serde_json::json!({
            "wallet_address": wallet_address,
            "capabilities": capabilities,
        }))
        .send()
        .await?;

    if !response.status().is_success() {
        let error = response.text().await?;
        anyhow::bail!("Registration failed: {}", error);
    }

    let result: RegistrationResult = response.json().await?;
    Ok(result)
}

// ============ Node Connection ============

pub struct NodeConnection {
    orchestrator_url: String,
    capabilities: NodeCapabilities,
    config: NodeConfig,
    executor: JobExecutor,
}

impl NodeConnection {
    pub async fn new(
        orchestrator_url: &str,
        capabilities: NodeCapabilities,
        config: NodeConfig,
    ) -> Result<Self> {
        let executor = JobExecutor::new(&config).await?;

        Ok(Self {
            orchestrator_url: orchestrator_url.to_string(),
            capabilities,
            config,
            executor,
        })
    }

    pub async fn run(&mut self) -> Result<()> {
        loop {
            match self.connect_and_handle().await {
                Ok(()) => {
                    info!("Connection closed gracefully");
                    break;
                }
                Err(e) => {
                    error!("Connection error: {}. Reconnecting in 5 seconds...", e);
                    tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                }
            }
        }

        Ok(())
    }

    async fn connect_and_handle(&mut self) -> Result<()> {
        // Convert HTTP URL to WebSocket URL
        let ws_url = self.orchestrator_url
            .replace("https://", "wss://")
            .replace("http://", "ws://");
        let ws_url = format!("{}/ws/node", ws_url);

        info!("Connecting to {}", ws_url);

        let (ws_stream, _) = connect_async(&ws_url).await?;
        let (mut write, mut read) = ws_stream.split();

        // Send registration message
        let register_msg = NodeMessage::Register {
            capabilities: self.capabilities.clone(),
            auth_token: self.config.auth_token.clone(),
        };
        let msg_json = serde_json::to_string(&register_msg)?;
        write.send(Message::Text(msg_json.into())).await?;

        // Set up heartbeat interval
        let mut heartbeat_interval = tokio::time::interval(tokio::time::Duration::from_secs(30));

        loop {
            tokio::select! {
                // Handle incoming messages
                msg = read.next() => {
                    match msg {
                        Some(Ok(Message::Text(text))) => {
                            self.handle_message(&text, &mut write).await?;
                        }
                        Some(Ok(Message::Ping(data))) => {
                            write.send(Message::Pong(data)).await?;
                        }
                        Some(Ok(Message::Close(_))) => {
                            info!("Received close frame");
                            break;
                        }
                        Some(Err(e)) => {
                            error!("WebSocket error: {}", e);
                            break;
                        }
                        None => {
                            info!("WebSocket stream ended");
                            break;
                        }
                        _ => {}
                    }
                }

                // Send heartbeats
                _ = heartbeat_interval.tick() => {
                    let heartbeat = NodeMessage::Heartbeat {
                        available: self.executor.is_available().await,
                        current_jobs: self.executor.current_job_count().await,
                    };
                    let msg_json = serde_json::to_string(&heartbeat)?;
                    write.send(Message::Text(msg_json.into())).await?;
                    debug!("Sent heartbeat");
                }
            }
        }

        Ok(())
    }

    async fn handle_message(
        &mut self,
        text: &str,
        write: &mut futures_util::stream::SplitSink<
            tokio_tungstenite::WebSocketStream<
                tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>
            >,
            Message
        >,
    ) -> Result<()> {
        let msg: OrchestratorMessage = serde_json::from_str(text)?;

        match msg {
            OrchestratorMessage::Registered { node_id } => {
                info!("Registered with orchestrator as node {}", node_id);
            }

            OrchestratorMessage::JobAssignment { job } => {
                info!("Received job assignment: {}", job.id);

                // Acknowledge receipt
                let status = NodeMessage::JobStatus {
                    job_id: job.id.clone(),
                    status: JobStatusUpdate::Accepted,
                };
                write.send(Message::Text(serde_json::to_string(&status)?.into())).await?;

                // Execute the job
                let job_id = job.id.clone();
                let result = self.executor.execute(job).await;

                // Send result
                let result_msg = NodeMessage::JobResult {
                    job_id,
                    result: match result {
                        Ok(r) => r,
                        Err(e) => JobResultData {
                            success: false,
                            outputs: None,
                            error: Some(e.to_string()),
                            execution_time_ms: 0,
                            actual_cost_cents: 0,
                        },
                    },
                };
                write.send(Message::Text(serde_json::to_string(&result_msg)?.into())).await?;
            }

            OrchestratorMessage::CancelJob { job_id } => {
                info!("Cancelling job: {}", job_id);
                self.executor.cancel(&job_id).await;
            }

            OrchestratorMessage::ConfigUpdate { config } => {
                debug!("Received config update: {:?}", config);
                // TODO: Apply config updates
            }

            OrchestratorMessage::Error { code, message } => {
                warn!("Orchestrator error [{}]: {}", code, message);
            }
        }

        Ok(())
    }
}
