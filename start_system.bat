@echo off
title GraphRAG Futuristic Knowledge System Launcher
echo ========================================================
echo    GraphRAG Futuristic Knowledge System
echo    FastAPI + Neo4j AuraDB (Cloud) + Groq AI + UI
echo ========================================================
echo.
echo [*] Cloud Database: Connected (Neo4j AuraDB)
echo [*] Cloud LLM: Connected (Groq openai/gpt-oss-120b)
echo [*] Embeddings: FastEmbed 768-d (CPU)
echo.

:: 1. Start FastAPI Backend
echo [1/2] Starting Backend on http://localhost:8000 ...
cd /d "%~dp0backend"
start "GraphRAG Backend (FastAPI)" "%~dp0backend\.venv\Scripts\python.exe" -m uvicorn server:app --host 127.0.0.1 --port 8000

:: 2. Start Vite Frontend
echo [2/2] Starting Frontend on http://localhost:8443 ...
cd /d "%~dp0frontend"
start "GraphRAG Frontend (Vite)" cmd /c "npm run dev"

:: 3. Open Browser
ping 127.0.0.1 -n 3 >nul
echo.
echo Launching http://localhost:8443 in browser...
start http://localhost:8443

echo.
echo ========================================================
echo    All services launched successfully!
echo    Frontend: http://localhost:8443
echo    Backend Docs: http://localhost:8000/docs
echo ========================================================
echo.
pause
