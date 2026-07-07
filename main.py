import os
import sys
import time
import json
import sqlite3
import asyncio
import logging
import subprocess
from datetime import datetime
from typing import List, Optional
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

# Setup Logging for backend monitor
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("monitor_backend")

app = FastAPI(title="AIOps Self-Healing Copilot Backend")

# Enable CORS for React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- DB SETUP -----------------
DB_FILE = "incidents.db"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS incidents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            status TEXT,
            diagnosis TEXT,
            action TEXT,
            duration_seconds REAL,
            resolved INTEGER
        )
    """)
    conn.commit()
    conn.close()

init_db()

# ----------------- STATE MANAGEMENT -----------------
# Status can be: HEALTHY, DOWN, DIAGNOSING, RECOVERING
system_state = {
    "status": "HEALTHY",
    "uptime_start": time.time(),
    "incidents_count": 0,
    "avg_recovery_time": 0.0,
    "total_recovery_time": 0.0
}

victim_process: Optional[subprocess.Popen] = None
active_websockets: List[WebSocket] = []
consecutive_failures = 0
current_incident_id = None
incident_start_time = None

# Recalculate stats from the database on startup and recovery
def update_statistics():
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    
    # Total count
    cursor.execute("SELECT COUNT(*) FROM incidents")
    system_state["incidents_count"] = cursor.fetchone()[0]
    
    # Average recovery time
    cursor.execute("SELECT AVG(duration_seconds) FROM incidents WHERE resolved = 1 AND duration_seconds > 0")
    avg = cursor.fetchone()[0]
    system_state["avg_recovery_time"] = round(avg, 2) if avg is not None else 0.0
    
    conn.close()

update_statistics()

# ----------------- PROCESS MANAGER -----------------
def start_victim():
    global victim_process
    logger.info("Starting victim service (Payment Gateway) as a subprocess...")
    # Open victim.log in append mode. Both stdout and stderr go to the log file.
    log_file = open("victim.log", "a", encoding="utf-8")
    
    # Launch victim_service.py using the current python executable
    victim_process = subprocess.Popen(
        [sys.executable, "victim_service.py"],
        stdout=log_file,
        stderr=log_file
    )
    logger.info(f"Victim service started with PID: {victim_process.pid}")

def stop_victim():
    global victim_process
    if victim_process:
        logger.info(f"Stopping victim service subprocess with PID: {victim_process.pid}...")
        try:
            victim_process.terminate()
            victim_process.wait(timeout=3.0)
        except subprocess.TimeoutExpired:
            logger.warning("Subprocess failed to terminate gracefully. Force killing...")
            victim_process.kill()
        except Exception as e:
            logger.error(f"Error terminating victim process: {e}")
        finally:
            victim_process = None
            logger.info("Victim service subprocess stopped.")

# ----------------- WEBSOCKET BROADCAST -----------------
async def broadcast_status():
    payload = {
        "type": "status",
        "data": {
            "status": system_state["status"],
            "uptime_seconds": int(time.time() - system_state["uptime_start"]) if system_state["status"] == "HEALTHY" else 0,
            "incidents_count": system_state["incidents_count"],
            "avg_recovery_time": system_state["avg_recovery_time"]
        }
    }
    
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            disconnected.append(ws)
            
    for ws in disconnected:
        if ws in active_websockets:
            active_websockets.remove(ws)

async def broadcast_incident(incident):
    payload = {
        "type": "incident_update",
        "data": incident
    }
    disconnected = []
    for ws in active_websockets:
        try:
            await ws.send_text(json.dumps(payload))
        except Exception:
            disconnected.append(ws)
            
    for ws in disconnected:
        if ws in active_websockets:
            active_websockets.remove(ws)

# ----------------- COGNITIVE DIAGNOSIS (GROQ LLM) -----------------
def tail_log_file(filename: str, num_lines: int = 30) -> str:
    if not os.path.exists(filename):
        return "[No logs found yet]"
    try:
        with open(filename, "r", encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
            return "".join(lines[-num_lines:])
    except Exception as e:
        return f"[Error reading logs: {e}]"

async def call_groq_diagnosis(logs: str) -> dict:
    if not GROQ_API_KEY:
        logger.warning("GROQ_API_KEY environment variable not found. Using local heuristic fallback...")
        return get_mock_diagnosis(logs)
        
    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    prompt = f"""You are an expert AIOps Site Reliability Engineer (SRE).
The target microservice 'payment-gateway' on port 8001 has failed its health check (Connection Refused / Down).
Here are the recent log messages from the microservice log file:
---
{logs}
---

Please diagnose the likely cause of the failure based on the log messages.
Respond in JSON format with exactly two keys:
1. "diagnosis": A 1-2 sentence concise explanation of why the service crashed or failed. Be specific about what you see in the logs.
2. "action": The remediation action. This MUST be one of: "RESTART", "ROLLBACK", or "SCALE". For this crash, it should be "RESTART".

