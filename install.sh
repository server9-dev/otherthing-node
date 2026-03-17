#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# OtherThing Node — Linux Installer
# Installs all dependencies and sets up the OtherThing desktop app
# ──────────────────────────────────────────────────────────────

set -euo pipefail

REPO="https://github.com/server9-dev/otherthing-node.git"
INSTALL_DIR="${OTHERTHING_DIR:-$HOME/otherthing-node}"
NODE_MIN_VERSION=18
BOLD="\033[1m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

info()  { echo -e "${CYAN}[INFO]${RESET}  $*"; }
ok()    { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
fail()  { echo -e "${RED}[FAIL]${RESET}  $*"; exit 1; }
step()  { echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── Detect package manager ──────────────────────────────────
detect_pm() {
  if command -v apt-get &>/dev/null; then
    PM="apt"
    INSTALL="sudo apt-get install -y"
    UPDATE="sudo apt-get update -qq"
  elif command -v dnf &>/dev/null; then
    PM="dnf"
    INSTALL="sudo dnf install -y"
    UPDATE="sudo dnf check-update || true"
  elif command -v pacman &>/dev/null; then
    PM="pacman"
    INSTALL="sudo pacman -S --noconfirm"
    UPDATE="sudo pacman -Sy"
  else
    fail "No supported package manager found (apt, dnf, or pacman required)"
  fi
}

# ── Check / install a command ────────────────────────────────
ensure_cmd() {
  local cmd="$1"
  local pkg="${2:-$1}"
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd already installed ($(command -v "$cmd"))"
    return 0
  fi
  info "Installing $cmd..."
  $INSTALL "$pkg"
  if command -v "$cmd" &>/dev/null; then
    ok "$cmd installed"
  else
    warn "$cmd install attempted but not found in PATH — you may need to install manually"
  fi
}

# ── Node.js ──────────────────────────────────────────────────
ensure_node() {
  if command -v node &>/dev/null; then
    local ver
    ver=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$ver" -ge "$NODE_MIN_VERSION" ]; then
      ok "Node.js $(node -v) already installed"
      return 0
    fi
    warn "Node.js $(node -v) is below minimum v${NODE_MIN_VERSION}"
  fi

  info "Installing Node.js via NodeSource..."
  if [ "$PM" = "apt" ]; then
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    $INSTALL nodejs
  elif [ "$PM" = "dnf" ]; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash -
    $INSTALL nodejs
  elif [ "$PM" = "pacman" ]; then
    $INSTALL nodejs npm
  fi

  if command -v node &>/dev/null; then
    ok "Node.js $(node -v) installed"
  else
    fail "Failed to install Node.js. Install manually: https://nodejs.org"
  fi
}

# ── Ollama ───────────────────────────────────────────────────
ensure_ollama() {
  if command -v ollama &>/dev/null; then
    ok "Ollama already installed ($(ollama --version 2>/dev/null || echo 'installed'))"
    return 0
  fi

  info "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh

  if command -v ollama &>/dev/null; then
    ok "Ollama installed"
    info "Starting Ollama service..."
    ollama serve &>/dev/null &
    sleep 2
    info "Pulling a default model (qwen2.5:1.5b — small and fast)..."
    ollama pull qwen2.5:1.5b || warn "Model pull failed — you can pull models later with: ollama pull <model>"
  else
    warn "Ollama install script ran but binary not found — install manually: https://ollama.com"
  fi
}

# ── IPFS (Kubo) ──────────────────────────────────────────────
ensure_ipfs() {
  if command -v ipfs &>/dev/null; then
    ok "IPFS already installed ($(ipfs version 2>/dev/null || echo 'installed'))"
    return 0
  fi

  info "Installing IPFS (Kubo)..."
  local IPFS_VERSION="v0.32.1"
  local ARCH
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *)       warn "Unsupported architecture $ARCH for IPFS auto-install"; return 1 ;;
  esac

  local TARBALL="kubo_${IPFS_VERSION}_linux-${ARCH}.tar.gz"
  local URL="https://dist.ipfs.tech/kubo/${IPFS_VERSION}/${TARBALL}"

  cd /tmp
  curl -fsSL -o "$TARBALL" "$URL"
  tar xzf "$TARBALL"
  cd kubo
  sudo bash install.sh
  cd /tmp && rm -rf kubo "$TARBALL"

  if command -v ipfs &>/dev/null; then
    ok "IPFS $(ipfs version) installed"
    if [ ! -d "$HOME/.ipfs" ]; then
      info "Initializing IPFS repo..."
      ipfs init --profile=lowpower
    fi
    # Increase file descriptor limit for IPFS (prevents crash on large uploads)
    local current_ulimit
    current_ulimit=$(ulimit -n 2>/dev/null || echo "0")
    if [ "$current_ulimit" -lt 65536 ] 2>/dev/null; then
      info "Increasing file descriptor limit for IPFS stability..."
      local shell_rc=""
      [ -f "$HOME/.bashrc" ] && shell_rc="$HOME/.bashrc"
      [ -f "$HOME/.zshrc" ] && shell_rc="$HOME/.zshrc"
      if [ -n "$shell_rc" ] && ! grep -q "ulimit -n 65536" "$shell_rc" 2>/dev/null; then
        echo 'ulimit -n 65536 2>/dev/null' >> "$shell_rc"
        info "Added ulimit -n 65536 to $shell_rc"
      fi
      ulimit -n 65536 2>/dev/null || true
    fi
  else
    warn "IPFS install failed — install manually: https://docs.ipfs.tech/install/"
  fi
}

# ── code-server ──────────────────────────────────────────────
ensure_code_server() {
  if command -v code-server &>/dev/null || [ -x "$HOME/.local/code-server/bin/code-server" ]; then
    ok "code-server already installed"
    return 0
  fi

  info "Installing code-server..."
  local CS_VERSION="4.111.0"
  local ARCH
  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *)       warn "Unsupported architecture $ARCH for code-server"; return 1 ;;
  esac

  local TARBALL="code-server-${CS_VERSION}-linux-${ARCH}.tar.gz"
  local URL="https://github.com/coder/code-server/releases/download/v${CS_VERSION}/${TARBALL}"

  cd /tmp
  curl -fsSL -o "$TARBALL" "$URL"
  tar xzf "$TARBALL"
  mkdir -p "$HOME/.local"
  rm -rf "$HOME/.local/code-server"
  mv "code-server-${CS_VERSION}-linux-${ARCH}" "$HOME/.local/code-server"
  mkdir -p "$HOME/.local/bin"
  ln -sf "$HOME/.local/code-server/bin/code-server" "$HOME/.local/bin/code-server"
  rm -f "$TARBALL"

  if [ -x "$HOME/.local/code-server/bin/code-server" ]; then
    ok "code-server $CS_VERSION installed to ~/.local/code-server"
  else
    warn "code-server install failed — install manually: https://coder.com/docs/code-server"
  fi
}

