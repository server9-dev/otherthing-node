# RhizOS Node Agent Docker Image
# Build: docker build -t rhizos-node .
# Run: docker run -d --gpus all -e ORCHESTRATOR_URL=http://host:8080 rhizos-node

FROM rust:1.75-slim-bookworm AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy source
COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Build release binary
RUN cargo build --release

# Runtime image
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl3 \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

# Copy binary from builder
COPY --from=builder /app/target/release/rhizos-node /usr/local/bin/

# Create config directory
RUN mkdir -p /root/.rhizos

# Environment variables
ENV ORCHESTRATOR_URL=http://localhost:8080
ENV NODE_NAME=docker-node
ENV RUST_LOG=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD rhizos-node health || exit 1

ENTRYPOINT ["rhizos-node"]
CMD ["--orchestrator", "${ORCHESTRATOR_URL}", "--name", "${NODE_NAME}"]
