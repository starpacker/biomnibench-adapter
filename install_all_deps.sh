#!/bin/bash
# 持续安装缺失的依赖直到评测能够启动

cd /home/yjh/my_claude

echo "开始自动安装缺失的依赖..."
echo "按 Ctrl+C 停止"
echo ""

count=0
max_count=50

while [ $count -lt $max_count ]; do
    count=$((count + 1))
    echo "=== 第 $count 次尝试 ==="
    
    # 运行评测并捕获输出
    output=$(timeout 30 /home/yjh/.bun/bin/bun src/harness/evaluation/cli.ts --task 25303977_0 --tasks-dir tasks --runs-dir output/Bio_runs --max-rounds 1 --timeout-seconds 60 --agent-runtime source 2>&1)
    
    # 检查是否成功启动（没有 "Cannot find" 错误）
    if ! echo "$output" | grep -q "Cannot find"; then
        echo "✓ 依赖安装完成！评测已启动或遇到其他错误"
        echo ""
        echo "最后的输出："
        echo "$output" | tail -20
        exit 0
    fi
    
    # 提取缺失的包名
    missing=$(echo "$output" | grep "Cannot find" | head -1)
    
    if echo "$missing" | grep -q "Cannot find package"; then
        pkg=$(echo "$missing" | sed -n "s/.*Cannot find package '\\([^']*\\)'.*/\\1/p")
    elif echo "$missing" | grep -q "Cannot find module"; then
        pkg=$(echo "$missing" | sed -n "s/.*Cannot find module '\\([^']*\\)'.*/\\1/p")
    else
        echo "无法解析错误信息："
        echo "$missing"
        exit 1
    fi
    
    if [ -z "$pkg" ]; then
        echo "无法提取包名"
        echo "$output" | grep "Cannot find"
        exit 1
    fi
    
    echo "缺失的包: $pkg"
    echo "正在安装..."
    
    /home/yjh/.bun/bin/bun add "$pkg"
    
    if [ $? -ne 0 ]; then
        echo "安装失败，尝试继续..."
    fi
    
    echo ""
done

echo "达到最大尝试次数 ($max_count)"
