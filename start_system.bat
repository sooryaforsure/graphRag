@echo off
title GraphRAG Futuristic Knowledge System Launcher
echo ========================================================
echo    GraphRAG Futuristic Knowledge System
echo    FastAPI + Neo4j + Ollama (llama3.2) + Futuristic UI
echo ========================================================
echo.

:: 0. Check Ollama
echo [1/4] Checking Ollama AI engine...
tasklist /fi "imagename eq ollama.exe" 2>nul | findstr /i "ollama.exe" >nul
if %errorlevel% neq 0 (
    echo [!] Ollama is not running. Starting Ollama in background...
    start /min "Ollama Engine" ollama serve
    timeout /t 2 >nul
) else (
    echo [OK] Ollama is running.
)

:: 1. Check Docker Desktop & Engine
echo.
echo [2/4] Checking Docker Engine...
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Docker Desktop is not running.
    echo [*] Attempting to start Docker Desktop...
    if exist "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe" (
        start "" "%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe"
    ) else if exist "C:\Program Files\Docker\Docker\Docker Desktop.exe" (
        start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
    )
    echo [*] Waiting for Docker engine to start up. Please wait...
)

:check_docker_loop
docker info >nul 2>&1
if %errorlevel% equ 0 goto docker_ready
echo     Waiting for Docker Desktop daemon to initialize...
timeout /t 5 >nul
goto check_docker_loop

:docker_ready
echo [OK] Docker Engine is ready!

:: 2. Check / Start Neo4j container
echo.
echo [*] Checking Neo4j container...
docker ps | findstr /i "neo4j" >nul
if %errorlevel% neq 0 (
    echo [!] Starting Neo4j container via docker compose...
    cd /d "%~dp0graphRAG_Knowledge_System"
    docker compose up -d neo4j
) else (
    echo [OK] Neo4j container is already running.
)

:: 3. Start FastAPI Backend
echo.
echo [3/4] Starting FastAPI Backend on http://localhost:8000 ...
cd /d "%~dp0graphRAG_Knowledge_System"
start "GraphRAG Backend (FastAPI)" cmd /k ".venv\Scripts\python.exe -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload"

:: 4. Start Vite Frontend
echo.
echo [4/4] Starting Futuristic Frontend on http://localhost:8443 ...
cd /d "%~dp0Design Futuristic Knowledge System"
start "GraphRAG Frontend (Vite)" cmd /k "npm run dev"

:: Open Browser
timeout /t 3 >nul
echo.
echo Launching browser to http://localhost:8443 ...
start http://localhost:8443

echo.
echo ========================================================
echo   All services launched successfully!
echo   Frontend: http://localhost:8443
echo   Backend Docs: http://localhost:8000/docs
echo   Neo4j Browser: http://localhost:7474
echo ========================================================
pause
