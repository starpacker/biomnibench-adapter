#!/bin/bash
# 
# BioDSBench Combined Tasks - 一键启动脚本
# 这个脚本会引导你选择运行模式
#

clear

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║                                                                    ║"
echo "║        BioDSBench Combined Tasks - 快速启动向导                    ║"
echo "║                                                                    ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "✅ 已准备就绪: 13个combined任务 (118个子任务)"
echo "✅ Judge系统: 已验证通过"
echo ""
echo "请选择运行模式:"
echo ""
echo "  [1] 运行单个任务 (测试)"
echo "  [2] 批量运行所有任务 (前台)"
echo "  [3] 批量运行所有任务 (后台)"
echo "  [4] 查看任务列表"
echo "  [5] 查看详细文档"
echo "  [0] 退出"
echo ""
echo -n "请输入选项 [0-5]: "
read choice

case $choice in
    1)
        echo ""
        echo "可用任务:"
        echo "  1) 25303977_combined (8个子任务) - 已测试 ✅"
        echo "  2) 27959731_combined (10个子任务)"
        echo "  3) 28472509_combined (10个子任务)"
        echo "  4) 其他任务..."
        echo ""
        echo -n "请输入任务名称 (默认: 25303977_combined): "
        read task_name
        task_name=${task_name:-25303977_combined}
        
        echo ""
        echo "开始运行任务: $task_name"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        ./run_biodsbench.sh "$task_name"
        ;;
        
    2)
        echo ""
        echo "⚠️  警告: 批量运行将依次执行所有13个任务，预计耗时约4-5小时"
        echo -n "确认继续? (y/n): "
        read confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            echo ""
            echo "开始批量运行..."
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            ./run_all_combined_tasks.sh
        else
            echo "已取消"
        fi
        ;;
        
    3)
        echo ""
        echo "后台批量运行模式"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "任务将在后台运行，你可以关闭终端"
        echo ""
        echo "启动命令:"
        echo "  nohup ./run_all_combined_tasks.sh > batch_run.log 2>&1 &"
        echo ""
        echo "监控命令:"
        echo "  tail -f batch_run.log"
        echo "  tail -f logs/batch_runs/batch_run_*.log"
        echo ""
        echo -n "现在启动? (y/n): "
        read confirm
        if [[ "$confirm" =~ ^[Yy]$ ]]; then
            nohup ./run_all_combined_tasks.sh > batch_run.log 2>&1 &
            PID=$!
            echo ""
            echo "✅ 已启动后台任务 (PID: $PID)"
            echo ""
            echo "监控日志:"
            echo "  tail -f batch_run.log"
            echo ""
            echo "停止任务:"
            echo "  kill $PID"
            echo ""
            sleep 2
            echo "显示最新日志 (Ctrl+C退出):"
            tail -f batch_run.log
        else
            echo "已取消"
        fi
        ;;
        
    4)
        echo ""
        ./show_all_tasks.sh
        ;;
        
    5)
        echo ""
        cat COMBINED_TASKS_README.md | less
        ;;
        
    0)
        echo ""
        echo "再见！"
        exit 0
        ;;
        
    *)
        echo ""
        echo "❌ 无效选项"
        exit 1
        ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "完成！"
