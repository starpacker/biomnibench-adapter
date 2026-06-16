#!/usr/bin/env python3
"""测试不同的API端点格式"""
import requests
import json

api_key = "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
base_url = "https://api.gpugeek.com"
model = "Vendor2/Claude-4.7-opus"

# 尝试不同的端点
endpoints = [
    "/chat/completions",
    "/v1/chat/completions",
    "/api/chat/completions",
    "/openai/v1/chat/completions",
]

body = {
    "model": model,
    "messages": [{"role": "user", "content": "Hello"}],
    "temperature": 1,
    "max_tokens": 10,
}

for endpoint in endpoints:
    url = f"{base_url.rstrip('/')}{endpoint}"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
    }

    print(f"尝试: {url}")

    try:
        resp = requests.post(url, headers=headers, json=body, timeout=10)
        print(f"  状态码: {resp.status_code}")

        if resp.status_code == 200:
            print(f"  ✅ 成功! 正确的端点是: {endpoint}")
            print(f"  响应: {resp.json()['choices'][0]['message']['content']}")
            break
        elif resp.status_code == 404:
            print(f"  ❌ 404 - {resp.text[:100]}")
        else:
            print(f"  ⚠️  {resp.status_code} - {resp.text[:100]}")
    except Exception as e:
        print(f"  ❌ 错误: {e}")

    print()
