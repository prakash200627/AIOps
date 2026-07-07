import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  Shield,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  Trash2,
  Cpu,
  Terminal,
  Clock,
  Sparkles,
  ExternalLink
} from "lucide-react";

export default function App() {
  const [status, setStatus] = useState("HEALTHY");
  const [stats, setStats] = useState({ incidents_count: 0, avg_recovery_time: 0.0 });
  const [uptime, setUptime] = useState(0);
  const [incidents, setIncidents] = useState([]);
  const [logs, setLogs] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [isTriggeringCrash, setIsTriggeringCrash] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const logsContainerRef = useRef(null);
  const wsRef = useRef(null);

  // Dynamic API host resolving (works for localhost dev port 5173, backend port 8000, and deployed sites)
  const apiHost = window.location.host.includes("5173") ? "127.0.0.1:8000" : window.location.host;
  const apiProtocol = window.location.protocol;
  const wsProtocol = apiProtocol === "https:" ? "wss" : "ws";
  
  const API_BASE = `${apiProtocol}//${apiHost}`;
  const WS_BASE = `${wsProtocol}://${apiHost}`;

  // Auto-scroll logs container to bottom without scrolling the outer window
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  // Fetch initial incidents
  const fetchIncidents = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/incidents`);
      if (res.ok) {
        const data = await res.json();
        setIncidents(data);
      }
    } catch (err) {
      console.error("Error fetching incidents:", err);
    }
  };

  // Fetch live logs
  const fetchLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/logs`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Error fetching logs:", err);
    }
  };

  // Setup WebSockets and Polling
  useEffect(() => {
    fetchIncidents();
    fetchLogs();

    // Poll logs every 1s
    const logsInterval = setInterval(fetchLogs, 1000);
    // Poll incidents every 3s as fallback
    const incidentsInterval = setInterval(fetchIncidents, 3000);

    const connectWebSocket = () => {
      const socket = new WebSocket(`${WS_BASE}/api/ws`);
      wsRef.current = socket;

      socket.onopen = () => {
        setWsConnected(true);
        console.log("WebSocket connected to monitor API");
      };

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === "status") {
          setStatus(message.data.status);
          setUptime(message.data.uptime_seconds);
          setStats({
            incidents_count: message.data.incidents_count,
            avg_recovery_time: message.data.avg_recovery_time,
          });
        } else if (message.type === "incident_update") {
          // Trigger instant refresh of history when an update comes
          fetchIncidents();
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        console.log("WebSocket disconnected. Retrying in 3s...");
        setTimeout(connectWebSocket, 3000);
      };

      socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        socket.close();
      };
    };

    connectWebSocket();

    return () => {
      clearInterval(logsInterval);
      clearInterval(incidentsInterval);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  // Uptime ticking effect (only ticks up locally when service is healthy)
  useEffect(() => {
    let timer;
    if (status === "HEALTHY") {
      timer = setInterval(() => {
        setUptime((prev) => prev + 1);
      }, 1000);
    } else {
      setUptime(0);
    }
    return () => clearInterval(timer);
  }, [status]);

  // Inject failure
  const triggerCrash = async () => {
    setIsTriggeringCrash(true);
    try {
      const res = await fetch(`${API_BASE}/api/trigger-crash`, {
        method: "POST",
      });
      if (res.ok) {
        console.log("Crash successfully injected.");
      }
    } catch (err) {
      console.error("Error triggering crash:", err);
    } finally {
      // Delay disabling the loading state slightly for visuals
      setTimeout(() => setIsTriggeringCrash(false), 800);
    }
  };

  // Reset database/demo
  const resetDemo = async () => {
    if (!window.confirm("Are you sure you want to reset all incidents and statistics?")) return;
    setIsResetting(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset`, {
        method: "POST",
      });
      if (res.ok) {
        setIncidents([]);
        setStats({ incidents_count: 0, avg_recovery_time: 0.0 });
        console.log("Demo reset successfully.");
      }
    } catch (err) {
      console.error("Error resetting demo:", err);
    } finally {
      setTimeout(() => setIsResetting(false), 800);
    }
  };

  // Helper to format uptime
  const formatUptime = (seconds) => {
    if (!seconds) return "0s";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return [
      hrs > 0 ? `${hrs}h` : null,
      mins > 0 ? `${mins}m` : null,
      `${secs}s`,
    ]
      .filter(Boolean)
      .join(" ");
  };

  // Helper for logging level style mapping
  const getLogLineStyle = (line) => {
    if (line.includes("[CRITICAL]")) return "text-red-500 font-semibold";
    if (line.includes("[WARNING]")) return "text-yellow-500";
    if (line.includes("[ERROR]")) return "text-red-400";
    if (line.includes("[DEBUG]")) return "text-gray-500 text-xs";
    return "text-gray-300";
  };

  // Get current status styles and details
  const getStatusStyles = () => {
    switch (status) {
      case "HEALTHY":
        return {
          bg: "bg-emerald-950/40 border-emerald-500/30",
          text: "text-emerald-400",
          orb: "bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.7)] animate-pulse",
          label: "HEALTHY",
          desc: "Monitoring payment-gateway:8001",
        };
      case "DOWN":
        return {
          bg: "bg-rose-950/40 border-rose-500/30",
          text: "text-rose-400",
          orb: "bg-rose-500 shadow-[0_0_20px_rgba(239,68,68,0.9)] animate-ping",
          label: "DOWN",
          desc: "Connection refused. Initializing triage...",
        };
      case "DIAGNOSING":
        return {
          bg: "bg-blue-950/40 border-blue-500/30",
          text: "text-blue-400",
          orb: "bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.8)] animate-spin",
          label: "DIAGNOSING",
          desc: "Llama-3.3-70b analyzing tail logs...",
        };
      case "RECOVERING":
        return {
          bg: "bg-amber-950/40 border-amber-500/30",
          text: "text-amber-400",
          orb: "bg-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.7)] animate-pulse",
          label: "RECOVERING",
          desc: "Executing SRE restart command...",
        };
      default:
        return {
          bg: "bg-slate-900 border-slate-700",
          text: "text-slate-400",
          orb: "bg-slate-500",
          label: "UNKNOWN",
          desc: "No health state received.",
        };
    }
  };

  const currentStatus = getStatusStyles();

  return (
    <div className="min-h-screen bg-[#080b11] text-slate-100 flex flex-col font-sans select-none antialiased">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-[#0c101b] px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-lg text-white shadow-lg shadow-violet-500/10">
            <Cpu className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              AIOps Self-Healing Copilot
              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-violet-950 text-violet-400 border border-violet-800">
                Llama-3.3-70b
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-mono">Infrastructure Resiliency Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900 border border-slate-800">
            <span className="text-slate-400">Target:</span>
            <span className="text-violet-400 font-semibold">payment-gateway:8001</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-slate-900 border border-slate-800">
            <span
              className={`w-2 h-2 rounded-full ${
                wsConnected ? "bg-emerald-500 animate-pulse" : "bg-rose-500"
              }`}
            />
            <span className="text-slate-300">
              {wsConnected ? "STREAMING" : "DISCONNECTED"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid Area */}
      <main className="flex-1 p-6 max-w-[1600px] w-full mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Metric Summary Rows */}
        <section className="col-span-1 lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Live Status */}
          <div className={`border rounded-xl p-5 flex items-center justify-between transition-all duration-300 ${currentStatus.bg}`}>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">Service Status</span>
              <span className={`text-2xl font-black ${currentStatus.text}`}>{currentStatus.label}</span>
              <span className="text-xs text-slate-300 mt-1 font-mono flex items-center gap-1">
                {currentStatus.desc}
              </span>
            </div>
            <div className="flex flex-col items-center justify-center pr-3">
              <div className={`w-8 h-8 rounded-full ${currentStatus.orb}`} />
              {status === "HEALTHY" && (
                <span className="text-[10px] text-emerald-400 font-mono mt-2">
                  Uptime: {formatUptime(uptime)}
                </span>
              )}
            </div>
          </div>

          {/* Card 2: Auto-Remediations */}
          <div className="bg-[#0c101b] border border-slate-800 rounded-xl p-5 flex items-center justify-between shadow-sm">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">Incidents Remediated</span>
              <span className="text-3xl font-black text-white">{stats.incidents_count}</span>
              <span className="text-xs text-slate-500 mt-1 font-mono">100% Success Rate</span>
            </div>
            <div className="p-3 bg-violet-950/30 border border-violet-800/30 rounded-lg text-violet-400">
              <Shield className="w-6 h-6" />
            </div>
          </div>

          {/* Card 3: Recovery Time */}
          <div className="bg-[#0c101b] border border-slate-800 rounded-xl p-5 flex items-center justify-between shadow-sm">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase tracking-wider text-slate-400 font-mono">Avg Recovery Time</span>
              <span className="text-3xl font-black text-white">
                {stats.avg_recovery_time > 0 ? `${stats.avg_recovery_time}s` : "N/A"}
              </span>
              <span className="text-xs text-slate-500 mt-1 font-mono">Sub-10s Auto-Heal Goal</span>
            </div>
            <div className="p-3 bg-indigo-950/30 border border-indigo-800/30 rounded-lg text-indigo-400">
              <Clock className="w-6 h-6" />
            </div>
          </div>
        </section>

        {/* Column Left & Middle: Incident Timeline (2/3 width) */}
        <section className="lg:col-span-2 flex flex-col bg-[#0c101b] border border-slate-800 rounded-xl shadow-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 bg-[#0f1424] flex items-center justify-between">
            <h2 className="font-semibold text-white tracking-wide flex items-center gap-2">
              <Activity className="w-4 h-4 text-violet-400" />
              Autonomous Incident Timeline
            </h2>
            <span className="text-xs font-mono text-slate-400">SQLite Log Registry</span>
          </div>

          <div className="flex-1 p-6 overflow-y-auto space-y-6 max-h-[560px]">
            {incidents.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16 gap-3">
                <CheckCircle2 className="w-12 h-12 text-slate-600 animate-pulse" />
                <div className="text-center">
                  <p className="font-semibold text-slate-400">All systems operational</p>
                  <p className="text-xs text-slate-500 mt-1">No incidents recorded. Try triggering a crash!</p>
                </div>
              </div>
            ) : (
              <div className="relative border-l-2 border-slate-800 ml-4 pl-8 space-y-8">
                {incidents.map((incident) => {
                  const isActive = ["DOWN", "DIAGNOSING", "RECOVERING"].includes(incident.status);
                  
                  return (
                    <div key={incident.id} className="relative group">
                      {/* Left Timeline Indicator Bullet */}
                      <span className="absolute -left-[41px] top-1.5 flex items-center justify-center">
                        {incident.status === "RESOLVED" ? (
                          <div className="w-6 h-6 rounded-full bg-emerald-950 border border-emerald-500 flex items-center justify-center text-emerald-400 shadow-md">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </div>
                        ) : incident.status === "DOWN" ? (
                          <div className="w-6 h-6 rounded-full bg-rose-950 border border-rose-500 flex items-center justify-center text-rose-400 animate-ping">
                            <AlertTriangle className="w-3 h-3" />
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-full bg-amber-950 border border-amber-500 flex items-center justify-center text-amber-400 animate-spin">
                            <RefreshCw className="w-3 h-3" />
                          </div>
                        )}
                      </span>

                      {/* Incident Card Body */}
                      <div className={`border rounded-xl p-5 transition-all duration-300 ${
                        isActive
                          ? "bg-slate-900/60 border-violet-500/40 shadow-[0_0_15px_rgba(139,92,246,0.08)]"
                          : "bg-slate-950/20 border-slate-800 hover:border-slate-700"
                      }`}>
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-xs text-slate-400">
                              {incident.timestamp}
                            </span>
                            <span className="text-[10px] text-slate-600 font-mono">
                              ID: #{incident.id}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            {/* Remediation Action Badge */}
                            {incident.action !== "PENDING" && (
                              <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-900/50">
                                Action: {incident.action}
                              </span>
                            )}
                            
                            {/* Recovery Status Badge */}
                            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded border ${
                              incident.status === "RESOLVED"
                                ? "bg-emerald-950/60 text-emerald-400 border-emerald-800/50"
                                : incident.status === "DOWN"
                                ? "bg-rose-950/60 text-rose-400 border-rose-800/50"
                                : incident.status === "DIAGNOSING"
                                ? "bg-blue-950/60 text-blue-400 border-blue-800/50"
                                : "bg-amber-950/60 text-amber-400 border-amber-800/50"
                            }`}>
                              {incident.status}
                            </span>
                          </div>
                        </div>

                        {/* LLM Diagnosis Bubble */}
                        <div className="flex gap-3 bg-[#080c14] border border-slate-800/80 rounded-lg p-3.5 font-mono text-sm leading-relaxed">
                          <div className="p-1.5 self-start bg-slate-900 rounded border border-slate-800 text-violet-400">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex-1">
                            <div className="text-[10px] font-sans text-slate-500 uppercase tracking-wide mb-0.5">
                              LLM Copilot Root Cause Diagnosis
                            </div>
                            <p className="text-slate-300">
                              {incident.diagnosis}
                            </p>
                          </div>
                        </div>

                        {/* Duration or Info footer */}
                        <div className="mt-3 flex items-center justify-between text-xs text-slate-500 font-mono">
                          <span>Target Node: payment-gateway-replica-0</span>
                          {incident.status === "RESOLVED" ? (
                            <span className="text-emerald-400 flex items-center gap-1 font-semibold">
                              Healed in {incident.duration_seconds} seconds
                            </span>
                          ) : (
                            <span className="text-amber-400 animate-pulse flex items-center gap-1.5">
                              <RefreshCw className="w-3 h-3 animate-spin" />
                              Auto-healing in progress...
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Column Right: Controls & Live Logs Terminal (1/3 width) */}
        <section className="flex flex-col gap-6 col-span-1">
          
          {/* Simulation panel */}
          <div className="bg-[#0c101b] border border-slate-800 rounded-xl shadow-lg p-5 flex flex-col gap-4">
            <h2 className="font-semibold text-white tracking-wide flex items-center gap-2">
              <Shield className="w-4 h-4 text-violet-400" />
              SRE Simulation Controls
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed font-mono">
              Use these buttons to inject system crashes or reset the demo logs during the live pitch.
            </p>

            <div className="flex flex-col gap-3 mt-1">
              <button
                onClick={triggerCrash}
                disabled={status !== "HEALTHY" || isTriggeringCrash}
                className={`w-full py-3 px-4 rounded-lg font-semibold flex items-center justify-center gap-2 border transition-all duration-200 cursor-pointer text-sm shadow-md ${
                  status !== "HEALTHY"
                    ? "bg-slate-900 border-slate-800 text-slate-500 cursor-not-allowed"
                    : "bg-rose-600/90 border-rose-500 text-white hover:bg-rose-500 shadow-rose-900/10 active:translate-y-[1px]"
                }`}
              >
                <AlertTriangle className="w-4 h-4" />
                {isTriggeringCrash ? "Injecting Fault..." : "Inject Service Crash"}
              </button>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={resetDemo}
                  disabled={isResetting}
                  className="py-2.5 px-3 rounded-lg font-semibold text-xs border bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800/80 active:translate-y-[1px] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {isResetting ? "Resetting..." : "Reset History"}
                </button>

                <a
                  href="http://127.0.0.1:8001/api/payments"
                  target="_blank"
                  rel="noreferrer"
                  className="py-2.5 px-3 rounded-lg font-semibold text-xs border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800/80 active:translate-y-[1px] transition-all flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  Inspect API
                </a>
              </div>
            </div>
          </div>

          {/* Live scrolling logs terminal */}
          <div className="bg-[#0c101b] border border-slate-800 rounded-xl shadow-lg flex-1 flex flex-col overflow-hidden min-h-[350px]">
            <div className="px-4 py-3 border-b border-slate-800 bg-[#0f1424] flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wider font-mono flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-slate-400" />
                Stdout Console: payment-gateway
              </h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-500">
                tail -f victim.log
              </span>
            </div>

            {/* Terminal Body */}
            <div 
              ref={logsContainerRef}
              className="flex-1 bg-[#05070c] p-4 font-mono text-[11px] leading-relaxed overflow-y-auto max-h-[380px] scrollbar-thin select-text"
            >
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 animate-pulse">
                  Listening for microservice log stream...
                </div>
              ) : (
                <div className="space-y-1">
                  {logs.map((line, index) => (
                    <div key={index} className={getLogLineStyle(line)}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

      </main>

      {/* Visual Footer */}
      <footer className="border-t border-slate-850 px-6 py-4 bg-[#06080e] flex flex-wrap items-center justify-between text-xs text-slate-500 gap-4">
        <div className="font-mono">
          <span>Build: Hackathon MVP v1.0.0</span>
          <span className="mx-2">•</span>
          <span>Self-Healing Loop: 2.0s check interval</span>
        </div>
        <div className="flex gap-4">
          <a
            href="https://groq.com/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-slate-300 transition-colors"
          >
            Powered by Groq LLM API
          </a>
          <span>•</span>
          <span className="text-violet-500 font-semibold">FastAPI + React + Tailwind</span>
        </div>
      </footer>
    </div>
  );
}
