#!/bin/bash
# ============================================
# Aquorix Bot — Lightsail Setup Script
# Run this ONCE after SSH-ing into your Lightsail instance
# ============================================

set -e  # Exit on any error

echo "🚀 Starting Aquorix Bot Setup on Lightsail..."

# ========================
# 1. System Updates
# ========================
echo "📦 Updating system packages..."
sudo apt-get update -y
sudo apt-get upgrade -y

# ========================
# 2. Install Node.js 18
# ========================
echo "📦 Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
echo "✅ Node.js $(node -v) installed"

# ========================
# 3. Install PM2 (Process Manager)
# ========================
echo "📦 Installing PM2..."
sudo npm install -g pm2
echo "✅ PM2 installed"

# ========================
# 4. Install Nginx
# ========================
echo "📦 Installing Nginx..."
sudo apt-get install -y nginx
sudo systemctl enable nginx

# ========================
# 5. Clone the repo
# ========================
echo "📦 Cloning Aquorix bot..."
cd /home/ubuntu
git clone https://github.com/satyanarayanacheeday/aquabot.git
cd aquabot

# ========================
# 6. Install dependencies
# ========================
echo "📦 Installing Node.js dependencies..."
npm ci --production

# ========================
# 7. Create .env file
# ========================
echo "📝 Creating .env file..."
cat > .env << 'ENVFILE'
# WhatsApp Cloud API
WHATSAPP_TOKEN=EAAdVGUrIsjEBRWHoXuTaWQNV8ZBsmGMZC2B8ZAzNWb382CrhuIiQLfh8HrLYRr3ViqByzuxvdIwDzwa70RR2bptZBUahaYYL5hbeSo4bNEhC0OSh9DWZCNIyUkZATu6ZCPRjSVfFQycTWk3k1cu8WccDfIERheZCiT5AoRhMHCONLZCrV5wcXClaI6skmIwpaOwu0ogZDZD
WHATSAPP_PHONE_NUMBER_ID=1004218429446182
VERIFY_TOKEN=aquorix_verify_2026
WHATSAPP_APP_SECRET=f429df6679c22bdb589b16cd0538006e

# Supabase
SUPABASE_URL=https://kpocufubvggidvrgpsfw.supabase.co
SUPABASE_KEY=sb_publishable_jxs8JIUwqWV9q2MypNzTYw_gLSBtSOW

# Gemini
GEMINI_API_KEY=AIzaSyAARBIx-L_KkLONU9gXNTYSXJm1533w1s0

# OpenWeather
OPENWEATHER_API_KEY=your_openweather_api_key

# Server
PORT=3000
NODE_ENV=production
ENVFILE

echo "✅ .env file created"

# ========================
# 8. Create logs directory
# ========================
mkdir -p logs

# ========================
# 9. Start with PM2
# ========================
echo "🚀 Starting Aquorix with PM2..."
pm2 start server.js --name aquorix --max-memory-restart 400M
pm2 save

# Auto-restart on server reboot
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 save

echo "✅ Bot is running!"
pm2 status

# ========================
# 10. Configure Nginx
# ========================
echo "🔧 Configuring Nginx reverse proxy..."
sudo tee /etc/nginx/sites-available/aquorix > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;
    }

    # Block sensitive paths
    location ~ /\. {
        deny all;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/aquorix /etc/nginx/sites-enabled/aquorix
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo ""
echo "============================================"
echo "✅ AQUORIX BOT DEPLOYED SUCCESSFULLY!"
echo "============================================"
echo ""
echo "Bot URL: http://$(curl -s http://checkip.amazonaws.com)/webhook"
echo ""
echo "📋 Next Steps:"
echo "  1. Attach a Static IP in Lightsail console"
echo "  2. Open port 80 and 443 in Lightsail Firewall"
echo "  3. (Optional) Add domain + SSL with: sudo certbot --nginx -d yourdomain.com"
echo "  4. Update Meta webhook URL to: https://yourdomain.com/webhook"
echo ""
echo "📋 Useful Commands:"
echo "  pm2 logs aquorix     — View live logs"
echo "  pm2 restart aquorix  — Restart bot"
echo "  pm2 status           — Check status"
echo "  pm2 monit            — Monitor CPU/RAM"
echo ""