Respond ONLY with valid JSON. Do not include any markdown syntax or introductory text.
"""
    
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                url,
                headers=headers,
                json={
                    "model": GROQ_MODEL,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"}
                },
                timeout=12.0
            )
            
            if response.status_code == 200:
                result = json.loads(response.json()["choices"][0]["message"]["content"])
                return {
                    "diagnosis": result.get("diagnosis", "Critical process crashed. Unhandled termination signal."),
                    "action": result.get("action", "RESTART")
                }
            else:
                logger.error(f"Groq API returned error {response.status_code}: {response.text}")
                return get_mock_diagnosis(logs)
    except Exception as e:
        logger.error(f"Exception during Groq API call: {e}")
        return get_mock_diagnosis(logs)

def get_mock_diagnosis(logs: str) -> dict:
    # Heuristics for realistic feedback in offline/fallback mode
    if "Manual override" in logs or "/crash" in logs or "CRITICAL: Received system crash signal" in logs:
        return {
            "diagnosis": "Critical Failure: Manual crash override triggered via GET /crash endpoint. System exited with status code 1.",
            "action": "RESTART"
        }
    return {
        "diagnosis": "Process crash detected. Service terminated unexpectedly with connection refused on port 8001.",
        "action": "RESTART"
    }

# ----------------- REMEDIATION BACKGROUND TASK -----------------
async def run_remediation(incident_id: int):
    global system_state, consecutive_failures
    
    # 1. Start Diagnosis
    logger.info(f"Remediation started for incident {incident_id}. State: DIAGNOSING...")
    system_state["status"] = "DIAGNOSING"
    await broadcast_status()
    
    # Update DB status
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("UPDATE incidents SET status = 'DIAGNOSING' WHERE id = ?", (incident_id,))
    conn.commit()
    conn.close()
    
    # Simulating diagnostic latency for visual effect
    await asyncio.sleep(2.0)
    
    # Grab victim logs
    logs = tail_log_file("victim.log", 30)
    
    # Call Groq LLM
    result = await call_groq_diagnosis(logs)
    diagnosis = result["diagnosis"]
    action = result["action"]
    
    logger.info(f"Diagnosis completed: {diagnosis} | Recommended Action: {action}")
    
    # 2. Start Recovery
    system_state["status"] = "RECOVERING"
    await broadcast_status()
    
    # Update DB with diagnosis & action
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE incidents SET status = 'RECOVERING', diagnosis = ?, action = ? WHERE id = ?",
        (diagnosis, action, incident_id)
    )
    conn.commit()
    conn.close()
    
    # Broadcast incident update to frontend
    incident_update = {
        "id": incident_id,
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "status": "RECOVERING",
        "diagnosis": diagnosis,
        "action": action,
        "duration_seconds": 0,
        "resolved": 0
    }
    await broadcast_incident(incident_update)
    
    # Simulating execution latency
    await asyncio.sleep(1.5)
    
    # Execute Action
    if action == "RESTART":
        logger.info("Executing recovery command: Restarting victim process...")
        stop_victim()
        await asyncio.sleep(0.5)
        start_victim()
    else:
        # Fallback to restart just in case LLM goes creative
        logger.warning(f"Unsupported action '{action}' recommended. Defaulting to RESTART.")
        stop_victim()
        await asyncio.sleep(0.5)
        start_victim()

# ----------------- MONITORING LOOP -----------------
async def monitor_loop():
    global system_state, consecutive_failures, current_incident_id, incident_start_time
    
    logger.info("Starting background infrastructure monitoring loop...")
    await asyncio.sleep(2.0)  # Wait for startup phase
    
    while True:
        try:
            # Poll target service
            async with httpx.AsyncClient() as client:
                response = await client.get("http://127.0.0.1:8001/health", timeout=1.0)
                
            if response.status_code == 200:
                # Service is healthy
                if system_state["status"] in ["DOWN", "DIAGNOSING", "RECOVERING"]:
                    # Just healed!
                    recovery_time = round(time.time() - incident_start_time, 2)
                    logger.info(f"Service recovery verified! Uptime restored. Duration: {recovery_time}s")
                    
                    system_state["status"] = "HEALTHY"
                    system_state["uptime_start"] = time.time()
                    consecutive_failures = 0
                    
                    # Update DB record to RESOLVED
                    conn = sqlite3.connect(DB_FILE)
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE incidents SET status = 'RESOLVED', duration_seconds = ?, resolved = 1 WHERE id = ?",
                        (recovery_time, current_incident_id)
                    )
                    conn.commit()
                    conn.close()
                    
                    update_statistics()
                    await broadcast_status()
                    
                    # Fetch fully populated incident row to broadcast
                    conn = sqlite3.connect(DB_FILE)
                    conn.row_factory = sqlite3.Row
                    cursor = conn.cursor()
                    cursor.execute("SELECT * FROM incidents WHERE id = ?", (current_incident_id,))
                    row = cursor.fetchone()
                    conn.close()
                    
                    if row:
                        await broadcast_incident(dict(row))
                        
                    current_incident_id = None
                    incident_start_time = None
                else:
                    # Normal healthy cycle
                    consecutive_failures = 0
                    # Regularly broadcast status to keep uptime ticking
                    await broadcast_status()
                    
            else:
                raise Exception(f"Bad status code: {response.status_code}")
                
        except Exception:
            # Failure detected!
            if system_state["status"] == "HEALTHY":
                consecutive_failures += 1
                logger.warning(f"Health check failed. Consecutive failures: {consecutive_failures}/1")
                
                if consecutive_failures >= 1:
                    # First failure triggers incident lifecycle
                    logger.critical("Microservice DOWN! Initiating AIOps Incident response...")
                    system_state["status"] = "DOWN"
                    incident_start_time = time.time()
                    
                    # Log incident in SQLite
                    conn = sqlite3.connect(DB_FILE)
                    cursor = conn.cursor()
                    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                    cursor.execute(
                        "INSERT INTO incidents (timestamp, status, diagnosis, action, duration_seconds, resolved) VALUES (?, ?, ?, ?, ?, ?)",
                        (now_str, "DOWN", "Initiating SRE diagnosis...", "PENDING", 0.0, 0)
                    )
                    current_incident_id = cursor.lastrowid
                    conn.commit()
                    conn.close()
                    
                    await broadcast_status()
                    
                    # Trigger remediation in the background
                    asyncio.create_task(run_remediation(current_incident_id))
            else:
                # Already in healing state (DOWN/DIAGNOSING/RECOVERING), do nothing
                pass
                
        await asyncio.sleep(2.0)

# ----------------- LIFECYCLE -----------------
monitor_task = None

@app.on_event("startup")
async def startup_event():
    global monitor_task
    # Start target service
    start_victim()
    # Run the background monitor
    monitor_task = asyncio.create_task(monitor_loop())

@app.on_event("shutdown")
async def shutdown_event():
    global monitor_task
    if monitor_task:
        monitor_task.cancel()
    # Kill the target service
    stop_victim()

# ----------------- API ENDPOINTS -----------------
@app.get("/api/status")
async def get_status():
    return {
        "status": system_state["status"],
        "uptime_seconds": int(time.time() - system_state["uptime_start"]) if system_state["status"] == "HEALTHY" else 0,
        "statistics": {
            "incidents_count": system_state["incidents_count"],
            "avg_recovery_time": system_state["avg_recovery_time"]
        }
    }

@app.get("/api/incidents")
async def get_incidents():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM incidents ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.get("/api/logs")
async def get_logs():
    logs = tail_log_file("victim.log", 40)
    return {"logs": logs.splitlines()}

@app.post("/api/trigger-crash")
async def trigger_crash():
    logger.info("External crash trigger requested. Forwarding crash signal to victim...")
    try:
        async with httpx.AsyncClient() as client:
            # Call victim's crash endpoint
            response = await client.get("http://127.0.0.1:8001/crash", timeout=2.0)
            return response.json()
    except Exception as e:
        logger.warning(f"Error calling /crash directly (maybe process already dead?): {e}")
        # If calling endpoint fails, kill it directly to guarantee the crash state
        stop_victim()
        return {"status": "crashing", "message": "Service process killed directly."}

@app.post("/api/reset")
async def reset_demo():
    global system_state, consecutive_failures, current_incident_id, incident_start_time
    logger.info("Resetting incident history database for demo reset...")
    
    # Stop and start victim to make sure it's clean
    stop_victim()
    await asyncio.sleep(0.5)
    start_victim()
    
    # Reset DB
    conn = sqlite3.connect(DB_FILE)
    cursor = conn.cursor()
    cursor.execute("DELETE FROM incidents")
    conn.commit()
    conn.close()
    
    # Reset in-memory state
    system_state["status"] = "HEALTHY"
    system_state["uptime_start"] = time.time()
    system_state["incidents_count"] = 0
    system_state["avg_recovery_time"] = 0.0
    system_state["total_recovery_time"] = 0.0
    consecutive_failures = 0
    current_incident_id = None
    incident_start_time = None
    
    await broadcast_status()
    return {"status": "reset_successful"}

@app.websocket("/api/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_websockets.append(websocket)
    logger.info(f"WebSocket client connected. Total clients: {len(active_websockets)}")
    try:
        # Send initial status
        await websocket.send_text(json.dumps({
            "type": "status",
            "data": {
                "status": system_state["status"],
                "uptime_seconds": int(time.time() - system_state["uptime_start"]) if system_state["status"] == "HEALTHY" else 0,
                "incidents_count": system_state["incidents_count"],
                "avg_recovery_time": system_state["avg_recovery_time"]
            }
        }))
        # Keep connection open
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected.")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        if websocket in active_websockets:
            active_websockets.remove(websocket)
            logger.info(f"WebSocket removed. Total clients: {len(active_websockets)}")

# Serve static frontend files if built in production mode
if os.path.exists("frontend/dist"):
    logger.info("Serving frontend build from frontend/dist")
    app.mount("/", StaticFiles(directory="frontend/dist", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="info")
