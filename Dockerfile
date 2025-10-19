FROM ghcr.io/puppeteer/puppeteer:21.11.0

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application files
COPY . .

# Expose port
EXPOSE 3023

# Start the application
CMD ["node", "title-targeted-scraper.js"]
