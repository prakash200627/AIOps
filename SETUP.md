# AIOps Self-Healing Copilot - Setup Guide

This guide details the steps to launch and demo the AIOps Self-Healing Copilot.

## 🛠 Prerequisites

Ensure you have the following installed on your machine:
- **Python 3.8+**
- **Node.js 18+** & **npm**

---

## 🚀 Setup Instructions

### 1. Backend Setup & Configuration

1. Install the required Python packages:
   ```bash
   pip install -r requirements.txt
   ```

2. *(Optional)* Configure the Groq LLM:
   If you have a Groq API key, copy the template and configure it in `.env`:
   ```bash
   # Copy template
   cp .env.example .env
   ```
   Open the `.env` file and set your key:
   ```env
   GROQ_API_KEY=gsk_YourActualGroqApiKey
   ```
   *Note: If no API key is specified, the application will automatically fall back to a high-fidelity local SRE heuristic analyzer, so the demo works completely out of the box even without an API key.*

### 2. Frontend Setup

1. Navigate to the `frontend` folder:
   ```bash
   cd frontend
   ```

2. Install npm dependencies:
   ```bash
   npm install
   ```

---

## 🏃 Run Instructions

Start the services in the following order:

### Step 1: Start the Backend Monitor

The backend monitor handles starting, stopping, log tailing, and healing of the victim microservice.

Run the following command in the **root project directory**:
```bash
python main.py
```
*The victim service will automatically spawn as a subprocess on port `8001` and create a `victim.log` file.*

### Step 2: Start the Frontend Dashboard

Run the following command inside the **`frontend` directory**:
```bash
npm run dev
```
*Typically, this will spin up the dashboard interface on [http://localhost:5173](http://localhost:5173).*

---

## 📺 Demo Walkthrough (5-Minute Video Guide)

Use this script/flow for your hackathon submission video:

1. **Dashboard Overview**:
   - Open the browser to [http://localhost:5173](http://localhost:5173).
   - Point out the **dark Grafana-style ops layout**.
   - Note the **System Health Status** card (Green, HEALTHY) showing real-time uptime counting.
   - Point out the **Live Monitor Console** displaying stdout logs from the payment gateway microservice.

2. **Trigger Crash**:
   - Click the red **"Inject Service Crash"** button.
   - Watch the backend console register the `/crash` request. The victim service logs its exit code and goes down.

3. **Autonomous Self-Healing Loop**:
   - The Health Status transitions to **DOWN** (Red pulse) within 2 seconds.
   - It transitions immediately to **DIAGNOSING** (Blue glow). The backend tails the last 30 lines of `victim.log` and feeds it to the LLM.
   - The LLM parses the logs, detects the manual crash override, diagnoses the root cause, and recommends a `RESTART` action.
   - The Health Status transitions to **RECOVERING** (Yellow pulse) while the backend kills the dead process and spawns a new subprocess.
   - Within seconds, the status transitions back to **HEALTHY** (Green) as the health probes succeed.

4. **Review Results**:
   - Show the **Autonomous Incident Timeline** card. A new log row appears displaying:
     - The precise timestamp and incident ID.
     - The **LLM Copilot Root Cause Diagnosis**: *"...Manual crash override triggered via GET /crash endpoint..."*
     - The action taken (`RESTART`).
     - The recovery duration (typically around 4.2 seconds).
   - Point out that the metrics at the top have auto-updated (resolved incident count = `1`, avg recovery time = `4s`).

5. **Reset Demo**:
   - Click **"Reset History"** in the controls to wipe the SQLite database and start the demo fresh.

---

## ☁️ Single-Instance Production Deployment (Railway, Render, EC2)

To deploy the entire application (frontend and backend) to a single hosting instance:

1. **Build the Frontend**:
   Inside the `frontend` folder, run the production compiler:
   ```bash
   cd frontend
   npm run build
   ```
   *This compiles the React application into static assets located in `frontend/dist`.*

2. **Serve from FastAPI**:
   When you start the backend from the root directory:
   ```bash
   python main.py
   ```
   FastAPI will automatically detect the `frontend/dist` directory and serve the compiled React dashboard at `http://your-server-ip:8000/`. All API calls and WebSocket connections will resolve dynamically to your server's host.

3. **Railway/Render Deployment Configuration**:
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Environment Variables**: Configure `GROQ_API_KEY` in the hosting control panel.
