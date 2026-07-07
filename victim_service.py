import os
import sys
import time
import logging
import asyncio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Setup Logging to stdout and victim.log
logger = logging.getLogger("victim_service")
logger.setLevel(logging.DEBUG)

formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] - %(message)s", datefmt="%Y-%m-%d %H:%M:%S")

# Stream handler for console
sh = logging.StreamHandler(sys.stdout)
sh.setFormatter(formatter)
logger.addHandler(sh)

# File handler for log tailing by monitor
fh = logging.FileHandler("victim.log", mode="a")
fh.setFormatter(formatter)
logger.addHandler(fh)

app = FastAPI(title="Payment Gateway Microservice")

# Enable CORS for frontend and backend interactions
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PaymentRequest(BaseModel):
    amount: float
    card_number: str

@app.on_event("startup")
async def startup_event():
    global start_time
    start_time = time.time()
    logger.info("Payment Gateway Service starting up on port 8001...")
    logger.info("Initializing database connections...")
    await asyncio.sleep(0.5)
    logger.info("Database connections established successfully.")
    logger.info("Connecting to cache server cluster...")
    await asyncio.sleep(0.2)
    logger.info("Cache connected. Ready to process transaction traffic.")

@app.get("/health")
async def health():
    logger.debug("Received health check probe.")
    uptime = int(time.time() - start_time) if 'start_time' in globals() else 0
    return {
        "status": "healthy",
        "service": "payment-gateway",
        "uptime_seconds": uptime,
        "db_connection": "connected",
        "cache_connection": "connected"
    }

@app.get("/api/payments")
async def payments_list():
    logger.info("GET /api/payments - Retrieving transaction history.")
    return {
        "transactions": [
            {"id": "tx_1001", "amount": 150.00, "status": "SETTLED", "timestamp": time.time() - 3600},
            {"id": "tx_1002", "amount": 42.50, "status": "SETTLED", "timestamp": time.time() - 1800},
            {"id": "tx_1003", "amount": 890.99, "status": "PENDING", "timestamp": time.time() - 600},
        ]
    }

@app.post("/api/payments")
async def create_payment(payment: PaymentRequest):
    logger.info(f"POST /api/payments - Processing card transaction for {payment.amount} USD.")
    if payment.amount <= 0:
        logger.warning(f"Invalid transaction amount: {payment.amount}")
        return {"status": "failed", "reason": "invalid_amount"}
    
    logger.info(f"Routing payment to bank acquirer...")
    await asyncio.sleep(0.3)
    logger.info(f"Payment tx_1004 authorized successfully.")
    return {"status": "success", "tx_id": "tx_1004", "amount": payment.amount}

@app.get("/crash")
async def crash():
    logger.critical("CRITICAL: Received system crash signal on /crash endpoint.")
    logger.critical("CRITICAL: Initiating immediate process termination.")
    
    # Schedule a task to kill the process after returning the HTTP response
    async def terminate():
        await asyncio.sleep(0.1)
        logger.critical("CRITICAL: Process exiting now (Exit code 1).")
        os._exit(1)
        
    asyncio.create_task(terminate())
    
    return {
        "status": "crashing",
        "message": "Crash signal received. Process terminating in 100ms."
    }

if __name__ == "__main__":
    import uvicorn
    start_time = time.time()
    logger.info("Launching Uvicorn server...")
    uvicorn.run("victim_service:app", host="127.0.0.1", port=8001, log_level="warning")
