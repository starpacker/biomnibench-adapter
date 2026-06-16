#!/bin/bash
set -e

echo "Setting up Python environment for BioDSBench tasks..."

# Create a shared virtual environment for all tasks
VENV_DIR="/home/yjh/my_claude/biodsbench_venv"

if [ ! -d "$VENV_DIR" ]; then
    echo "Creating virtual environment at $VENV_DIR..."
    python -m venv "$VENV_DIR"
fi

# Activate the virtual environment
source "$VENV_DIR/bin/activate"

# Upgrade pip
pip install --upgrade pip

# Install common dependencies for BioDSBench tasks
echo "Installing common dependencies..."
pip install pandas>=1.5 numpy>=1.23 scipy>=1.9 matplotlib>=3.6 seaborn>=0.12 \
    scikit-learn>=1.2 statsmodels>=0.14 lifelines>=0.27 PyComplexHeatmap>=1.8

echo ""
echo "Python environment setup complete!"
echo "Virtual environment location: $VENV_DIR"
echo "Python executable: $VENV_DIR/bin/python"