# ── Build tools ──────────────────────────────────────────────
ensure_build_tools() {
  local pkgs=()
  case "$PM" in
    apt)
      for cmd in git curl gcc g++ make python3; do
        command -v "$cmd" &>/dev/null || pkgs+=("$cmd")
      done
      # Electron needs these on Linux
      for lib in libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libsecret-1-0; do
        dpkg -s "$lib" &>/dev/null 2>&1 || pkgs+=("$lib")
      done
      ;;
    dnf)
      for cmd in git curl gcc gcc-c++ make python3; do
        command -v "$cmd" &>/dev/null || pkgs+=("$cmd")
      done
      pkgs+=(gtk3 libnotify nss libXScrnSaver libXtst at-spi2-atk libsecret)
      ;;
    pacman)
      for cmd in git curl gcc make python3; do
        command -v "$cmd" &>/dev/null || pkgs+=("$cmd")
      done
      pkgs+=(gtk3 libnotify nss libxss libxtst at-spi2-atk libsecret)
      ;;
  esac

  if [ ${#pkgs[@]} -gt 0 ]; then
    info "Installing build tools and Electron dependencies: ${pkgs[*]}"
    $UPDATE 2>/dev/null || true
    $INSTALL "${pkgs[@]}"
    ok "Build tools installed"
  else
    ok "Build tools already present"
  fi
}

# ── Clone / update repo ─────────────────────────────────────
setup_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    info "Updating existing repo at $INSTALL_DIR..."
    cd "$INSTALL_DIR"
    git pull --ff-only || warn "Git pull failed — you may have local changes"
  else
    info "Cloning OtherThing Node to $INSTALL_DIR..."
    git clone "$REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"
  fi
  ok "Repo ready at $INSTALL_DIR"
}

