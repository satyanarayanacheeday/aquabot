#!/bin/bash
# ============================================================
#  Aquorix Bot — Complete Lightsail Deploy Script v3
#  Run ONCE after SSH-ing into a fresh Ubuntu 22.04 instance:
#    chmod +x deploy_lightsail.sh && ./deploy_lightsail.sh
# ============================================================

set -euo pipefail   # exit on error, unset var, or pipe failure

REPO_URL="https://github.com/satyanarayanacheeday/aquabot.git"
APP_DIR="/home/ubuntu/aquabot"
APP_NAME="aquorix"

echo ""
echo "============================================================"
echo " 🚀  AQUORIX BOT — LIGHTSAIL DEPLOY"
echo "============================================================"
echo ""

# ========================
# 1. System Updates
# ========================
echo "📦 [1/10] Updating system packages..."
sudo apt-get update -y -q
sudo apt-get upgrade -y -q
echo "✅ System updated"

# ========================
# 2. Install Node.js 20 (LTS)
# ========================
echo "📦 [2/10] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - -q
sudo apt-get install -y nodejs -q
echo "✅ Node.js $(node -v) | npm $(npm -v)"

# ========================
# 3. Install PM2
# ========================
echo "📦 [3/10] Installing PM2..."
sudo npm install -g pm2 --quiet
echo "✅ PM2 $(pm2 -v)"

# ========================
# 4. Install Nginx + Certbot
# ========================
echo "📦 [4/10] Installing Nginx + Certbot..."
sudo apt-get install -y nginx certbot python3-certbot-nginx -q
sudo systemctl enable nginx
sudo systemctl start nginx
echo "✅ Nginx installed"

# ========================
# 5. Clone or Pull Repo
# ========================
echo "📦 [5/10] Setting up application code..."
if [ -d "$APP_DIR" ]; then
  echo "   ↻  Repo already exists — pulling latest..."
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main   # clean pull, no merge conflicts
else
  echo "   ↓  Cloning repo..."
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi
echo "✅ Code ready at $APP_DIR"

# ========================
# 6. Install Node Dependencies
# ========================
echo "📦 [6/10] Installing Node.js dependencies..."
npm ci --omit=dev --prefer-offline
echo "✅ Dependencies installed"

# ========================
# 7. Create logs directory
# ========================
echo "📁 Creating logs directory..."
mkdir -p logs
echo "✅ logs/ directory ready"

# ========================
# 8. Create .env file
# ========================
echo "📝 [7/10] Writing .env..."

# ── EDIT YOUR SECRETS BELOW BEFORE RUNNING ──────────────────
cat > .env << 'ENVFILE'
# WhatsApp Cloud API
WHATSAPP_TOKEN=EAAdVGUrIsjEBRWHoXuTaWQNV8ZBsmGMZC2B8ZAzNWb382CrhuIiQLfh8HrLYRr3ViqByzuxvdIwDzwa70RR2bptZBUahaYYL5hbeSo4bNEhC0OSh9DWZCNIyUkZATu6ZCPRjSVfFQycTWk3k1cu8WccDfIERheZCiT5AoRhMHCONLZCrV5wcXClaI6skmIwpaOwu0ogZDZD
WHATSAPP_PHONE_NUMBER_ID=1004218429446182
VERIFY_TOKEN=aquorix_verify_2026
WHATSAPP_APP_SECRET=f429df6679c22bdb589b16cd0538006e

# Supabase
SUPABASE_URL=https://kpocufubvggidvrgpsfw.supabase.co
SUPABASE_KEY=sb_publishable_jxs8JIUwqWV9q2MypNzTYw_gLSBtSOW

# Gemini AI
GEMINI_API_KEY=AIzaSyAARBIx-L_KkLONU9gXNTYSXJm1533w1s0

# OpenWeather (optional)
OPENWEATHER_API_KEY=your_openweather_api_key

