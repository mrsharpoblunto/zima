#!/bin/bash

set -e

echo "Checking for remote changes..."

git fetch

LOCAL=$(git rev-parse @)
REMOTE=$(git rev-parse @{u})

if [ $LOCAL = $REMOTE ]; then
    echo "Already up to date"
    exit 0
fi

echo "Remote changes detected, updating..."

if ! git diff-index --quiet HEAD --; then
    echo "Local changes detected, stashing..."
    git stash push -m "Auto-stash before update $(date)"
    STASHED=true
else
    STASHED=false
fi

echo "Pulling latest changes..."
git pull

if [ "$STASHED" = true ]; then
    echo "Re-applying stashed changes..."
    git stash pop
fi

echo "Installing dependencies..."
npm install

echo "Building client & server..."
npm run build:client
npm run build:server

echo "Restarting service..."
sudo systemctl restart zima

echo "Update complete!"
