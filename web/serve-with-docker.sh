#!/bin/bash
# Serve Luanti web build with nginx in Docker
# This script builds a simple nginx container and serves the web build

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_ROOT/build-web/output"

echo -e "${GREEN}=== Luanti Web Server (nginx) ===${NC}"
echo ""

# Check if build-web/output exists
if [ ! -d "$OUTPUT_DIR" ]; then
    echo -e "${RED}Error: build-web/output directory not found!${NC}"
    echo "Please run ./web/build-with-docker.sh first to build the web version."
    exit 1
fi

# Check if output files exist
if [ ! -f "$OUTPUT_DIR/luanti.wasm" ] || [ ! -f "$OUTPUT_DIR/index.html" ]; then
    echo -e "${RED}Error: Required files not found in build-web/output/${NC}"
    echo "Please run ./web/build-with-docker.sh first to build the web version."
    exit 1
fi

echo "Build artifacts found:"
ls -lh "$OUTPUT_DIR/" | tail -n +2
echo ""

# Build the server image
echo -e "${YELLOW}Building nginx server image...${NC}"
docker build -f "$SCRIPT_DIR/Dockerfile.serve" -t luanti-web-server:latest "$PROJECT_ROOT"

echo ""
echo -e "${GREEN}=== Starting Web Server ===${NC}"
echo ""
echo "Server will be available at: ${GREEN}http://localhost:8080${NC}"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Run the server
docker run --rm -p 8080:8080 luanti-web-server:latest

