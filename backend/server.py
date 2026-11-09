from fastapi import FastAPI, UploadFile, File, Form, Request, HTTPException, BackgroundTasks, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from typing import Optional
import json
import os
import io
import time
import uuid
import pypdf
from dotenv import load_dotenv
import asyncio

load_dotenv()

from core_extractor import build_knowledge_graph
from db_client import neo4j_client
from security import verify_api_key, RateLimitMiddleware, is_auth_enabled
import backup_manager
from llm_client import llm_client

app = FastAPI(title="GraphRAG Knowledge System API - Phase 4 Production")

# In-memory sliding-window rate limiting middleware
app.add_middleware(RateLimitMiddleware)

# Enable CORS for frontend clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Background job tracker with JSON file persistence
JOBS_STORE_PATH = os.path.join(os.path.dirname(__file__), "jobs_store.json")
jobs_db: dict[str, dict] = {}

def _load_jobs() -> dict[str, dict]:
    global jobs_db
    if os.path.exists(JOBS_STORE_PATH):
        try:
            with open(JOBS_STORE_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                jobs_db.update(saved)
        except Exception:
            pass
    return jobs_db

def _save_job(job_data: dict):
    jobs_db[job_data["job_id"]] = job_data
    try:
        recent = dict(sorted(jobs_db.items(), key=lambda x: x[1].get("created_at", 0), reverse=True)[:100])
        with open(JOBS_STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(recent, f, indent=2)
    except Exception:
        pass

@app.on_event("startup")
async def startup_event():
    _load_jobs()
    await neo4j_client.init_vector_index()

@app.on_event("shutdown")
async def shutdown_event():
    await neo4j_client.close()

@app.get("/health")
async def health_check():
    neo4j_ok = await neo4j_client.ping()
    llm_health = await llm_client.check_health()
    llm_ok = llm_health.get("ok", False)

    return {
        "status": "online" if (neo4j_ok and llm_ok) else "degraded",
        "neo4j": "connected" if neo4j_ok else "disconnected",
        "ollama": "connected" if llm_ok else "disconnected", # preserved for frontend status badge
        "llm_provider": llm_health.get("provider", "groq"),
        "model": llm_health.get("model", "llama-3.3-70b-versatile"),
        "embed_model": "nomic-ai/nomic-embed-text-v1.5",
        "available_models": llm_health.get("available_models", []),
        "llm_error": llm_health.get("error"),
        "auth_enabled": is_auth_enabled()
    }

@app.get("/graph")
async def get_graph(limit: int = 150, workspace: str = "all"):
    return await neo4j_client.get_graph_data(limit=limit, workspace=workspace)

@app.get("/stats")
async def get_stats(workspace: str = "all"):
    return await neo4j_client.get_stats(workspace=workspace)

@app.post("/clear")
async def clear_database(workspace: str = "all", _auth: bool = Depends(verify_api_key)):
    success = await neo4j_client.clear_graph(workspace=workspace)
    return {"message": "Graph successfully cleared", "workspace": workspace, "success": success}

# ==============================================================================
# ASYNCHRONOUS BACKGROUND INGESTION WORKER (PHASE 3)
# ==============================================================================

async def _process_ingest_background(
    job_id: str,
    content: bytes,
    filename: str,
    workspace: str
):
    """Background worker that handles parsing, LLM extraction, embedding, and Neo4j merge."""
    job = jobs_db.get(job_id) or _load_jobs().get(job_id)
    if not job:
        return

    try:
        job["status"] = "processing"
        job["progress"] = 15
        job["stage"] = "Parsing document content..."
        _save_job(job)

        text_content = ""
        if filename.lower().endswith(".pdf"):
            try:
                reader = pypdf.PdfReader(io.BytesIO(content))
                pages = []
                for p in reader.pages:
                    t = p.extract_text()
                    if t and t.strip():
                        pages.append(t.strip())
                text_content = "\n\n".join(pages)
            except Exception as e:
                raise ValueError(f"PDF extraction error: {e}")
        else:
            try:
                text_content = content.decode("utf-8")
            except UnicodeDecodeError:
                text_content = content.decode("latin-1", errors="ignore")

        if not text_content.strip():
            raise ValueError("Document appears to be empty or contains unreadable content.")

        active_provider = os.getenv("LLM_PROVIDER", llm_client.provider).upper()
        active_model = llm_client.groq_model if active_provider.lower() == "groq" else llm_client.ollama_model

        job["progress"] = 35
        job["stage"] = f"Extracting entities & relations with {active_provider} ({active_model})..."
        _save_job(job)

        nodes, edges = await build_knowledge_graph(text_content)

        job["progress"] = 70
        job["stage"] = "Generating 768-d vector embeddings..."
        _save_job(job)

        if nodes:
            node_texts = [n.get('id', '') for n in nodes]
            embeddings = await llm_client.get_embeddings_batch(node_texts)
            for n, emb in zip(nodes, embeddings):
                n['embedding'] = emb

        job["progress"] = 90
        job["stage"] = f"Merging into Neo4j graph database (Workspace: {workspace})..."
        _save_job(job)

        await neo4j_client.merge_knowledge(nodes, edges, source_doc=filename, workspace=workspace)

        job["status"] = "completed"
        job["progress"] = 100
        job["stage"] = "Knowledge successfully ingested into graph!"
        job["nodes"] = len(nodes)
        job["edges"] = len(edges)
        job["completed_at"] = time.time()
        _save_job(job)

    except Exception as err:
        job["status"] = "failed"
        job["progress"] = 100
        job["stage"] = f"Ingestion failed: {str(err)}"
        job["error"] = str(err)
        job["completed_at"] = time.time()
        _save_job(job)

@app.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    workspace: str = Form("default"),
    sync: bool = False,
    _auth: bool = Depends(verify_api_key)
):
    """
    Asynchronous document ingestion endpoint.
    Queues document for background parsing, Groq/LLM extraction, embedding, and Neo4j merge.
    Returns immediately with a job_id for progress tracking.
    """
    content = await file.read()
    filename = file.filename or "document.txt"
    job_id = str(uuid.uuid4())

    job_data = {
        "job_id": job_id,
        "filename": filename,
        "workspace": workspace,
        "status": "queued",
        "progress": 5,
        "stage": "Job queued for ingestion...",
        "nodes": 0,
        "edges": 0,
        "error": None,
        "created_at": time.time(),
        "completed_at": None,
    }
    _save_job(job_data)

    if sync:
        await _process_ingest_background(job_id, content, filename, workspace)
        return jobs_db[job_id]

    background_tasks.add_task(_process_ingest_background, job_id, content, filename, workspace)

    return {
        "job_id": job_id,
        "status": "processing",
        "filename": filename,
        "workspace": workspace,
        "message": "Document accepted for asynchronous ingestion."
    }

@app.get("/upload/status/{job_id}")
async def get_upload_status(job_id: str):
    """Poll progress status of an ingestion job."""
    job = jobs_db.get(job_id) or _load_jobs().get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Ingestion job not found")
    return job

@app.get("/upload/jobs")
async def list_upload_jobs():
    """Returns recent ingestion jobs."""
    _load_jobs()
    jobs_list = sorted(jobs_db.values(), key=lambda x: x["created_at"], reverse=True)
    return {"jobs": jobs_list[:20]}

# ==============================================================================
# RETRIEVAL & QUERY ENGINE (HYBRID VECTOR + 2-HOP TRAVERSAL + STREAMING)
# ==============================================================================

async def _extract_search_entities(question: str) -> list[str]:
    """Extracts search keywords/entities from question using LLM."""
    return await llm_client.extract_search_entities(question)

async def _get_question_embedding(question: str) -> Optional[list]:
    """Computes dense 768-d vector embedding for query."""
    return await llm_client.get_embedding(question)

@app.post("/query")
async def query_graph(
    request: Request,
    question: Optional[str] = Form(None),
    workspace: str = Form("all"),
    _auth: bool = Depends(verify_api_key)
):
    """Non-streaming query endpoint with hybrid search and workspace scoping."""
    start_time = time.time()
    
    actual_question = question
    ws = workspace
    if not actual_question:
        try:
            body = await request.json()
            if isinstance(body, dict):
                actual_question = body.get("question")
                ws = body.get("workspace", ws)
        except Exception:
            pass
    if not actual_question:
        raise HTTPException(status_code=400, detail="Missing 'question' parameter")
    question = actual_question

    search_entities, q_embedding = await asyncio.gather(
        _extract_search_entities(question),
        _get_question_embedding(question)
    )

    relevant_context = await neo4j_client.hybrid_fetch_context(
        entities=search_entities,
        question_embedding=q_embedding or [],
        top_k=6,
        max_hops=2,
        workspace=ws
    )
    context_string = "\n".join(relevant_context)

    if relevant_context:
        prompt = f"Answer using ONLY this grounded context from the knowledge graph and cite document sources if available:\n{context_string}\n\nQuestion: {question}"
    else:
        prompt = f"The knowledge graph does not contain direct context for the entities: {', '.join(search_entities)}.\nPlease answer based on general knowledge or note that this is not in the graph.\n\nQuestion: {question}"

    ans_text = await llm_client.generate_chat(prompt=prompt, temperature=0.0)
    latency_ms = int((time.time() - start_time) * 1000)

    return {
        "answer": ans_text,
        "context": relevant_context,
        "extracted_entities": search_entities,
        "workspace": ws,
        "latency_ms": latency_ms
    }

@app.post("/query/stream")
async def query_graph_stream(
    request: Request,
    question: Optional[str] = Form(None),
    workspace: str = Form("all"),
    _auth: bool = Depends(verify_api_key)
):
    """
    Server-Sent Events (SSE) streaming endpoint.
    Retrieves hybrid context (Vector + 2-Hop Graph + Workspace) in <500ms,
    then streams token chunks progressively.
    """
    start_time = time.time()

    actual_question = question
    ws = workspace
    if not actual_question:
        try:
            body = await request.json()
            if isinstance(body, dict):
                actual_question = body.get("question")
                ws = body.get("workspace", ws)
        except Exception:
            pass
    if not actual_question:
        raise HTTPException(status_code=400, detail="Missing 'question' parameter")
    question = actual_question

    search_entities, q_embedding = await asyncio.gather(
        _extract_search_entities(question),
        _get_question_embedding(question)
    )

    relevant_context = await neo4j_client.hybrid_fetch_context(
        entities=search_entities,
        question_embedding=q_embedding or [],
        top_k=6,
        max_hops=2,
        workspace=ws
    )
    context_string = "\n".join(relevant_context)

    if relevant_context:
        prompt = f"Answer using ONLY this grounded context from the knowledge graph and cite document sources if available:\n{context_string}\n\nQuestion: {question}"
    else:
        prompt = f"The knowledge graph does not contain direct context for the entities: {', '.join(search_entities)}.\nPlease answer based on general knowledge or note that this is not in the graph.\n\nQuestion: {question}"

    async def event_generator():
        # Immediate metadata event with context & entities (<500ms)
        meta_event = {
            "type": "meta",
            "entities": search_entities,
            "context": relevant_context,
            "workspace": ws
        }
        yield f"data: {json.dumps(meta_event)}\n\n"

        try:
            async for token in llm_client.stream_chat(prompt=prompt, temperature=0.0):
                yield f"data: {json.dumps({'type': 'token', 'token': token})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

        latency_ms = int((time.time() - start_time) * 1000)
        yield f"data: {json.dumps({'type': 'done', 'latency_ms': latency_ms})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.post("/query/summarize")
async def summarize_knowledge_base(
    request: Request,
    workspace: Optional[str] = None,
    _auth: bool = Depends(verify_api_key)
):
    """
    Global knowledge graph synthesis endpoint.
    Retrieves highest-degree central entity hubs and relationships across the graph,
    then uses LLM to produce an executive overview.
    """
    ws = workspace
    try:
        body = await request.json()
        if isinstance(body, dict) and "workspace" in body:
            ws = body["workspace"]
    except Exception:
        pass
    if not ws:
        ws = "all"

    start_time = time.time()
    hub_facts = await neo4j_client.get_community_summary_context(workspace=ws, limit=25)
    
    if not hub_facts:
        return {
            "summary": f"The knowledge base for workspace '{ws}' is currently empty. Ingest documents to generate a knowledge summary.",
            "answer": f"The knowledge base for workspace '{ws}' is currently empty. Ingest documents to generate a knowledge summary.",
            "context": [],
            "extracted_entities": [],
            "facts_used": 0,
            "workspace": ws,
            "latency_ms": 0
        }

    facts_text = "\n".join(hub_facts)
    prompt = f"""
    You are an expert knowledge analyst. 
    Analyze the following central entities and relationships extracted from our knowledge graph.
    Provide a comprehensive, high-level executive summary of the key themes, organizations, products, and people represented.
    
    Key Graph Connections:
    {facts_text}
    
    Format your response with clear markdown headings and bullet points.
    """
    
    ans_text = await llm_client.generate_chat(prompt=prompt, temperature=0.2)
    latency_ms = int((time.time() - start_time) * 1000)

    # Extract unique entity names for UI chips
    entities = list(dict.fromkeys([f.split(" -[")[0].strip() for f in hub_facts if " -[" in f]))[:8]

    return {
        "summary": ans_text,
        "answer": ans_text,
        "context": hub_facts,
        "extracted_entities": entities,
        "facts_used": len(hub_facts),
        "workspace": ws,
        "latency_ms": latency_ms
    }

# ==============================================================================
# DISASTER RECOVERY & BACKUP ADMIN ENDPOINTS (PHASE 4)
# ==============================================================================

@app.post("/admin/backup")
async def trigger_backup(workspace: str = "all", _auth: bool = Depends(verify_api_key)):
    """Creates an atomic disaster recovery snapshot of the graph."""
    return await backup_manager.create_backup(workspace=workspace)

@app.get("/admin/backups")
async def get_backups(_auth: bool = Depends(verify_api_key)):
    """Lists all available disaster recovery snapshots."""
    return {"backups": backup_manager.list_backups()}

@app.post("/admin/restore")
async def trigger_restore(filename: str, clear_before: bool = False, _auth: bool = Depends(verify_api_key)):
    """Restores graph entities and relationships from a snapshot."""
    try:
        return await backup_manager.restore_backup(filename=filename, clear_before=clear_before)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
