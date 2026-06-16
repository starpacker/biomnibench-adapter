#!/bin/bash
set -e

echo "Setting up Conda environment for BioDSBench tasks..."

# Create a conda environment
ENV_NAME="biodsbench"

# Check if environment already exists
if conda env list | grep -q "^${ENV_NAME} "; then
    echo "Conda environment '$ENV_NAME' already exists. Activating it..."
    source /usr/local/anaconda3/bin/activate "$ENV_NAME"
else
    echo "Creating conda environment '$ENV_NAME'..."
    conda create -n "$ENV_NAME" python=3.10 -y
    source /usr/local/anaconda3/bin/activate "$ENV_NAME"
    
    # Install common dependencies for BioDSBench tasks
    echo "Installing common dependencies..."
    pip install pandas>=1.5 numpy>=1.23 scipy>=1.9 matplotlib>=3.6 seaborn>=0.12 \
        scikit-learn>=1.2 statsmodels>=0.14 lifelines>=0.27 PyComplexHeatmap>=1.8
fi

echo ""
echo "Conda environment setup complete!"
echo "Environment name: $ENV_NAME"
echo "Python executable: $(which python)"
echo "Python version: $(python --version)"
