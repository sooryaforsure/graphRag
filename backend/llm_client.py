import os
import json
import asyncio
from typing import AsyncIterator, Optional, List, Dict, Any
from dotenv import load_dotenv

load_dotenv()

# Environment settings
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq").lower() # "groq" or "ollama"
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "fastembed").lower() # "fastembed" or "ollama"
FASTEMBED_MODEL = os.getenv("FASTEMBED_MODEL", "nomic-ai/nomic-embed-text-v1.5")

# Lazy-loaded clients
_groq_client = None
_ollama_client = None
_fastembed_model = None


def get_groq_client():
    global _groq_client
    if _groq_client is None:
        from groq import AsyncGroq
        api_key = GROQ_API_KEY or os.getenv("GROQ_API_KEY", "")
        if not api_key:
            print("[WARNING] GROQ_API_KEY is not set. Groq calls will fail until a key is provided in .env")
        _groq_client = AsyncGroq(api_key=api_key or "missing_key")
    return _groq_client


def get_ollama_client():
    global _ollama_client
    if _ollama_client is None:
        from ollama import AsyncClient
        _ollama_client = AsyncClient(host=OLLAMA_HOST)
    return _ollama_client


def get_fastembed_model():
    global _fastembed_model
    if _fastembed_model is None:
        try:
            from fastembed import TextEmbedding
            # nomic-ai/nomic-embed-text-v1.5 produces 768-dimensional embeddings
            _fastembed_model = TextEmbedding(model_name=FASTEMBED_MODEL)
            print(f"[OK] FastEmbed model '{FASTEMBED_MODEL}' initialized (768-d vectors).")
        except Exception as e:
            print(f"[WARNING] FastEmbed initialization warning: {e}")
            try:
                from fastembed import TextEmbedding
                _fastembed_model = TextEmbedding(model_name="BAAI/bge-base-en-v1.5")
            except Exception as e2:
                print(f"[ERROR] Could not initialize fallback FastEmbed model: {e2}")
    return _fastembed_model


