# AIOps Self-Healing Copilot - Deployment Manual ☁️🚀

This guide explains how to deploy the entire fullstack application (FastAPI backend + Vite React frontend + monitored child microservice) to production on a single instance.

---

## 📌 Prerequisites
1. Ensure your codebase is pushed to your GitHub repository: `https://github.com/prakash200627/AIOps.git`
2. Prepare your **Groq API Key** (optional, fallback heuristic SRE diagnosis will run automatically if key is omitted).

---

## 🚀 Option 1: Deploy to Render (Recommended & Free)
Render is the easiest way to deploy a persistent Python FastAPI web service with WebSocket support.

### Step 1: Create a Web Service
1. Log in to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** (top right) ➔ **Web Service**.
3. Select **Build and deploy from a Git repository**.
4. Connect your GitHub account and select your **`AIOps`** repository.

### Step 2: Configure Service Settings
Fill in the deployment details exactly as follows:
* **Name**: `aiops-self-healing-copilot`
* **Region**: Choose the region closest to you
* **Runtime**: `Python`
* **Branch**: `main`
* **Build Command**:
  ```bash
  pip install -r requirements.txt && cd frontend && npm install && npm run build
  ```
  *(This command installs Python dependencies, navigates to the frontend folder, installs node modules, and compiles React into compiled static assets in `frontend/dist`)*
* **Start Command**:
  ```bash
  uvicorn main:app --host 0.0.0.0 --port $PORT
  ```
  *(This launches FastAPI on the dynamic port allocated by Render. FastAPI detects `frontend/dist` and serves it automatically)*

### Step 3: Add Environment Variables
1. Scroll down and click **Advanced** ➔ **Add Environment Variable**.
2. Add the following variables:
   * **Key**: `GROQ_API_KEY` | **Value**: `gsk_your_actual_key_here`
   * **Key**: `GROQ_MODEL` | **Value**: `llama-3.3-70b-versatile` *(optional)*
   * **Key**: `PYTHONUNBUFFERED` | **Value**: `1` *(ensures live logs stream instantly to Render's console)*

### Step 4: Deploy!
Click **Create Web Service**. Once the build finishes and the log shows `Uvicorn running on http://0.0.0.0:xxxx`, click your Render URL (found at the top left of your Render panel) to open the live dashboard.

---

## ⚡ Option 2: Deploy to Railway
Railway is extremely fast and provides persistent SQLite disk storage easily.

### Step 1: Connect your Repository
1. Log in to [Railway](https://railway.app/).
2. Click **New Project** ➔ **Deploy from GitHub repo**.
3. Select your `AIOps` repository.

### Step 2: Configure variables and start command
1. Go to your service **Settings** ➔ **Build**:
   * Set **Build Command**: `pip install -r requirements.txt && cd frontend && npm install && npm run build`
2. Go to **Settings** ➔ **Deploy**:
   * Set **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
3. Go to **Variables** tab and click **New Variable**:
   * Add `GROQ_API_KEY` = `gsk_your_key_here`
   * Add `PORT` = `8000` (Railway automatically binds this)

### Step 3: Generate a Domain
1. In Railway, navigate to the service **Settings** tab.
2. Under **Networking**, click **Generate Domain** (or set a custom domain).
3. Railway will provide a public HTTPS link (e.g. `aiops-production.up.railway.app`). Clicking this opens your app.

---

## 🖥️ Option 3: Deploy to VPS / EC2 / DigitalOcean (Ubuntu)
For full control, run it on a dedicated virtual machine.

### Step 1: Connect & Install Dependencies
SSH into your server and run:
```bash
sudo apt update && sudo apt upgrade -y
# Install Python, Node, and Nginx
sudo apt install python3-pip python3-venv nodejs npm nginx git -y
```

### Step 2: Clone & Build
```bash
git clone https://github.com/prakash200627/AIOps.git
cd AIOps

# Build the Frontend static folder
cd frontend
npm install
npm run build
cd ..

# Create Python Virtual Environment & Install packages
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Step 3: Create a Systemd Service
Create a service file to run the backend persistently in the background:
```bash
sudo nano /etc/systemd/system/aiops.service
```
Paste the following configuration:
```ini
[Unit]
Description=AIOps Self-Healing Copilot Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/AIOps
Environment="PATH=/home/ubuntu/AIOps/venv/bin"
Environment="GROQ_API_KEY=gsk_your_key_here"
ExecStart=/home/ubuntu/AIOps/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000

[Install]
WantedBy=multi-user.target
```
Enable and start the service:
```bash
sudo systemctl daemon-reload
sudo systemctl start aiops
sudo systemctl enable aiops
```

### Step 4: Configure Nginx as a Reverse Proxy
Edit the default Nginx site configuration:
```bash
sudo nano /etc/nginx/sites-available/default
```
Replace the `location /` block:
```nginx
server {
    listen 80;
    server_name your_server_ip_or_domain;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
Test and restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```
Open `http://your_server_ip` in a browser to access your live self-healing console.
