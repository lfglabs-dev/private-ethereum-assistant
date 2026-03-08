#!/bin/bash
set -e

echo "========================================="
echo "  Private Ethereum Assistant — Setup"
echo "========================================="
echo ""

# 1. Check for Ollama
if ! command -v ollama &> /dev/null; then
  echo "Ollama is not installed."
  echo "Installing via Homebrew..."
  if command -v brew &> /dev/null; then
    brew install ollama
  else
    echo "Please install Ollama manually: https://ollama.com/download"
    exit 1
  fi
else
  echo "✓ Ollama is installed"
fi

# 2. Start Ollama if not running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
  echo "Starting Ollama server..."
  ollama serve &
  sleep 3
else
  echo "✓ Ollama is already running"
fi

# 3. Pull model
MODEL=${LLM_MODEL:-llama3.1}
echo ""
echo "Pulling model: $MODEL (this may take a few minutes on first run)..."
ollama pull "$MODEL"
echo "✓ Model $MODEL is ready"

# 4. Install dependencies
echo ""
echo "Installing dependencies..."
if command -v bun &> /dev/null; then
  bun install
else
  echo "bun not found. Please install bun: https://bun.sh"
  exit 1
fi
echo "✓ Dependencies installed"

# 5. Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
  cp .env.local.example .env.local
  echo "✓ Created .env.local from example"
  echo "  Edit .env.local to customize your Safe address and other settings."
else
  echo "✓ .env.local already exists"
fi

# 6. Start dev server
echo ""
echo "========================================="
echo "  Starting Private Ethereum Assistant"
echo "  http://localhost:3000"
echo "========================================="
echo ""
bun dev
