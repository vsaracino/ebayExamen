# eBay Search App - Deployment Guide

## Quick Deploy to Railway (Recommended)

### Step 1: Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Connect your GitHub account

### Step 2: Deploy from GitHub
1. In Railway dashboard, click "New Project"
2. Select "Deploy from GitHub repo"
3. Choose this repository
4. Railway will automatically detect it's a Node.js app
5. Click "Deploy"

### Step 3: Configure Environment (Optional)
- Railway will automatically set PORT environment variable
- No additional configuration needed for basic deployment

### Step 4: Access Your App
- Railway will provide a URL like: `https://your-app-name.railway.app`
- This URL will work on mobile devices

## Alternative Deployment Options

### Heroku
1. Install Heroku CLI
2. `heroku create your-app-name`
3. `git push heroku main`
4. Cost: $7-25/month

### DigitalOcean App Platform
1. Connect GitHub repo
2. Select Node.js buildpack
3. Set start command: `node title-targeted-scraper.js`
4. Cost: $5-12/month

### Vercel (Free Tier Available)
1. Connect GitHub repo
2. Deploy automatically
3. Cost: $0-20/month (free tier available)

## Mobile Access
Once deployed, you can access the app from any device using the provided URL. The app is fully responsive and works on mobile browsers.

## Cost Estimates
- **Railway**: $5-10/month
- **Heroku**: $7-25/month  
- **DigitalOcean**: $5-12/month
- **Vercel**: $0-20/month (free tier available)

## Troubleshooting
- If Puppeteer fails in cloud environment, the app will still work for API-based searches
- Cloud environments may have memory limitations for web scraping