class LLMClient:
    """
    Unified LLM Client abstraction supporting:
    - Groq Cloud API (Llama 3.3 70B, Llama 3.1 8B, JSON Mode, Streaming)
    - Ollama Local AI (llama3.2)
    - FastEmbed (Lightweight CPU-based 768-d embeddings for Neo4j)
    """

    def __init__(self):
        self.provider = LLM_PROVIDER
        self.groq_model = GROQ_MODEL
        self.ollama_model = OLLAMA_MODEL

    async def check_health(self) -> Dict[str, Any]:
        """Validates connection to the active LLM provider."""
        provider = os.getenv("LLM_PROVIDER", self.provider).lower()
        if provider == "groq":
            key = os.getenv("GROQ_API_KEY", GROQ_API_KEY)
            if not key or key == "your_groq_api_key_here":
                return {
                    "ok": False,
                    "provider": "groq",
                    "model": self.groq_model,
                    "error": "GROQ_API_KEY is not configured in .env"
                }
            try:
                client = get_groq_client()
                # Light call to verify auth
                res = await client.models.list()
                return {
                    "ok": True,
                    "provider": "groq",
                    "model": self.groq_model,
                    "available_models": [m.id for m in res.data[:5]] if hasattr(res, "data") else [self.groq_model],
                    "error": None
                }
            except Exception as e:
                return {
                    "ok": False,
                    "provider": "groq",
                    "model": self.groq_model,
                    "error": str(e)
                }
        else:
            try:
                client = get_ollama_client()
                info = await client.list()
                models = [m.model for m in getattr(info, "models", [])]
                return {
                    "ok": True,
                    "provider": "ollama",
                    "model": self.ollama_model,
                    "available_models": models,
                    "error": None
                }
            except Exception as e:
                return {
                    "ok": False,
                    "provider": "ollama",
                    "model": self.ollama_model,
                    "error": str(e)
                }

    async def extract_graph_json(self, chunk: str, system_prompt: str) -> str:
        """
        Extracts structured Knowledge Graph JSON from a document chunk.
        Uses native JSON mode for both Groq and Ollama.
        """
        provider = os.getenv("LLM_PROVIDER", self.provider).lower()
        if provider == "groq":
            client = get_groq_client()
            response = await client.chat.completions.create(
                model=self.groq_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Extract knowledge graph from this text:\n\n{chunk}"}
                ],
                response_format={"type": "json_object"},
                temperature=0.0
            )
            return response.choices[0].message.content or ""
        else:
            client = get_ollama_client()
            response = await client.chat(
                model=self.ollama_model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Extract knowledge graph from this text:\n\n{chunk}"}
                ],
                format="json",
                options={"temperature": 0.0}
            )
            return response.get("message", {}).get("content", "")

    async def extract_search_entities(self, question: str) -> List[str]:
        """Extracts keyword search entities from a user question."""
        entity_prompt = (
            'Extract the key search entities from the following question to query a knowledge graph.\n'
            'Return ONLY a JSON object with a single key "entities" containing a list of strings.\n'
            f'Question: {question}'
        )
        provider = os.getenv("LLM_PROVIDER", self.provider).lower()
        try:
            if provider == "groq":
                client = get_groq_client()
                res = await client.chat.completions.create(
                    model=self.groq_model,
                    messages=[{"role": "user", "content": entity_prompt}],
                    response_format={"type": "json_object"},
                    temperature=0.0
                )
                raw = res.choices[0].message.content or "{}"
            else:
                client = get_ollama_client()
                res = await client.chat(
                    model=self.ollama_model,
                    messages=[{"role": "user", "content": entity_prompt}],
                    format="json",
                    options={"temperature": 0.0}
                )
                raw = res.get("message", {}).get("content", "{}")
            
            data = json.loads(raw)
            entities = data.get("entities", [])
            if entities and isinstance(entities, list):
                return [str(e) for e in entities if e]
        except Exception as e:
            print(f"[DEBUG] Search entity extraction fallback: {e}")

        # Fallback to simple keyword extraction
        return [w for w in question.split() if len(w) > 3]

    async def generate_chat(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.0) -> str:
        """Standard non-streaming generation."""
        provider = os.getenv("LLM_PROVIDER", self.provider).lower()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        if provider == "groq":
            client = get_groq_client()
            res = await client.chat.completions.create(
                model=self.groq_model,
                messages=messages,
                temperature=temperature
            )
            return res.choices[0].message.content or ""
        else:
            client = get_ollama_client()
            res = await client.chat(
                model=self.ollama_model,
                messages=messages,
                options={"temperature": temperature}
            )
            return res.get("message", {}).get("content", "")

    async def stream_chat(self, prompt: str, system_prompt: Optional[str] = None, temperature: float = 0.0) -> AsyncIterator[str]:
        """Asynchronous token streaming for real-time SSE output."""
        provider = os.getenv("LLM_PROVIDER", self.provider).lower()
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        if provider == "groq":
            client = get_groq_client()
            stream = await client.chat.completions.create(
                model=self.groq_model,
                messages=messages,
                stream=True,
                temperature=temperature
            )
            async for chunk in stream:
                token = chunk.choices[0].delta.content or ""
                if token:
                    yield token
        else:
            client = get_ollama_client()
            stream = await client.chat(
                model=self.ollama_model,
                messages=messages,
                stream=True,
                options={"temperature": temperature}
            )
            async for chunk in stream:
                token = chunk.get("message", {}).get("content", "")
                if token:
                    yield token

    async def get_embedding(self, text: str) -> Optional[List[float]]:
        """Generates 768-d dense vector embedding for a single text."""
        embeddings = await self.get_embeddings_batch([text])
        return embeddings[0] if embeddings else None

    async def get_embeddings_batch(self, texts: List[str]) -> List[Optional[List[float]]]:
        """
        Generates 768-d dense vector embeddings for a list of texts.
        Uses FastEmbed CPU engine by default for zero-cost, instant cloud embedding.
        """
        if not texts:
            return []

        emb_provider = os.getenv("EMBEDDING_PROVIDER", EMBEDDING_PROVIDER).lower()
        if emb_provider == "fastembed":
            try:
                # FastEmbed executes synchronously on CPU ONNX runtime; run in thread pool to keep async loop non-blocking
                model = get_fastembed_model()
                if model is not None:
                    def _compute():
                        # embed() yields numpy arrays
                        return [vec.tolist() for vec in model.embed(texts)]
                    loop = asyncio.get_running_loop()
                    vectors = await loop.run_in_executor(None, _compute)
                    return vectors
            except Exception as e:
                print(f"[WARNING] FastEmbed batch generation error: {e}")

        # Fallback to Ollama if fastembed is unavailable or configured as ollama
        try:
            client = get_ollama_client()
            results = []
            for t in texts:
                try:
                    res = await client.embeddings(model=OLLAMA_EMBED_MODEL, prompt=t)
                    results.append(res.get("embedding"))
                except Exception:
                    results.append(None)
            return results
        except Exception as e:
            print(f"[ERROR] Embedding fallback error: {e}")
            return [None] * len(texts)


# Singleton client instance
llm_client = LLMClient()
