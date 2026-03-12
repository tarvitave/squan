#!/usr/bin/env bash
# Run once on a fresh Ubuntu 24.04 droplet:
#   bash bootstrap-droplet.sh
set -euo pipefail

echo "==> Installing Docker"
apt-get update -qq
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

echo "==> Creating /opt/squansq"
mkdir -p /opt/squansq

echo "==> Enabling /dev/pts (required for node-pty)"
# /dev/pts is mounted by default in Ubuntu — verify:
ls /dev/pts

echo ""
echo "Done. Add these GitHub Actions secrets:"
echo "  DROPLET_HOST  = $(curl -s ifconfig.me)"
echo "  DROPLET_USER  = root"
echo "  DROPLET_SSH_KEY = <your private SSH key>"