# Server
PORT=3000
NODE_ENV=production
ENVFILE
# ── END OF SECRETS ───────────────────────────────────────────

echo "✅ .env written"

# ========================
# 9. Syntax-check server.js BEFORE starting
# ========================
echo "🔍 [8/10] Syntax-checking server.js..."
node --check server.js
echo "✅ server.js syntax OK"

# ========================
# 10. Start / Restart with PM2
# ========================
echo "🚀 [9/10] Starting app with PM2..."

# Stop old instance if running
pm2 delete "$APP_NAME" 2>/dev/null || true

pm2 start server.js \
  --name "$APP_NAME" \
  --max-memory-restart 400M \
  --log logs/pm2.log \
  --merge-logs \
  --time

pm2 save

# Auto-restart on server reboot
sudo env PATH="$PATH:/usr/bin" \
  pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | sudo bash -
pm2 save

echo "✅ PM2 started — waiting 5 s for app to bind port..."
sleep 5

# ========================
# 11. Verify app is actually running
# ========================
echo "🔍 Verifying health endpoint..."
if ! curl -sf http://127.0.0.1:3000/health > /dev/null; then
  echo ""
  echo "❌ App health check FAILED. Last PM2 logs:"
  pm2 logs "$APP_NAME" --lines 30 --nostream
  echo ""
  echo "Fix the error above, then run: pm2 restart $APP_NAME"
  exit 1
fi
echo "✅ App is healthy on port 3000"

# ========================
# 12. Configure Nginx
# ========================
echo "🔧 [10/10] Configuring Nginx reverse proxy..."

PUBLIC_IP=$(curl -sf http://checkip.amazonaws.com || echo "YOUR_IP")

sudo tee /etc/nginx/sites-available/aquorix > /dev/null << NGINX
server {
    listen 80;
    server_name _;          # Catch-all (works with IP; swap _ for domain later)

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Proxy to Node app
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 90s;

        # Don't buffer webhook payloads
        proxy_buffering    off;
    }

    # Health check (internal only)
    location /health {
        proxy_pass http://127.0.0.1:3000/health;
        access_log off;
    }

    # Block dotfiles (.env, .git, etc)
    location ~ /\. {
        deny all;
    }
}
NGINX

# Enable site, disable default
sudo ln -sf /etc/nginx/sites-available/aquorix /etc/nginx/sites-enabled/aquorix
sudo rm -f /etc/nginx/sites-enabled/default

# Test config and reload
sudo nginx -t
sudo systemctl reload nginx
echo "✅ Nginx configured and reloaded"

# ========================
# DONE — Print Summary
# ========================
echo ""
echo "============================================================"
echo " ✅  AQUORIX BOT DEPLOYED SUCCESSFULLY!"
echo "============================================================"
echo ""
echo " 🌐  Bot accessible at: http://${PUBLIC_IP}"
echo " 🔗  Webhook URL:       http://${PUBLIC_IP}/webhook"
echo " ❤️   Health check:      http://${PUBLIC_IP}/health"
echo ""
echo " 📋  NEXT STEPS:"
echo "   1️⃣  Lightsail Console → Networking → open ports 80 and 443"
echo "   2️⃣  Lightsail Console → Attach a Static IP"
echo "   3️⃣  Point your domain DNS A-record to: ${PUBLIC_IP}"
echo "   4️⃣  Once DNS resolves, add HTTPS:"
echo "        sudo certbot --nginx -d aquabot.satyacheeday.me"
echo "   5️⃣  Update Meta webhook URL to: https://aquabot.satyacheeday.me/webhook"
echo ""
echo " 🛠️   USEFUL COMMANDS:"
echo "   pm2 status               — Process status"
echo "   pm2 logs $APP_NAME       — Live logs"
echo "   pm2 restart $APP_NAME    — Restart app"
echo "   pm2 monit                — CPU/RAM monitor"
echo "   sudo nginx -t && sudo systemctl reload nginx  — Reload Nginx"
echo ""
pm2 status
