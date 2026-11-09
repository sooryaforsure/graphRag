import json
import re
import os
import difflib
from llm_client import llm_client

def resolve_entity(new_entity: str, existing_nodes: list, threshold: float = 0.85, existing_map: dict = None) -> str:
    """
    Standardizes entity names and deduplicates them against existing nodes
    using fuzzy string matching and substring checks.
    """
    if not new_entity:
        return new_entity
        
    new_norm = new_entity.strip().lower()
    if not new_norm:
        return new_entity
        
    existing_lower = existing_map if existing_map is not None else {str(n).strip().lower(): n for n in existing_nodes}
    
    # 1. Exact case-insensitive match
    if new_norm in existing_lower:
        return existing_lower[new_norm]
            
    # 2. Fuzzy match using difflib
    matches = difflib.get_close_matches(new_norm, existing_lower.keys(), n=1, cutoff=threshold)
    if matches:
        return existing_lower[matches[0]]
        
    # 3. Corporate/organization suffix normalization (e.g., "Apple" vs "Apple Inc.")
    common_suffixes = {"inc", "inc.", "corp", "corporation", "co", "ltd", "llc", "technologies"}
    new_words = set(re.sub(r'[^\w\s]', '', new_norm).split()) - common_suffixes
    for node_lower, original_node in existing_lower.items():
        existing_words = set(re.sub(r'[^\w\s]', '', node_lower).split()) - common_suffixes
        if new_words and new_words == existing_words:
            return original_node

    # If no match, return standard Title Case formatting
    return " ".join(new_entity.strip().split()).title()

def clean_and_parse_llm_json(raw_output: str):
    """
    Cleans LLM output by removing markdown code blocks, 
    extra whitespaces, or trailing characters, then parses as JSON.
    """
    if not raw_output:
        return {"nodes": [], "edges": []}

    # Step 1: Remove markdown code blocks if included
    cleaned = re.sub(r"```(?:json)?\s*([\s\S]*?)\s*```", r"\1", raw_output.strip())

    # Step 2: Try direct JSON parsing
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    # Step 3: Fallback extraction using regex to salvage partial JSON structures
    try:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            potential_json = match.group(0)
            # Fix common trailing comma issues in LLM outputs
            fixed_json = re.sub(r',\s*([\]}])', r'\1', potential_json)
            return json.loads(fixed_json)
    except Exception as e:
        print(f"JSON parsing fallback failed: {e}")

    # Ultimate fallback if parsing fails completely
    return {"nodes": [], "edges": []}


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200):
    """
    Splits large text into smaller overlapping chunks for better LLM context handling,
    respecting word boundaries to avoid splitting words.
    """
    if not text:
        return []
    
    words = text.split()
    word_chunk_size = max(1, chunk_size // 5)
    word_overlap = max(0, overlap // 5)
    step = max(1, word_chunk_size - word_overlap)
    
    chunks = []
    start = 0
    while start < len(words):
        end = start + word_chunk_size
        chunks.append(" ".join(words[start:end]))
        start += step
    return chunks


async def build_knowledge_graph(file_content: str, model_name: str = None) -> tuple[list, list]:
    """
    Processes document text, queries the LLM (Groq / Ollama) to extract entities and relations,
    and returns a list of nodes and edges for database insertion.
    """
    chunks = chunk_text(file_content)
    
    extracted_nodes = []
    extracted_edges = []
    session_node_ids = set() # Track nodes extracted in this session for deduplication

    system_prompt = """
    You are an advanced knowledge graph extraction system. 
    Analyze the text and extract key entities and relationships.
    You MUST output valid JSON ONLY, with no extra conversational text or formatting outside the JSON block.
    Format your output strictly like this:
    {
      "nodes": [{"id": "EntityName", "label": "Category"}],
      "edges": [{"source": "Entity1", "target": "Entity2", "relation": "relationship_description"}]
    }
    """

    for chunk in chunks:
        try:
            raw_content = await llm_client.extract_graph_json(chunk, system_prompt)
            parsed_data = clean_and_parse_llm_json(raw_content)

            # Add nodes safely with deduplication
            entity_map = {} # Maps original extracted ID to resolved ID
            
            for node in parsed_data.get("nodes", []):
                node_id = node.get("id")
                if node_id:
                    resolved_id = resolve_entity(node_id, list(session_node_ids))
                    entity_map[node_id] = resolved_id
                    
                    if resolved_id not in session_node_ids:
                        session_node_ids.add(resolved_id)
                        extracted_nodes.append({"id": resolved_id, "label": node.get("label", "Entity")})

            # Add edges safely using the resolved entity names
            for edge in parsed_data.get("edges", []):
                source = edge.get("source")
                target = edge.get("target")
                relation = edge.get("relation", "connected_to")
                if source and target:
                    resolved_source = entity_map.get(source) or resolve_entity(source, list(session_node_ids))
                    resolved_target = entity_map.get(target) or resolve_entity(target, list(session_node_ids))
                    
                    if resolved_source and resolved_target:
                        extracted_edges.append({
                            "source": resolved_source,
                            "target": resolved_target,
                            "relation": relation
                        })

        except TimeoutError:
            print("LLM request timed out while processing text chunk.")
        except Exception as e:
            print(f"Unexpected error processing chunk through LLM: {e}")

    return extracted_nodes, extracted_edges
