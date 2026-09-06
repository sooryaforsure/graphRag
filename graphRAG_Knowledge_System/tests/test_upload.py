import requests
import time

print("Waiting a few seconds for the FastAPI server to initialize...")
time.sleep(3)

print("Attempting to upload a test document...")
sample_text = "Steve Jobs was the CEO of Apple Inc. Apple makes the iPhone. Tim Cook is the current CEO."

files = {'file': ('sample.txt', sample_text, 'text/plain')}

try:
    response = requests.post('http://localhost:8000/upload', files=files)
    print("Status Code:", response.status_code)
    print("Response Body:", response.json())
except Exception as e:
    print("Failed to connect or upload:", e)

