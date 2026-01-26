use std::net::SocketAddr;
use std::sync::Arc;

use axum::http::{header, Method};
use tower_http::cors::{Any, CorsLayer};

use super::routes::{create_router, AppState};

pub struct ApiServer {
    state: Arc<AppState>,
}

impl ApiServer {
    pub fn new() -> Self {
        Self {
            state: Arc::new(AppState::new()),
        }
    }

    pub async fn start(&self, port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        // Create CORS layer
        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::PUT, Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

        // Build the router
        let app = create_router(Arc::clone(&self.state))
            .layer(cors);

        let addr = SocketAddr::from(([0, 0, 0, 0], port));
        log::info!("Rust API server listening on http://{}", addr);

        let listener = tokio::net::TcpListener::bind(addr).await?;
        axum::serve(listener, app).await?;

        Ok(())
    }
}

impl Default for ApiServer {
    fn default() -> Self {
        Self::new()
    }
}
