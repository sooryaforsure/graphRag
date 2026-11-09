"""
Disaster Recovery & Database Backup Manager (Phase 4 Enterprise)
- Atomic JSON graph snapshot export (Nodes with embeddings & relationships)
- Snapshot restoration & vector index rebuilding
"""

import os
import json
import time
from datetime import datetime
from db_client import neo4j_client

BACKUPS_DIR = os.path.join(os.path.dirname(__file__), "backups")
os.makedirs(BACKUPS_DIR, exist_ok=True)

async def create_backup(workspace: str = "all") -> dict:
    """
    Exports all entities and relationships in the specified workspace
    into an atomic JSON snapshot file with metadata.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"graphrag_backup_{workspace}_{timestamp}.json"
    filepath = os.path.join(BACKUPS_DIR, filename)

    async with neo4j_client.driver.session() as session:
        # 1. Fetch nodes
        if workspace == "all":
            node_q = "MATCH (n:Entity) RETURN n.id AS id, labels(n) AS labels, n.source_doc AS source_doc, n.workspace AS workspace, n.embedding AS embedding"
            edge_q = "MATCH (a:Entity)-[r:RELATED]->(b:Entity) RETURN a.id AS source, b.id AS target, COALESCE(r.relation, r.type, 'RELATED') AS relation, r.source_doc AS source_doc, r.workspace AS workspace"
            n_res = await session.run(node_q)
            e_res = await session.run(edge_q)
        else:
            node_q = "MATCH (n:Entity) WHERE n.workspace = $ws RETURN n.id AS id, labels(n) AS labels, n.source_doc AS source_doc, n.workspace AS workspace, n.embedding AS embedding"
            edge_q = "MATCH (a:Entity)-[r:RELATED]->(b:Entity) WHERE r.workspace = $ws RETURN a.id AS source, b.id AS target, COALESCE(r.relation, r.type, 'RELATED') AS relation, r.source_doc AS source_doc, r.workspace AS workspace"
            n_res = await session.run(node_q, ws=workspace)
            e_res = await session.run(edge_q, ws=workspace)

        nodes = await n_res.data()
        edges = await e_res.data()

    backup_payload = {
        "version": "1.0",
        "timestamp": time.time(),
        "created_at": datetime.now().isoformat(),
        "workspace": workspace,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "nodes": nodes,
        "edges": edges,
    }

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(backup_payload, f, indent=2)

    snapshot = {
        "filename": filename,
        "filepath": filepath,
        "workspace": workspace,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "created_at": backup_payload["created_at"],
        "size_bytes": os.path.getsize(filepath)
    }

    return {
        "success": True,
        "filename": filename,
        "filepath": filepath,
        "workspace": workspace,
        "node_count": len(nodes),
        "edge_count": len(edges),
        "created_at": backup_payload["created_at"],
        "size_bytes": os.path.getsize(filepath),
        "snapshot": snapshot
    }

def list_backups() -> list[dict]:
    """Enumerates all available disaster recovery snapshots."""
    backups = []
    if not os.path.exists(BACKUPS_DIR):
        return backups

    for fname in os.listdir(BACKUPS_DIR):
        if fname.endswith(".json") and fname.startswith("graphrag_backup_"):
            fpath = os.path.join(BACKUPS_DIR, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    backups.append({
                        "filename": fname,
                        "workspace": meta.get("workspace", "unknown"),
                        "node_count": meta.get("node_count", 0),
                        "edge_count": meta.get("edge_count", 0),
                        "created_at": meta.get("created_at", ""),
                        "size_bytes": os.path.getsize(fpath)
                    })
            except Exception:
                pass

    return sorted(backups, key=lambda x: x["created_at"], reverse=True)

async def restore_backup(filename: str, clear_before: bool = False) -> dict:
    """
    Restores graph nodes and relationships from a snapshot file.
    Optionally clears existing workspace entities before restoring.
    """
    filepath = os.path.join(BACKUPS_DIR, os.path.basename(filename))
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Backup file '{filename}' does not exist.")

    with open(filepath, "r", encoding="utf-8") as f:
        data = json.load(f)

    workspace = data.get("workspace", "default")
    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    if clear_before:
        await neo4j_client.clear_graph(workspace=workspace)

    # Merge nodes and relationships back into Neo4j
    await neo4j_client.merge_knowledge(
        nodes=nodes,
        edges=edges,
        source_doc=f"backup:{os.path.basename(filename)}",
        workspace=workspace if workspace != "all" else "default"
    )

    # Re-verify vector index
    await neo4j_client.init_vector_index()

    return {
        "status": "restored",
        "filename": filename,
        "nodes_restored": len(nodes),
        "edges_restored": len(edges),
        "workspace": workspace
    }