# ── Install npm dependencies ────────────────────────────────
install_deps() {
  cd "$INSTALL_DIR"
  info "Installing npm dependencies..."
  npm install
  ok "npm dependencies installed"

  if [ -d "contracts" ]; then
    info "Installing smart contract dependencies..."
    cd contracts && npm install && cd ..
    ok "Contract dependencies installed"
  fi
}

# ── Create .env if missing ───────────────────────────────────
setup_env() {
  cd "$INSTALL_DIR"
  if [ ! -f .env ] && [ -f .env.example ]; then
    cp .env.example .env
    info "Created .env from .env.example — edit it with your credentials"
  elif [ -f .env ]; then
    ok ".env already exists"
  fi
}

# ── Create desktop entry ─────────────────────────────────────
create_desktop_entry() {
  local desktop_file="$HOME/.local/share/applications/otherthing-node.desktop"
  mkdir -p "$(dirname "$desktop_file")"

  cat > "$desktop_file" << EOF
[Desktop Entry]
Name=OtherThing Node
Comment=Decentralized workspace platform
Exec=bash -c "cd $INSTALL_DIR && npm run dev"
Icon=$INSTALL_DIR/public/logo.png
Terminal=false
Type=Application
Categories=Development;Network;
StartupNotify=true
EOF

  if [ -f "$desktop_file" ]; then
    ok "Desktop entry created — find OtherThing in your app launcher"
  fi
}

# ── Add ~/.local/bin to PATH if needed ────────────────────────
ensure_path() {
  if [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    local shell_rc=""
    if [ -f "$HOME/.bashrc" ]; then
      shell_rc="$HOME/.bashrc"
    elif [ -f "$HOME/.zshrc" ]; then
      shell_rc="$HOME/.zshrc"
    fi
    if [ -n "$shell_rc" ]; then
      echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_rc"
      export PATH="$HOME/.local/bin:$PATH"
      info "Added ~/.local/bin to PATH in $shell_rc"
    fi
  fi
}

# ══════════════════════════════════════════════════════════════
#                        MAIN
# ══════════════════════════════════════════════════════════════

echo -e "\n${BOLD}${CYAN}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║       OtherThing Node — Linux Installer      ║${RESET}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════╝${RESET}\n"

detect_pm
info "Detected package manager: $PM"

step "System Dependencies"
ensure_build_tools

step "Node.js"
ensure_node

step "Ollama (Local AI)"
ensure_ollama

step "IPFS (Distributed Storage)"
ensure_ipfs

step "code-server (VS Code Editor)"
ensure_code_server

step "PATH Setup"
ensure_path

step "OtherThing Repository"
setup_repo

step "npm Dependencies"
install_deps

step "Environment Config"
setup_env

step "Desktop Entry"
create_desktop_entry

echo -e "\n${BOLD}${GREEN}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║          Installation Complete!               ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${RESET}\n"

echo -e "  ${BOLD}Start the app:${RESET}"
echo -e "    cd $INSTALL_DIR && npm run dev\n"
echo -e "  ${BOLD}Or launch from your app menu:${RESET} OtherThing Node\n"
echo -e "  ${BOLD}Optional — pull AI models:${RESET}"
echo -e "    ollama pull gemma3:4b            # fast, good for digests + health reports"
echo -e "    ollama pull qwen3:8b             # larger, better for AI chat + handoff docs"
echo -e "    ollama pull llama3.2-vision:11b  # image content safety scanning\n"
echo -e "  ${BOLD}Seed demo data (after app starts):${RESET}"
echo -e "    bash scripts/seed-demo-data.sh\n"
echo -e "  ${BOLD}Configure:${RESET} Edit $INSTALL_DIR/.env\n"
