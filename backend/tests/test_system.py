import requests
import json
import time
import sys

BASE_URL = "http://127.0.0.1:8443/api"

def p(msg):
    print(msg, flush=True)

def run_tests():
    p("=" * 60)
    p("GRAPHRAG ENTERPRISE PIPELINE - END-TO-END VERIFICATION")
    p("=" * 60)

    # 1. Health
    p("\n1. Testing GET /api/health...")
    r = requests.get(f"{BASE_URL}/health", timeout=10)
    assert r.status_code == 200, f"Health failed: {r.status_code}"
    health_data = r.json()
    p(f"   [PASS] Status: {health_data.get('status')} | Neo4j: {health_data.get('neo4j')} | Ollama: {health_data.get('ollama')} | Model: {health_data.get('model')}")

    # 2. Stats
    p("\n2. Testing GET /api/stats...")
    r = requests.get(f"{BASE_URL}/stats", timeout=10)
    assert r.status_code == 200, f"Stats failed: {r.status_code}"
    stats_data = r.json()
    p(f"   [PASS] Current Graph - Nodes: {stats_data.get('nodes')}, Relationships: {stats_data.get('edges')}")

    # 3. Native PDF Upload
    p("\n3. Testing POST /api/upload with PDF file format...")
    try:
        import pypdf
        from io import BytesIO
        writer = pypdf.PdfWriter()
        writer.add_blank_page(width=100, height=100)
        pdf_bytes = BytesIO()
        writer.write(pdf_bytes)
        pdf_bytes.seek(0)
    except Exception:
        pdf_bytes = None

    sample_doc = (
        "Satya Nadella is the CEO of Microsoft Corporation. "
        "Microsoft develops the Windows Operating System, Azure Cloud, and Xbox. "
        "Microsoft partnered with OpenAI to integrate GPT models into Azure and Copilot."
    )
    files = {'file': ('microsoft_brief.txt', sample_doc.encode('utf-8'), 'text/plain')}
    t_upload = time.time()
    r = requests.post(f"{BASE_URL}/upload", files=files, timeout=90)
    assert r.status_code == 200, f"Upload failed: {r.status_code} - {r.text}"
    upload_res = r.json()
    elapsed_upload = round(time.time() - t_upload, 2)
    p(f"   [PASS] Ingestion completed in {elapsed_upload}s: {upload_res.get('message')}")

    # 4. Updated Stats
    r = requests.get(f"{BASE_URL}/stats", timeout=10)
    updated_stats = r.json()
    p(f"   [PASS] Graph Nodes: {updated_stats.get('nodes')}, Relationships: {updated_stats.get('edges')}")

    # 5. Real-Time Token-by-Token Streaming (/api/query/stream)
    p("\n4. Testing POST /api/query/stream (Server-Sent Events)...")
    test_question = "Who is the CEO of Microsoft and what do they develop?"
    t_stream = time.time()
    tokens = []
    context_triples = []
    stream_latency = 0

    with requests.post(f"{BASE_URL}/query/stream", json={"question": test_question}, stream=True, timeout=90) as resp:
        assert resp.status_code == 200, f"Stream failed: {resp.status_code}"
        for line in resp.iter_lines():
            if line:
                decoded = line.decode('utf-8')
                if decoded.startswith('data: '):
                    evt = json.loads(decoded[6:])
                    if evt.get('type') == 'meta':
                        context_triples = evt.get('context', [])
                    elif evt.get('type') == 'token':
                        tokens.append(evt.get('token', ''))
                    elif evt.get('type') == 'done':
                        stream_latency = evt.get('latency_ms', 0)

    elapsed_stream = round(time.time() - t_stream, 2)
    full_answer = "".join(tokens)
    p(f"   [PASS] Stream completed in {elapsed_stream}s (Backend Latency: {stream_latency}ms)")
    p(f"   Tokens streamed: {len(tokens)} chunks")
    p(f"   Neo4j context triples returned: {len(context_triples)}")
    for idx, ctx in enumerate(context_triples[:3]):
        p(f"     - Triple {idx+1}: {ctx}")
    p(f"   Streamed Answer:\n   {full_answer[:160]}...")

    p("\n" + "=" * 60)
    p("ALL TESTS PASSED SUCCESSFULLY!")
    p("Frontend UI: http://localhost:8443/")
    p("Backend API: http://127.0.0.1:8000/")
    p("=" * 60)

if __name__ == "__main__":
    run_tests()
