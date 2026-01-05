#!/bin/bash
set -e

# RhizOS Node Agent Installer
# https://github.com/Huck-dev/rhizos-node

REPO="Huck-dev/rhizos-node"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="rhizos-node"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔═══════════════════════════════════════╗"
echo "║     RhizOS Node Agent Installer       ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$ARCH" in
    x86_64) ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    armv7l) ARCH="arm" ;;
    *) echo -e "${RED}Unsupported architecture: $ARCH${NC}"; exit 1 ;;
esac

case "$OS" in
    linux) PLATFORM="linux" ;;
    darwin) PLATFORM="darwin" ;;
    *) echo -e "${RED}Unsupported OS: $OS${NC}"; exit 1 ;;
esac

echo -e "${GREEN}Detected:${NC} $PLATFORM-$ARCH"

# Get latest release
echo -e "${YELLOW}Fetching latest release...${NC}"
LATEST_URL="https://api.github.com/repos/$REPO/releases/latest"
DOWNLOAD_URL=$(curl -s "$LATEST_URL" | grep "browser_download_url.*$PLATFORM-$ARCH" | cut -d '"' -f 4 | head -1)

if [ -z "$DOWNLOAD_URL" ]; then
    echo -e "${YELLOW}No pre-built binary found. Building from source...${NC}"

    # Check for Rust
    if ! command -v cargo &> /dev/null; then
        echo -e "${RED}Rust not found. Install from https://rustup.rs${NC}"
        exit 1
    fi

    # Clone and build
    TMP_DIR=$(mktemp -d)
    cd "$TMP_DIR"
    git clone "https://github.com/$REPO.git" .
    cargo build --release

    sudo mv target/release/rhizos-node "$INSTALL_DIR/$BINARY_NAME"
    cd -
    rm -rf "$TMP_DIR"
else
    # Download binary
    echo -e "${YELLOW}Downloading from $DOWNLOAD_URL...${NC}"
    TMP_FILE=$(mktemp)
    curl -L -o "$TMP_FILE" "$DOWNLOAD_URL"
    chmod +x "$TMP_FILE"
    sudo mv "$TMP_FILE" "$INSTALL_DIR/$BINARY_NAME"
fi

# Verify installation
if command -v $BINARY_NAME &> /dev/null; then
    echo ""
    echo -e "${GREEN}✓ Installation successful!${NC}"
    echo ""
    $BINARY_NAME --version 2>/dev/null || echo "rhizos-node installed"
    echo ""
    echo -e "${CYAN}Quick Start:${NC}"
    echo "  rhizos-node --orchestrator http://ORCHESTRATOR_IP:8080"
    echo ""
    echo -e "${CYAN}Show hardware info:${NC}"
    echo "  rhizos-node info"
    echo ""
else
    echo -e "${RED}Installation failed${NC}"
    exit 1
fi
