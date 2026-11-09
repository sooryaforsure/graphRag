from neo4j import AsyncGraphDatabase
import os
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "password")

class Neo4jClient:
    def __init__(self, uri, user, password):
        self.driver = AsyncGraphDatabase.driver(uri, auth=(user, password))

    async def close(self):
        await self.driver.close()

    async def init_vector_index(self):
        """
        Initializes schema constraints, performance indexes, and native vector index.
        Guarantees O(1) entity lookups and fast workspace-scoped graph traversals.
        """
        setup_queries = [
            "CREATE CONSTRAINT entity_id_unique IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE",
            "CREATE INDEX entity_workspace_idx IF NOT EXISTS FOR (e:Entity) ON (e.workspace)",
            """
            CREATE VECTOR INDEX entity_embeddings IF NOT EXISTS
            FOR (n:Entity) ON (n.embedding)
            OPTIONS {indexConfig: {
             `vector.dimensions`: 768,
             `vector.similarity_function`: 'cosine'
            }}
            """
        ]
        try:
            async with self.driver.session() as session:
                for q in setup_queries:
                    try:
                        await session.run(q)
                    except Exception as q_err:
                        pass
                return True
        except Exception as e:
            print(f"Schema initialization warning: {e}")
            return False

    async def merge_knowledge(
        self,
        nodes: list,
        edges: list,
        source_doc: str = None,
        workspace: str = "default"
    ):
        """
        Merges nodes and edges into Neo4j using Cypher.
        Attaches dense vector embeddings, document provenance (source_doc),
        and multi-tenant workspace partitioning.
        """
        async def _merge_nodes_tx(tx, batch, doc, ws):
            query = """
            UNWIND $batch AS node
            MERGE (n:Entity {id: node.id})
            SET n.label = COALESCE(node.label, n.label, 'Entity'),
                n.workspace = $ws
            FOREACH (_ IN CASE WHEN node.embedding IS NOT NULL THEN [1] ELSE [] END |
                SET n.embedding = node.embedding
            )
            FOREACH (_ IN CASE WHEN $doc IS NOT NULL THEN [1] ELSE [] END |
                SET n.source_doc = $doc
            )
            """
            await tx.run(query, batch=batch, doc=doc, ws=ws)
            
        async def _merge_edges_tx(tx, batch, doc, ws):
            query = """
            UNWIND $batch AS edge
            MERGE (source:Entity {id: edge.source})
            MERGE (target:Entity {id: edge.target})
            MERGE (source)-[r:RELATED {type: COALESCE(edge.relation, edge.type, 'RELATED')}]->(target)
            SET r.relation = COALESCE(edge.relation, edge.type, 'RELATED'),
                r.workspace = $ws
            FOREACH (_ IN CASE WHEN $doc IS NOT NULL THEN [1] ELSE [] END |
                SET r.source_doc = $doc
            )
            """
            await tx.run(query, batch=batch, doc=doc, ws=ws)

        async with self.driver.session() as session:
            if nodes:
                await session.execute_write(_merge_nodes_tx, nodes, source_doc, workspace)
            if edges:
                await session.execute_write(_merge_edges_tx, edges, source_doc, workspace)

    async def hybrid_fetch_context(
        self,
        entities: Optional[list] = None,
        question_embedding: Optional[list] = None,
        top_k: int = 6,
        max_hops: int = 2,
        workspace: str = "all"
    ) -> list:
        """
        Hybrid Retrieval Engine:
        1. Dense Vector Similarity Search (Ollama nomic-embed-text -> Neo4j Vector Index)
        2. Keyword Entity Match
        3. Multi-Hop Graph Traversal (1-hop & 2-hop paths) with Document Provenance Citations
        4. Workspace isolation scoping
        """
        seed_entities = set(entities or [])

        async with self.driver.session() as session:
            # 1. Vector Search across graph entity embeddings
            if question_embedding:
                try:
                    vector_query = """
                    CALL db.index.vector.queryNodes('entity_embeddings', $top_k, $embedding)
                    YIELD node, score
                    WHERE score >= 0.50
                    RETURN node.id AS id, score
                    """
                    v_res = await session.run(vector_query, top_k=top_k, embedding=question_embedding)
                    v_records = await v_res.data()
                    for rec in v_records:
                        if rec.get("id"):
                            seed_entities.add(rec["id"])
                except Exception as e:
                    print(f"Vector search note: {e}")

            if not seed_entities:
                return []

            seed_list = list(seed_entities)
            context_triples = []

            # 2. Multi-Hop Traversal (1-Hop and 2-Hop) scoped by workspace
            if max_hops >= 2:
                multi_hop_query = """
                UNWIND $seeds AS seed_name
                MATCH (s:Entity)
                WHERE (toLower(s.id) = toLower(seed_name) 
                   OR toLower(s.id) CONTAINS toLower(seed_name)
                   OR toLower(seed_name) CONTAINS toLower(s.id))
                  AND ($ws = 'all' OR s.workspace = $ws OR s.workspace IS NULL)
                
                // 1-Hop direct relationships
                MATCH (s)-[r1:RELATED]-(n1:Entity)
                WHERE ($ws = 'all' OR r1.workspace = $ws OR r1.workspace IS NULL)
                
                // Optional 2-Hop extended relationships
                OPTIONAL MATCH (n1)-[r2:RELATED]-(n2:Entity)
                WHERE n2 <> s
                  AND ($ws = 'all' OR r2.workspace = $ws OR r2.workspace IS NULL)
                
                RETURN DISTINCT
                    s.id AS source,
                    r1.type AS r1_type,
                    n1.id AS target1,
                    r1.source_doc AS doc1,
                    r2.type AS r2_type,
                    n2.id AS target2,
                    r2.source_doc AS doc2
                LIMIT 40
                """
                res = await session.run(multi_hop_query, seeds=seed_list, ws=workspace)
                records = await res.data()

                seen_facts = set()
                for rec in records:
                    s = rec["source"]
                    r1 = rec["r1_type"]
                    t1 = rec["target1"]
                    d1 = rec.get("doc1")
                    doc_cite = f" (Source: {d1})" if d1 else ""
                    
                    # 1-Hop fact
                    fact_1 = f"- {s} {r1} {t1}{doc_cite}"
                    if fact_1 not in seen_facts:
                        seen_facts.add(fact_1)
                        context_triples.append(fact_1)

                    # 2-Hop path
                    r2 = rec.get("r2_type")
                    t2 = rec.get("target2")
                    if r2 and t2:
                        d2 = rec.get("doc2")
                        doc2_cite = f" (Source: {d2})" if d2 else ""
                        fact_2 = f"  -> Path: {t1} -[{r2}]-> {t2}{doc2_cite}"
                        if fact_2 not in seen_facts:
                            seen_facts.add(fact_2)
                            context_triples.append(fact_2)
            else:
                one_hop_query = """
                UNWIND $seeds AS seed_name
                MATCH (s:Entity)-[r:RELATED]-(neighbor:Entity)
                WHERE (toLower(s.id) = toLower(seed_name) 
                   OR toLower(s.id) CONTAINS toLower(seed_name)
                   OR toLower(seed_name) CONTAINS toLower(s.id))
                  AND ($ws = 'all' OR s.workspace = $ws OR s.workspace IS NULL)
                RETURN DISTINCT s.id AS source, r.type AS relation, neighbor.id AS target, r.source_doc AS doc
                LIMIT 30
                """
                res = await session.run(one_hop_query, seeds=seed_list, ws=workspace)
                records = await res.data()
                for rec in records:
                    doc_cite = f" (Source: {rec.get('doc')})" if rec.get("doc") else ""
                    context_triples.append(f"- {rec['source']} {rec['relation']} {rec['target']}{doc_cite}")

            return list(dict.fromkeys(context_triples))

    async def get_community_summary_context(self, workspace: str = "all", limit: int = 25) -> list:
        """
        Retrieves top central hub entities and their connections across the graph
        for global knowledge synthesis and theme discovery.
        """
        query = """
        MATCH (n:Entity)
        WHERE ($ws = 'all' OR n.workspace = $ws OR n.workspace IS NULL)
        OPTIONAL MATCH (n)-[r:RELATED]-(m:Entity)
        WITH n, count(r) AS degree, collect(DISTINCT r.type + ' ' + m.id)[..4] AS connections
        WHERE degree > 0
        RETURN n.id AS entity, COALESCE(n.label, 'Entity') AS category, degree, connections, n.source_doc AS source_doc
        ORDER BY degree DESC
        LIMIT $limit
        """
        async with self.driver.session() as session:
            res = await session.run(query, ws=workspace, limit=limit)
            records = await res.data()
            summary_facts = []
            for rec in records:
                ent = rec["entity"]
                cat = rec["category"]
                conns = ", ".join(rec.get("connections", []))
                doc = f" [Source: {rec['source_doc']}]" if rec.get("source_doc") else ""
                summary_facts.append(f"- {ent} ({cat}): connected to {conns}{doc}")
            return summary_facts

    async def fetch_context(self, entities: list) -> list:
        """Backward compatibility wrapper."""
        return await self.hybrid_fetch_context(entities=entities, max_hops=2)

    async def get_graph_data(self, limit: int = 150, workspace: str = "all") -> dict:
        """Fetches nodes and edges for visualization/stats."""
        query_nodes = """
        MATCH (n:Entity)
        WHERE ($ws = 'all' OR n.workspace = $ws OR n.workspace IS NULL)
        OPTIONAL MATCH (n)-[r]-()
        RETURN n.id AS id, COALESCE(n.label, 'Entity') AS label, count(r) AS degree
        LIMIT $limit
        """
        query_edges = """
        MATCH (s:Entity)-[r:RELATED]->(t:Entity)
        WHERE ($ws = 'all' OR r.workspace = $ws OR r.workspace IS NULL)
        RETURN s.id AS source, r.type AS relation, t.id AS target
        LIMIT $limit
        """
        try:
            async with self.driver.session() as session:
                n_res = await session.run(query_nodes, limit=limit, ws=workspace)
                nodes = await n_res.data()
                e_res = await session.run(query_edges, limit=limit, ws=workspace)
                edges = await e_res.data()
                return {"nodes": nodes, "edges": edges}
        except Exception as e:
            print(f"Error fetching graph data: {e}")
            return {"nodes": [], "edges": []}

    async def get_stats(self, workspace: str = "all") -> dict:
        """Fetches total count of nodes and edges in Neo4j."""
        query = """
        MATCH (n:Entity)
        WHERE ($ws = 'all' OR n.workspace = $ws OR n.workspace IS NULL)
        OPTIONAL MATCH (n)-[r:RELATED]->()
        RETURN count(DISTINCT n) AS node_count, count(DISTINCT r) AS edge_count
        """
        try:
            async with self.driver.session() as session:
                res = await session.run(query, ws=workspace)
                record = await res.single()
                if record:
                    return {
                        "nodes": record["node_count"] or 0,
                        "edges": record["edge_count"] or 0
                    }
                return {"nodes": 0, "edges": 0}
        except Exception as e:
            print(f"Error fetching stats: {e}")
            return {"nodes": 0, "edges": 0}

    async def clear_graph(self, workspace: str = "all") -> bool:
        """Clears all entities and relationships in the specified workspace or entirely."""
        if workspace == "all":
            query = "MATCH (n:Entity) DETACH DELETE n"
        else:
            query = "MATCH (n:Entity) WHERE n.workspace = $ws DETACH DELETE n"
        try:
            async with self.driver.session() as session:
                await session.run(query, ws=workspace)
                return True
        except Exception as e:
            print(f"Error clearing graph: {e}")
            return False

    async def ping(self) -> bool:
        """Checks if Neo4j connection is active."""
        try:
            async with self.driver.session() as session:
                res = await session.run("RETURN 1 AS ok")
                rec = await res.single()
                return rec is not None and rec["ok"] == 1
        except Exception:
            return False

# Singleton instance
neo4j_client = Neo4jClient(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
