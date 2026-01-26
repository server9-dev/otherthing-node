mod commands;
mod models;
mod services;

use commands::AppState;
use tauri::Manager;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

// Global sidecar process handle
static SIDECAR_PROCESS: Mutex<Option<Child>> = Mutex::new(None);

fn start_sidecar(resource_dir: Option<std::path::PathBuf>) {
    log::info!("Starting Node.js sidecar...");

    // In dev mode, run from source; in production, run bundled sidecar
    let result = if cfg!(debug_assertions) {
        // Dev mode: run with node/npx from the project directory
        #[cfg(target_os = "windows")]
        let cmd = Command::new("cmd")
            .args(["/c", "node", "dist/sidecar.js"])
            .current_dir(std::env::current_dir().unwrap().parent().unwrap_or(&std::env::current_dir().unwrap()))
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn();

        #[cfg(not(target_os = "windows"))]
        let cmd = Command::new("node")
            .arg("dist/sidecar.js")
            .current_dir(std::env::current_dir().unwrap().parent().unwrap_or(&std::env::current_dir().unwrap()))
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn();

        cmd
    } else {
        // Production: run bundled sidecar executable
        let sidecar_path = resource_dir
            .map(|p| p.join("sidecar"))
            .unwrap_or_else(|| std::path::PathBuf::from("sidecar"));

        Command::new(&sidecar_path)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
    };

    match result {
        Ok(child) => {
            log::info!("Sidecar started with PID: {}", child.id());
            *SIDECAR_PROCESS.lock().unwrap() = Some(child);
        }
        Err(e) => {
            log::error!("Failed to start sidecar: {}", e);
        }
    }
}

fn stop_sidecar() {
    if let Ok(mut guard) = SIDECAR_PROCESS.lock() {
        if let Some(mut child) = guard.take() {
            log::info!("Stopping sidecar...");
            let _ = child.kill();
        }
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

            // Start the Node.js sidecar for full backend functionality
            let resource_dir = app.path().resource_dir().ok();
            std::thread::spawn(move || {
                start_sidecar(resource_dir);
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
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Stop sidecar when window closes
                stop_sidecar();
            }
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
