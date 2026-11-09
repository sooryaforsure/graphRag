import asyncio
from llm_client import llm_client
from core_extractor import build_knowledge_graph, clean_and_parse_llm_json, resolve_entity

def test_fastembed_dimension():
    """Verify that FastEmbed produces 768-dimensional embeddings matching Neo4j vector index."""
    test_text = "Microsoft Corporation is partnering with OpenAI."
    embedding = asyncio.run(llm_client.get_embedding(test_text))
    assert embedding is not None, "Embedding should not be None"
    assert len(embedding) == 768, f"Expected 768 dimensions, got {len(embedding)}"

def test_batch_embeddings():
    """Verify batch embedding generation works for multiple entities."""
    texts = ["Google", "DeepMind", "Gemini", "Artificial Intelligence"]
    embeddings = asyncio.run(llm_client.get_embeddings_batch(texts))
    assert len(embeddings) == 4, f"Expected 4 embeddings, got {len(embeddings)}"
    for emb in embeddings:
        assert emb is not None, "Batch element embedding should not be None"
        assert len(emb) == 768, f"Expected 768 dimensions, got {len(emb)}"

def test_json_cleaner_and_parser():
    """Verify JSON parsing and markdown fence stripping."""
    raw = '```json\n{"nodes": [{"id": "Python", "label": "Language"}], "edges": []}\n```'
    parsed = clean_and_parse_llm_json(raw)
    assert "nodes" in parsed
    assert len(parsed["nodes"]) == 1
    assert parsed["nodes"][0]["id"] == "Python"

def test_entity_deduplication():
    """Verify fuzzy entity resolution."""
    existing = ["Apple Inc.", "Microsoft Corp"]
    res1 = resolve_entity("apple", existing)
    assert res1 == "Apple Inc."
    res2 = resolve_entity("New Entity", existing)
    assert res2 == "New Entity"

def test_health_check_structure():
    """Verify health check returns valid dictionary structure."""
    health = asyncio.run(llm_client.check_health())
    assert "ok" in health
    assert "provider" in health
    assert "model" in health
