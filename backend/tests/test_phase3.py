import requests
import time

def test_async_upload():
    print("=" * 60)
    print("TESTING ASYNCHRONOUS BACKGROUND UPLOAD QUEUE")
    print("=" * 60)

    url = "http://127.0.0.1:8000/upload"
    test_text = (
        "Amazon Web Services (AWS) provides cloud computing infrastructure. "
        "Andy Jassy succeeded Jeff Bezos as the CEO of Amazon. "
        "Amazon Bedrock provides foundation models for generative AI."
    )
    files = {'file': ('aws_brief.txt', test_text.encode('utf-8'), 'text/plain')}
    
    t0 = time.time()
    res = requests.post(url, files=files)
    elapsed_post = round(time.time() - t0, 3)
    print(f"\n1. POST /upload returned in {elapsed_post}s (HTTP {res.status_code}):")
    data = res.json()
    print("   Response:", data)
    job_id = data.get("job_id")
    assert job_id, "No job_id returned!"
    assert elapsed_post < 2.0, "POST did not return immediately in non-blocking mode!"

    print(f"\n2. Polling /upload/status/{job_id}...")
    while True:
        s_res = requests.get(f"http://127.0.0.1:8000/upload/status/{job_id}")
        s = s_res.json()
        print(f"   [{s.get('progress')}%] Stage: {s.get('stage')} | Status: {s.get('status')}")
        if s.get("status") in ["completed", "failed"]:
            print(f"\n   Job finished in {round(time.time() - t0, 2)}s!")
            print(f"   Entities added: {s.get('nodes')}, Relationships added: {s.get('edges')}")
            assert s.get("status") == "completed", f"Job failed: {s.get('error')}"
            break
        time.sleep(2)

    print("\n" + "=" * 60)
    print("PHASE 3 ASYNC INGESTION QUEUE VERIFIED SUCCESSFULLY!")
    print("=" * 60)

if __name__ == "__main__":
    test_async_upload()

