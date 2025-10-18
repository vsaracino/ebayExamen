#!/bin/bash
# Install Playwright browsers if not already installed
echo "Installing Playwright browsers..."
npx playwright install chromium

# Start the application
echo "Starting eBay Search App..."
node title-targeted-scraper.js
