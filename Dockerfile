FROM node:18-alpine

# Install dependencies for Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    xvfb \
    dbus \
    ttf-dejavu-core \
    fontconfig

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV DISPLAY=:99

# Create a non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Switch to non-root user
USER nextjs

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

EXPOSE 3023
CMD ["node", "title-targeted-scraper.js"]
