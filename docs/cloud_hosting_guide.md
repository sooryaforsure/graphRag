# 🌐 100% Free Cloud Deployment Guide for GraphRAG Knowledge System

Follow this simple guide to deploy your GraphRAG Knowledge System online for free, accessible from anywhere 24/7 without needing your laptop or local Ollama.

---

## 🔑 Step 1: Get Your Free API Keys & Cloud Database

### 1. Free Groq Cloud API Key
1. Go to **[console.groq.com](https://console.groq.com)** and sign in with Google or GitHub (Free account, no credit card required).
2. Go to **API Keys** -> click **Create API Key**.
3. Copy your key (starts with `gsk_...`).

### 2. Free Cloud Neo4j (Neo4j AuraDB Free)
1. Go to **[neo4j.com/cloud/platform/aura-graph-database](https://neo4j.com/cloud/platform/aura-graph-database/)** and click **Start Free**.
2. Create an **AuraDB Free** instance.
3. Save the connection details:
   - **URI**: e.g. `neo4j+s://xxxxxxxx.databases.neo4j.io`
   - **Username**: `neo4j`
   - **Password**: generated during instance creation.

---

## 🚀 Step 2: Testing Locally Before Deploying

1. Open `backend/.env`.
2. Add your Groq API key:
   ```env
   LLM_PROVIDER=groq
   GROQ_API_KEY=gsk_your_actual_key_here
   GROQ_MODEL=openai/gpt-oss-120b
   ```
3. Run `start_system.bat` to launch and test locally!

---

## ☁️ Step 3: Free Cloud Hosting (Render / Vercel)

### Option A: 1-Click Deployment with Render.com (Recommended)
1. Push this project to your GitHub repository.
2. Sign up on **[render.com](https://render.com)** (Free tier).
3. Click **New +** -> **Blueprint**.
4. Connect your GitHub repository. Render will automatically read `render.yaml` and configure:
   - The FastAPI backend service.
   - The React Vite frontend static site.
5. In the Render dashboard, fill in the Environment Variables:
   - `GROQ_API_KEY`: your Groq key.
   - `NEO4J_URI`: your Neo4j AuraDB URI (`neo4j+s://...`).
   - `NEO4J_USER`: `neo4j`.
   - `NEO4J_PASSWORD`: your AuraDB password.
6. Click **Deploy**! Your website is live and public!

---

### Option B: Frontend on Vercel + Backend on Render
- **Backend on Render**:
  - New **Web Service** -> Python -> Root Dir: `backend`.
  - Build: `pip install -r requirements.txt`.
  - Start: `uvicorn server:app --host 0.0.0.0 --port $PORT`.
  - Set `.env` variables in Render environment settings.
- **Frontend on Vercel**:
  - New Project -> Root Dir: `frontend`.
  - Framework: Vite.
  - Environment Variable: `VITE_API_URL` = `https://your-backend-name.onrender.com`.
  - Deploy!
