#!/usr/bin/env bash
set -e

echo "============================================================"
echo "      GRAPHRAG KNOWLEDGE SYSTEM — AUTOMATED VPS SETUP       "
echo "============================================================"

# 1. Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "[-] Please run as root (or use sudo): sudo bash deploy_vps.sh"
  exit 1
fi

echo "[1/4] Updating package lists and installing essential tools..."
apt-get update -qq
apt-get install -y -qq curl git ufw ca-certificates gnupg lsb-release

# 2. Install Docker if not present
if ! command -v docker &> /dev/null; then
    echo "[2/4] Installing Docker Engine..."
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
else
    echo "[2/4] Docker is already installed."
fi

# 3. Configure Firewall (ports 80, 443, and 22 for SSH)
echo "[3/4] Configuring firewall..."
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw --force enable || true

# 4. Launch multi-container production stack
echo "[4/4] Launching GraphRAG production containers..."
docker compose -f docker-compose.prod.yml up -d --build

SERVER_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

echo ""
echo "============================================================"
echo "           DEPLOYMENT COMPLETE & LIVE WORLDWIDE!           "
echo "============================================================"
echo ""
echo "Your GraphRAG Knowledge System is live at:"
echo "👉 http://${SERVER_IP}"
echo ""
echo "AI Models (llama3.2 & nomic-embed-text) are downloading in the background."
echo "You can check status with: docker compose -f docker-compose.prod.yml logs -f"
echo "============================================================"

