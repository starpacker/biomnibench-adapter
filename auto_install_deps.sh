#!/bin/bash
# 自动检测并安装缺失的依赖

cd /home/yjh/my_claude

MAX_ATTEMPTS=20
attempt=0

while [ $attempt -lt $MAX_ATTEMPTS ]; do
    echo "=== 尝试 $((attempt + 1))/$MAX_ATTEMPTS ==="
    
    # 运行评测并捕获输出
    output=$(timeout 30 ./run_biodsbench.sh 25303977_0 2>&1)
    
    # 检查是否有 "Cannot find" 错误
    if echo "$output" | grep -q "Cannot find"; then
        # 提取缺失的包名
        missing_pkg=$(echo "$output" | grep "Cannot find" | sed -n "s/.*Cannot find.*['\"]\\([^'\"]*\\)['\"].*/\\1/p" | head -1)
        
        if [ -n "$missing_pkg" ]; then
            echo "检测到缺失的包: $missing_pkg"
            echo "正在安装..."
            /home/yjh/.bun/bin/bun add "$missing_pkg"
            attempt=$((attempt + 1))
        else
            echo "无法解析缺失的包名"
            echo "$output"
            break
        fi
    else
        echo "没有发现缺失的依赖！"
        echo "评测已启动或遇到其他错误"
        echo "$output"
        break
    fi
done

if [ $attempt -eq $MAX_ATTEMPTS ]; then
    echo "达到最大尝试次数，可能还有其他问题"
fi
