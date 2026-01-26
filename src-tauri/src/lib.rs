mod api;
mod commands;
mod models;
mod services;

use api::ApiServer;
use commands::AppState;
use tauri::Manager;

// Global API server handle
static API_SERVER_RUNNING: std::sync::Mutex<bool> = std::sync::Mutex::new(false);

async fn start_api_server() {
    // Check if already running
    {
        let mut running = API_SERVER_RUNNING.lock().unwrap();
        if *running {
            log::info!("API server already running");
            return;
        }
        *running = true;
    }

    log::info!("Starting Rust API server...");

    let server = ApiServer::new();
    if let Err(e) = server.start(8080).await {
        log::error!("API server error: {}", e);
        *API_SERVER_RUNNING.lock().unwrap() = false;
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(AppState::new())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Start the Rust API server
            tauri::async_runtime::spawn(async {
                start_api_server().await;
            });

            // Auto-start node in local mode
            let state: tauri::State<AppState> = app.state();
            let state_clone = (*state).clone();
            tauri::async_runtime::spawn(async move {
                // Initialize node
                let mut running = state_clone.node_running.write().await;
                *running = true;
                let mut node_id = state_clone.node_id.write().await;
                *node_id = Some(uuid::Uuid::new_v4().to_string());
                log::info!("Node started in local mode");
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Hardware
            commands::get_hardware,
            commands::get_drives,
            // Node
            commands::get_node_status,
            commands::start_node,
            commands::stop_node,
            // Ollama
            commands::ollama_status,
            commands::ollama_start,
            commands::ollama_stop,
            commands::ollama_models,
            commands::ollama_pull_model,
            commands::ollama_delete_model,
            commands::ollama_set_path,
            commands::ollama_get_path,
            // IPFS
            commands::ipfs_status,
            commands::ipfs_start,
            commands::ipfs_stop,
            commands::ipfs_add_content,
            commands::ipfs_pin,
            commands::ipfs_unpin,
            // Window
            commands::window_minimize,
            commands::window_maximize,
            commands::window_close,
            commands::window_fullscreen,
            commands::window_is_fullscreen,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
