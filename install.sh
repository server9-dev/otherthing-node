#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────
# OtherThing Node — Linux Installer
# Zero-config: installs everything and auto-detects services.
# No .env needed. Just install and run.
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
    sleep 3
    info "Pulling a starter model (gemma3:4b — works on most GPUs)..."
    ollama pull gemma3:4b || warn "Model pull failed — you can pull models later from the app"
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
    # Increase file descriptor limit (prevents crash on large uploads)
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

# ── Docker ───────────────────────────────────────────────────
ensure_docker() {
  if command -v docker &>/dev/null; then
    ok "Docker already installed ($(docker --version 2>/dev/null | head -1))"
    return 0
  fi

  info "Installing Docker..."
  if [ "$PM" = "apt" ]; then
    curl -fsSL https://get.docker.com | sh
  elif [ "$PM" = "dnf" ]; then
    sudo dnf install -y docker
    sudo systemctl enable --now docker
  elif [ "$PM" = "pacman" ]; then
    $INSTALL docker
    sudo systemctl enable --now docker
  fi

  if command -v docker &>/dev/null; then
    ok "Docker installed"
    # Add user to docker group so they don't need sudo
    if ! groups | grep -q docker; then
      sudo usermod -aG docker "$USER"
      info "Added $USER to docker group — log out and back in for this to take effect"
    fi
  else
    warn "Docker install failed — install manually: https://docs.docker.com/engine/install/"
  fi
}

# ── code-server ──────────────────────────────────────────────
ensure_code_server() {
  if command -v code-server &>/dev/null || [ -x "$HOME/.local/code-server/bin/code-server" ]; then
    ok "code-server already installed"
    return 0
  fi

  info "Installing code-server..."
  curl -fsSL https://code-server.dev/install.sh | sh

  if command -v code-server &>/dev/null || [ -x "$HOME/.local/bin/code-server" ]; then
    ok "code-server installed"
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
      # Electron dependencies
      for lib in libgtk-3-0 libnotify4 libnss3 libxss1 libxtst6 libatspi2.0-0 libsecret-1-0 libgbm1 libasound2 libdrm2; do
        dpkg -s "$lib" &>/dev/null 2>&1 || pkgs+=("$lib")
      done
      # build-essential for native npm modules
      dpkg -s build-essential &>/dev/null 2>&1 || pkgs+=(build-essential)
      ;;
    dnf)
      for cmd in git curl gcc gcc-c++ make python3; do
        command -v "$cmd" &>/dev/null || pkgs+=("$cmd")
      done
      for lib in gtk3 libnotify nss libXScrnSaver libXtst at-spi2-atk libsecret alsa-lib mesa-libGL; do
        rpm -q "$lib" &>/dev/null 2>&1 || pkgs+=("$lib")
      done
      ;;
    pacman)
      for cmd in git curl gcc make python3; do
        command -v "$cmd" &>/dev/null || pkgs+=("$cmd")
      done
      # Electron dependencies — only add if not already installed
      for lib in gtk3 libnotify nss libxss libxtst at-spi2-core libsecret glib2 nspr alsa-lib mesa; do
        pacman -Qi "$lib" &>/dev/null 2>&1 || pkgs+=("$lib")
      done
      # base-devel for native npm modules
      pacman -Qi base-devel &>/dev/null 2>&1 || pkgs+=(base-devel)
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
  npm install 2>&1 | tail -3
  ok "npm dependencies installed"

  if [ -d "contracts" ]; then
    info "Installing smart contract dependencies..."
    cd contracts && npm install 2>&1 | tail -2 && cd ..
    ok "Contract dependencies installed"
  fi
}

# ── Build the main process ──────────────────────────────────
build_app() {
  cd "$INSTALL_DIR"
  info "Building TypeScript (main process)..."
  npx tsc -p tsconfig.main.json 2>&1 || {
    warn "TypeScript build had errors — the app may still work via dev mode"
  }
  ok "Build complete"
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
Terminal=true
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

# ── Verify installation ──────────────────────────────────────
verify_install() {
  cd "$INSTALL_DIR"
  local issues=0

  info "Verifying installation..."

  # Check node
  if ! command -v node &>/dev/null; then
    warn "Node.js not found in PATH"
    ((issues++))
  fi

  # Check npm deps installed
  if [ ! -d "node_modules" ]; then
    warn "node_modules missing — run: cd $INSTALL_DIR && npm install"
    ((issues++))
  fi

  # Check Ollama
  if command -v ollama &>/dev/null; then
    # Try to detect if Ollama is reachable
    if curl -s --max-time 2 http://localhost:11434/api/tags &>/dev/null; then
      local model_count
      model_count=$(curl -s http://localhost:11434/api/tags 2>/dev/null | python3 -c "import sys,json; print(len(json.load(sys.stdin).get('models',[])))" 2>/dev/null || echo "0")
      ok "Ollama running with $model_count model(s)"
    else
      info "Ollama installed but not running — start with: ollama serve"
    fi
  else
    info "Ollama not installed — AI features will use premium tier or be unavailable"
  fi

  # Check IPFS
  if command -v ipfs &>/dev/null; then
    ok "IPFS installed"
  else
    info "IPFS not installed — the app will auto-download it on first launch"
  fi

  # Quick port check
  if curl -s --max-time 2 http://localhost:8080/health &>/dev/null; then
    warn "Port 8080 already in use — the app will try 8081"
  fi

  if [ $issues -eq 0 ]; then
    ok "All checks passed"
  else
    warn "$issues issue(s) found — see above"
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

step "Docker"
ensure_docker

step "code-server (VS Code Editor)"
ensure_code_server

step "PATH Setup"
ensure_path

step "OtherThing Repository"
setup_repo

step "npm Dependencies"
install_deps

step "Build"
build_app

step "Desktop Entry"
create_desktop_entry

step "Verification"
verify_install

echo -e "\n${BOLD}${GREEN}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║          Installation Complete!               ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${RESET}\n"

echo -e "  ${BOLD}Start the app:${RESET}"
echo -e "    cd $INSTALL_DIR && npm run dev\n"
echo -e "  ${BOLD}Or launch from your app menu:${RESET} OtherThing Node\n"
echo -e "  ${BOLD}No configuration needed.${RESET} Everything auto-detects.\n"
echo -e "  ${BOLD}Optional — pull more AI models:${RESET}"
echo -e "    ollama pull qwen3:8b             # better for AI chat + digests"
echo -e "    ollama pull llama3.2-vision:11b  # image safety scanning\n"
