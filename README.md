# AIOps Self-Healing Copilot 🧠🩹

A minimal, high-fidelity demo of an **AIOps Self-Healing Copilot** built for the hackathon submission round. This application monitors a payment gateway microservice, detects sudden crashes, diagnoses the root cause using the Llama-3.3-70b model on Groq, and automatically executes remediation actions (restarting processes) while showing its reasoning live on a Grafana-style dark ops dashboard.

---

## 🏛 Architecture Overview

Below is the simple but realistic flow of monitoring and self-healing:

```mermaid
graph TD
    subgraph Control Plane (main.py)
        Monitor[Monitor Loop] -->|Polls /health every 2s| Victim[Payment Gateway Subprocess]
        Monitor -->|Detects connection failure| Triage[Triage Phase]
        Triage -->|Reads last 30 lines| Logs[(victim.log)]
        Triage -->|Sends logs + context| LLM[Groq Llama-3.3-70b]
        LLM -->|Returns diagnosis + action| Recovery[Recovery Phase]
        Recovery -->|Executes action: RESTART| ProcessManager[Subprocess Manager]
        ProcessManager -->|Kills old & starts new process| Victim
        Monitor -->|Verifies recovery / health 200| SQLite[(incidents.db)]
    end
    
    subgraph Frontend (Vite + React + Tailwind)
        Dashboard[Ops Dashboard] <-->|WebSockets / live updates| Monitor
        Dashboard -->|Triggers Manual Crash| Monitor
    end
```

---

## 🛠 Tech Stack

- **Target Service ("Victim")**: FastAPI app running on port `8001`, simulating a financial Payment Gateway. It includes a `/health` endpoint, business transaction endpoints, and a hidden `/crash` endpoint to simulate failure.
- **Backend Monitor**: FastAPI app running on port `8000`. Handles process management, tail log parsing, SQLite recording, WebSocket broadcasts, and Groq API calls.
- **LLM Engine**: Groq API (`llama-3.3-70b-versatile`) for instant root-cause analysis based on tail logs. Includes an offline heuristic SRE fallback.
- **Frontend Dashboard**: Vite + React + Tailwind CSS (v4) single page dashboard. Employs monospace logs terminals, live status pulse lights, and a visual event timeline.
- **Database**: SQLite (`incidents.db`) for tracking persistent incident histories and recovery statistics.

---

## ✨ Features Implemented

1. **Autonomous Loop**: Complete closed-loop control (Detect ➔ Diagnose ➔ Remediate ➔ Verify) running in the background.
2. **LLM Root-Cause Analysis**: Sends target service logs directly to Llama-3.3-70b to generate human-readable explanations (e.g., distinguishing between a manual exit and normal startup logs).
3. **Live Log Streaming**: The React frontend pulls logs dynamically from the target service file, creating a realistic scrolling terminal on screen.
4. **WebSocket Updates**: Real-time status shifts (Healthy ➔ Down ➔ Diagnosing ➔ Recovering ➔ Healthy) and immediate timeline appending.
5. **Fail-Safe Fallback**: Includes offline/no-key mock heuristics so the demo runs perfectly under any network condition.
6. **Demo controls**: Buttons to quickly inject a crash or wipe incident history in one click.

---

## 📂 Project Structure

```
AIOps/
├── frontend/               # React (Vite) + Tailwind CSS Dashboard
│   ├── src/
│   │   ├── App.jsx         # Dashboard frontend component
│   │   ├── index.css       # Tailwind entry and utility styles
│   │   └── main.jsx        # App entry point
│   ├── index.html          # HTML template
│   └── vite.config.js      # Vite dev configuration
├── main.py                 # Core Monitor backend & Process manager (Port 8000)
├── victim_service.py       # Payment Gateway mock service (Port 8001)
├── requirements.txt        # Backend dependencies
├── .env.example            # Environment variables template
├── SETUP.md                # Quickstart and demo walkthrough instructions
└── README.md               # Project documentation
```

For quick setup and run instructions, please refer to [SETUP.md](file:///C:/Users/prakash/Downloads/all-projects/AIOps/SETUP.md).
