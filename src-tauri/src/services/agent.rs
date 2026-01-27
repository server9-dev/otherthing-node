use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;
use chrono::Utc;

use super::OllamaManager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentAction {
    pub thought: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Blocked,
    PullingModel,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecution {
    pub id: String,
    pub workspace_id: String,
    pub goal: String,
    pub agent_type: String,
    pub model: String,
    pub provider: String,
    pub status: AgentStatus,
    pub progress: u8,
    pub progress_message: String,
    pub actions: Vec<AgentAction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_alerts: Option<Vec<String>>,
    pub tokens_used: u32,
    pub iterations: u32,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compute_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_category: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sandbox_cid: Option<String>,
}

impl AgentExecution {
    pub fn new(workspace_id: &str, goal: &str, model: &str) -> Self {
        Self {
            id: Uuid::new_v4().to_string(),
            workspace_id: workspace_id.to_string(),
            goal: goal.to_string(),
            agent_type: "react".to_string(),
            model: model.to_string(),
            provider: "ollama".to_string(),
            status: AgentStatus::Pending,
            progress: 0,
            progress_message: "Initializing...".to_string(),
            actions: Vec::new(),
            result: None,
            error: None,
            security_alerts: None,
            tokens_used: 0,
            iterations: 0,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            compute_source: Some("local".to_string()),
            task_category: None,
            sandbox_cid: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgentRequest {
    pub goal: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
}

pub struct AgentManager {
    executions: Arc<RwLock<HashMap<String, AgentExecution>>>,
    ollama: Arc<OllamaManager>,
}

impl AgentManager {
    pub fn new(ollama: Arc<OllamaManager>) -> Self {
        Self {
            executions: Arc::new(RwLock::new(HashMap::new())),
            ollama,
        }
    }

    pub async fn list_executions(&self, workspace_id: &str) -> Vec<AgentExecution> {
        let executions = self.executions.read().await;
        executions
            .values()
            .filter(|e| e.workspace_id == workspace_id)
            .cloned()
            .collect()
    }

    pub async fn get_execution(&self, execution_id: &str) -> Option<AgentExecution> {
        let executions = self.executions.read().await;
        executions.get(execution_id).cloned()
    }

    pub async fn create_execution(
        &self,
        workspace_id: &str,
        req: CreateAgentRequest,
    ) -> Result<AgentExecution, String> {
        // Determine model to use
        let model = match &req.model {
            Some(m) if !m.is_empty() && m != "auto" => m.clone(),
            _ => {
                // Auto-select: try to find a good model
                let models = self.ollama.list_models().await.map_err(|e| e.to_string())?;
                if models.is_empty() {
                    return Err("No Ollama models available. Please pull a model first.".to_string());
                }
                // Prefer llama3.2, mistral, or first available
                models
                    .iter()
                    .find(|m| m.name.contains("llama3"))
                    .or_else(|| models.iter().find(|m| m.name.contains("mistral")))
                    .or_else(|| models.first())
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| "llama3.2:latest".to_string())
            }
        };

        let execution = AgentExecution::new(workspace_id, &req.goal, &model);
        let execution_id = execution.id.clone();

        // Store execution
        {
            let mut executions = self.executions.write().await;
            executions.insert(execution_id.clone(), execution.clone());
        }

        // Run agent in background
        let executions = Arc::clone(&self.executions);
        let goal = req.goal.clone();

        log::info!("Spawning agent task for execution {} with model {}", execution_id, model);

        tokio::spawn(async move {
            run_agent(executions, execution_id, goal, model).await;
        });

        // Return current state
        let executions = self.executions.read().await;
        Ok(executions.get(&execution.id).cloned().unwrap_or(execution))
    }

    pub async fn cancel_execution(&self, execution_id: &str) -> Result<(), String> {
        let mut executions = self.executions.write().await;
        if let Some(exec) = executions.get_mut(execution_id) {
            if exec.status == AgentStatus::Running || exec.status == AgentStatus::Pending {
                exec.status = AgentStatus::Failed;
                exec.error = Some("Cancelled by user".to_string());
                exec.completed_at = Some(Utc::now().to_rfc3339());
            }
            Ok(())
        } else {
            Err("Execution not found".to_string())
        }
    }
}

async fn run_agent(
    executions: Arc<RwLock<HashMap<String, AgentExecution>>>,
    execution_id: String,
    goal: String,
    model: String,
) {
    log::info!("Starting agent execution {} with model {}", execution_id, model);

    // Update status to running
    {
        let mut execs = executions.write().await;
        if let Some(exec) = execs.get_mut(&execution_id) {
            exec.status = AgentStatus::Running;
            exec.progress = 10;
            exec.progress_message = "Starting agent...".to_string();
        }
    }

    // Simple ReAct-style agent loop
    let system_prompt = r#"You are a helpful AI assistant. Answer the user's question directly and concisely.
If you need to think through the problem, explain your reasoning briefly.
Provide a clear, actionable answer."#;

    let user_prompt = format!("Goal: {}\n\nPlease help me accomplish this goal.", goal);

    // Update progress
    {
        let mut execs = executions.write().await;
        if let Some(exec) = execs.get_mut(&execution_id) {
            exec.progress = 30;
            exec.progress_message = format!("Sending request to {}...", model);
        }
    }

    log::info!("Calling Ollama API for execution {}", execution_id);

    // Call Ollama
    match call_ollama(&model, &system_prompt, &user_prompt).await {
        Ok((response, tokens)) => {
            log::info!("Agent {} completed successfully with {} tokens", execution_id, tokens);
            let mut execs = executions.write().await;
            if let Some(exec) = execs.get_mut(&execution_id) {
                exec.status = AgentStatus::Completed;
                exec.progress = 100;
                exec.progress_message = "Completed".to_string();
                exec.result = Some(response.clone());
                exec.tokens_used = tokens;
                exec.iterations = 1;
                exec.completed_at = Some(Utc::now().to_rfc3339());
                exec.actions.push(AgentAction {
                    thought: "Processing the goal and generating response".to_string(),
                    tool: None,
                    input: None,
                    output: Some(response),
                });
            }
        }
        Err(e) => {
            log::error!("Agent {} failed: {}", execution_id, e);
            let mut execs = executions.write().await;
            if let Some(exec) = execs.get_mut(&execution_id) {
                exec.status = AgentStatus::Failed;
                exec.progress = 100;
                exec.progress_message = "Failed".to_string();
                exec.error = Some(e);
                exec.completed_at = Some(Utc::now().to_rfc3339());
            }
        }
    }
}

async fn call_ollama(
    model: &str,
    system: &str,
    prompt: &str,
) -> Result<(String, u32), String> {
    let client = reqwest::Client::new();

    let ollama_host = std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".to_string());
    let url = format!("{}/api/generate", ollama_host);

    log::info!("Calling Ollama at {} with model {}", url, model);

    let payload = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": false,
    });

    let response = client
        .post(&url)
        .json(&payload)
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| format!("Failed to connect to Ollama: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        return Err(format!("Ollama returned error {}: {}", status, text));
    }

    let data: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Ollama response: {}", e))?;

    let response_text = data["response"]
        .as_str()
        .unwrap_or("No response")
        .to_string();

    let tokens = data["eval_count"].as_u64().unwrap_or(0) as u32
        + data["prompt_eval_count"].as_u64().unwrap_or(0) as u32;

    Ok((response_text, tokens))
}
