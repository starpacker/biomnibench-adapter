#!/usr/bin/env python3
"""测试API连接和模型名称"""
import requests
import json

api_key = "00gcclg9l39y9p01000dhjzolag1q2hk00901kh1"
base_url = "https://api.gpugeek.com"
model = "Vendor2/Claude-4.7-opus"

url = f"{base_url.rstrip('/')}/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {api_key}",
}
body = {
    "model": model,
    "messages": [
        {"role": "user", "content": "Hello, respond with just 'OK'"}
    ],
    "temperature": 1,
    "max_tokens": 10,
}

print(f"测试API: {url}")
print(f"模型: {model}")
print()

try:
    resp = requests.post(url, headers=headers, json=body, timeout=30)
    print(f"状态码: {resp.status_code}")
    print(f"响应: {resp.text[:500]}")

    if resp.status_code == 200:
        data = resp.json()
        print(f"\n✅ API工作正常!")
        print(f"响应内容: {data['choices'][0]['message']['content']}")
    else:
        print(f"\n❌ API返回错误")

except Exception as e:
    print(f"❌ 请求失败: {e}")
