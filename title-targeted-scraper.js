const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3023;

app.use(express.json());

// eBay API Configuration
const EBAY_API_BASE_URL = 'https://api.ebay.com/buy/browse/v1';
const EBAY_FINDING_API_URL = 'https://svcs.ebay.com/services/search/FindingService/v1';
// eBay OAuth Client Credentials for Browse API (2-hour expiry, but auto-refreshable)
const EBAY_CLIENT_ID = process.env.EBAY_CLIENT_ID;
const EBAY_CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;

// Check if environment variables are set
if (!EBAY_CLIENT_ID || !EBAY_CLIENT_SECRET) {
    console.error('❌ Missing eBay OAuth credentials!');
    console.error('Please set EBAY_CLIENT_ID and EBAY_CLIENT_SECRET environment variables.');
    process.exit(1);
}

// OAuth Token Management (auto-refreshable)
let currentToken = null;
let tokenExpiry = null;

// Function to get OAuth access token using Client Credentials
async function getEbayAccessToken() {
    try {
        console.log('🔄 Getting new eBay OAuth access token...');
        
        const response = await axios.post('https://api.ebay.com/identity/v1/oauth2/token', 
            'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${Buffer.from(`${EBAY_CLIENT_ID}:${EBAY_CLIENT_SECRET}`).toString('base64')}`
                }
            }
        );
        
        const tokenData = response.data;
        currentToken = tokenData.access_token;
        tokenExpiry = Date.now() + (tokenData.expires_in * 1000);
        
        console.log('✅ New OAuth token obtained, expires in', tokenData.expires_in, 'seconds');
        return currentToken;
    } catch (error) {
        console.error('❌ Failed to get OAuth token:', error.response?.data || error.message);
        throw error;
    }
}

// Function to refresh OAuth token if needed
async function refreshEbayToken() {
    try {
        // Check if token is still valid
        if (currentToken && tokenExpiry && Date.now() < tokenExpiry) {
            return currentToken;
        }
        
        // Get new token
        return await getEbayAccessToken();
    } catch (error) {
        console.error('❌ Token refresh failed:', error.message);
        throw error;
    }
}

// Function to make eBay API calls with OAuth Token (auto-refreshable)
async function makeEbayApiCall(url, params = {}, retryCount = 0) {
    const maxRetries = 1;
    
    try {
        // Ensure we have a valid token
        if (!currentToken || (tokenExpiry && Date.now() >= tokenExpiry)) {
            await refreshEbayToken();
        }
        
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${currentToken}`,
                'Content-Type': 'application/json',
                'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US' // Required for Browse API
            },
            params: params
        });
        
        return response;
    } catch (error) {
        // Check if it's a token expiration error (1001)
        if (error.response?.data?.errors?.[0]?.errorId === 1001 && retryCount < maxRetries) {
            console.log('🔄 OAuth token expired, attempting refresh...');
            
            try {
                // Try to refresh the token
                currentToken = await refreshEbayToken();
                
                // Retry the API call with new token
                console.log('🔄 Retrying API call with refreshed token...');
                return await makeEbayApiCall(url, params, retryCount + 1);
            } catch (refreshError) {
                console.error('❌ Token refresh failed:', refreshError.message);
                throw error; // Throw original error if refresh fails
            }
        }
        
        // If it's not a token error or we've exhausted retries, throw the error
        throw error;
    }
}

app.get('/api/scrape-active', async (req, res) => {
    const { keywords } = req.query;
    
    if (!keywords) {
        return res.json({ success: false, message: 'Keywords required' });
    }

    console.log(`🔍 Active listings search for: ${keywords}`);

    let browser;
    try {
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--memory-pressure-off',
                '--max_old_space_size=4096'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Navigate to eBay active search (no sold filter)
        const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&_sop=10`;
        console.log(`📡 Navigating to: ${searchUrl}`);
        
        await page.goto(searchUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get total results count
        const totalResults = await page.evaluate(() => {
            const resultsText = document.querySelector('.srp-controls__count-heading, .results-count, .srp-header__count');
            if (resultsText) {
                const text = resultsText.textContent;
                const match = text.match(/(\d+(?:,\d+)*)/);
                if (match) {
                    return parseInt(match[1].replace(/,/g, ''));
                }
            }
            return 0;
        });

        console.log(`📊 Total active results available: ${totalResults}`);

        // Extract active listings (just first page for analytics)
        const pageItems = await page.evaluate(() => {
            const items = [];
            
            // Find all title spans
            const titleSpans = document.querySelectorAll('span.su-styled-text.primary.default');
            console.log(`🔍 Found ${titleSpans.length} title spans on active page`);
            
            titleSpans.forEach((titleSpan, index) => {
                try {
                    const title = titleSpan.textContent.trim();
                    
                    // Filter out non-item entries (same as sold)
                    if (!title || 
                        title.length < 10 || 
                        title.includes('Shop on eBay') ||
                        title.includes('Sponsored') ||
                        title.includes('Brand New') ||
                        title.includes('See all') ||
                        title.includes('View') ||
                        title.includes('Filter') ||
                        title.includes('Sort') ||
                        title.includes('Category') ||
                        title.includes('Brand') ||
                        title.includes('Condition') ||
                        title.includes('Price') ||
                        title.includes('Location') ||
                        title.includes('Shipping') ||
                        title.includes('Buying Format') ||
                        title.includes('Show only') ||
                        title.includes('Min. Number') ||
                        title.includes('Game Type') ||
                        title.includes('Age Level') ||
                        title.includes('Item Location') ||
                        title.includes('delivery') ||
                        title.includes('Located') ||
                        title.includes('Free returns') ||
                        title.includes('Opens in') ||
                        title.includes('Was:') ||
                        title.includes('or Best Offer') ||
                        title.includes('Completed listings') ||
                        title.includes('Remove filter') ||
                        title.includes('Clear All') ||
                        title.includes('Filters') ||
                        title.includes('Live shopping') ||
                        title.includes('Join now') ||
                        title.includes('Sold') ||
                        title.includes('Oct') ||
                        title.includes('Nov') ||
                        title.includes('Dec') ||
                        title.includes('Jan') ||
                        title.includes('Feb') ||
                        title.includes('Mar') ||
                        title.includes('Apr') ||
                        title.includes('May') ||
                        title.includes('Jun') ||
                        title.includes('Jul') ||
                        title.includes('Aug') ||
                        title.includes('Sep') ||
                        // Filter out common navigation/category terms
                        title === 'Sennheiser' ||
                        title === 'audio tech' ||
                        title === 'audio-technica' ||
                        title === 'Dynamic Microphone' ||
                        title === 'Stand-Held' ||
                        title === 'Condenser Microphone' ||
                        title === 'Microphone Receiver' ||
                        title === 'Microphone System' ||
                        title === 'Microphone Only' ||
                        title === 'Table Array' ||
                        title === 'Personal Computer' ||
                        title === 'Smartphone' ||
                        title === 'Karaoke Machine' ||
                        title === 'Audio Mixer' ||
                        // Filter out single words that are likely categories
                        (title.length < 20 && !title.includes(' ') && !title.includes('-')) ||
                        // Filter out titles that are just brand names
                        title.match(/^[A-Z][a-z]+$/) ||
                        // Filter out titles that look like navigation elements
                        title.match(/^(New|Used|Refurbished|For Parts)$/i) ||
                        // Filter out titles that are just product categories
                        title.match(/^(Microphone|Audio|Computer|Phone|Machine|Mixer|System|Receiver|Array)$/i)) {
                        console.log(`❌ Filtered out non-item: "${title}"`);
                        return;
                    }
                    
                    // Find the parent container that contains both title and price
                    let parentContainer = titleSpan.closest('.s-item, .srp-item, .item, [data-view="item"], .s-item-wrapper, .s-item-container');
                    
                    if (!parentContainer) {
                        // If no specific container found, use the parent element
                        parentContainer = titleSpan.parentElement;
                        while (parentContainer && !parentContainer.textContent.includes('$')) {
                            parentContainer = parentContainer.parentElement;
                        }
                    }
                    
                    if (!parentContainer) {
                        console.log(`❌ No parent container found for title: "${title}"`);
                        return;
                    }
                    
                    // Look for price in the parent container
                    let price = '$0.00';
                    const priceSelectors = [
                        '.s-item__price',
                        '.item-price',
                        '.srp-item-price',
                        '[data-testid="item-price"]',
                        '.s-item__detail--primary',
                        '.s-item__detail',
                        '.price'
                    ];
                    
                    for (const priceSelector of priceSelectors) {
                        const priceEl = parentContainer.querySelector(priceSelector);
                        if (priceEl) {
                            const priceMatch = priceEl.textContent.match(/\$[\d,]+\.?\d*/);
                            if (priceMatch) {
                                price = priceMatch[0];
                                break;
                            }
                        }
                    }
                    
                    // If no price found with selectors, try to extract from container text
                    if (price === '$0.00') {
                        const containerText = parentContainer.textContent;
                        const priceMatch = containerText.match(/\$[\d,]+\.?\d*/);
                        if (priceMatch) {
                            price = priceMatch[0];
                        }
                    }
                    
                    // Skip if no valid price found
                    if (price === '$0.00') {
                        console.log(`❌ No price found for: "${title}"`);
                        return;
                    }
                    
                    // Determine condition
                    let condition = 'Used';
                    const containerText = parentContainer.textContent.toLowerCase();
                    if (containerText.includes('brand new') || containerText.includes('new condition')) {
                        condition = 'New';
                    } else if (containerText.includes('refurbished')) {
                        condition = 'Refurbished';
                    }
                    
                    items.push({
                        title: title,
                        price: price,
                        link: '#',
                        condition: condition,
                        soldDate: new Date().toISOString().split('T')[0]
                    });
                    
                    console.log(`✅ Found active listing ${index + 1}: "${title}" - ${price}`);
                    
                } catch (error) {
                    console.log(`❌ Error processing title span ${index}: ${error.message}`);
                }
            });
            
            console.log(`📊 Found ${items.length} valid active listings`);
            return items;
        });

        console.log(`📊 Active listings: Found ${pageItems.length} items`);

        // Calculate analytics for active listings
        const prices = pageItems.map(item => {
            const priceStr = item.price.replace(/[$,]/g, '');
            return parseFloat(priceStr) || 0;
        }).filter(p => p > 0);

        const newItems = pageItems.filter(item => item.condition.toLowerCase().includes('new'));
        const usedItems = pageItems.filter(item => item.condition.toLowerCase().includes('used'));

        const newPrices = newItems.map(item => {
            const priceStr = item.price.replace(/[$,]/g, '');
            return parseFloat(priceStr) || 0;
        }).filter(p => p > 0);

        const usedPrices = usedItems.map(item => {
            const priceStr = item.price.replace(/[$,]/g, '');
            return parseFloat(priceStr) || 0;
        }).filter(p => p > 0);

        const analytics = {
            total: {
                count: pageItems.length,
                highest: prices.length > 0 ? Math.max(...prices) : 0,
                lowest: prices.length > 0 ? Math.min(...prices) : 0,
                average: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
            },
            new: {
                count: newItems.length,
                highest: newPrices.length > 0 ? Math.max(...newPrices) : 0,
                lowest: newPrices.length > 0 ? Math.min(...newPrices) : 0,
                average: newPrices.length > 0 ? newPrices.reduce((a, b) => a + b, 0) / newPrices.length : 0
            },
            used: {
                count: usedItems.length,
                highest: usedPrices.length > 0 ? Math.max(...usedPrices) : 0,
                lowest: usedPrices.length > 0 ? Math.min(...usedPrices) : 0,
                average: usedPrices.length > 0 ? usedPrices.reduce((a, b) => a + b, 0) / usedPrices.length : 0
            }
        };

        res.json({
            success: true,
            message: `Found ${pageItems.length} active listings`,
            analytics: analytics,
            totalActive: pageItems.length
        });

    } catch (error) {
        console.error('Error:', error);
        res.json({
            success: false,
            message: `Active search failed: ${error.message}`,
            analytics: { 
                total: { count: 0, highest: 0, lowest: 0, average: 0 }, 
                new: { count: 0, highest: 0, lowest: 0, average: 0 }, 
                used: { count: 0, highest: 0, lowest: 0, average: 0 } 
            },
            totalActive: 0
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// Removed terminal output system for simplicity

app.get('/api/scrape-sold', async (req, res) => {
    const { keywords } = req.query;
    
    if (!keywords) {
        return res.json({ success: false, message: 'Keywords required' });
    }
    
    res.setHeader('Content-Type', 'application/json');


    console.log(`🔍 Title-targeted scraper searching for: ${keywords}`);

    let browser;
    
    try {
        console.log('🎭 Launching Playwright browser...');
        browser = await chromium.launch({ 
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=VizDisplayCompositor',
                '--memory-pressure-off',
                '--max_old_space_size=4096'
            ]
        });
        
        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        // Navigate to eBay sold search
        const searchUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keywords)}&LH_Sold=1&LH_Complete=1&_sop=10`;
        console.log(`📡 Navigating to: ${searchUrl}`);
        
        await page.goto(searchUrl, { 
            waitUntil: 'networkidle2',
            timeout: 30000 
        });

        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Get total results count
        const totalResults = await page.evaluate(() => {
            const resultsText = document.querySelector('.srp-controls__count-heading, .results-count, .srp-header__count');
            if (resultsText) {
                const text = resultsText.textContent;
                const match = text.match(/(\d+(?:,\d+)*)/);
                if (match) {
                    return parseInt(match[1].replace(/,/g, ''));
                }
            }
            return 0;
        });

        console.log(`📊 Total results available: ${totalResults}`);

        // Extract listings using the specific title selector with limited pagination for sample
        let allItems = [];
        let currentPage = 1;
        const maxPages = Math.min(3, Math.ceil(150 / 20)); // Limit to ~3 pages for 150 items sample
        
        while (currentPage <= maxPages && allItems.length < 150) {
            console.log(`📄 Scraping page ${currentPage}... (Sample: ${allItems.length}/150)`);
            
            const pageItems = await page.evaluate(() => {
                const items = [];
                
                // Find all title spans
                const titleSpans = document.querySelectorAll('span.su-styled-text.primary.default');
                console.log(`🔍 Found ${titleSpans.length} title spans on this page`);
                
                titleSpans.forEach((titleSpan, index) => {
                    try {
                        const title = titleSpan.textContent.trim();
                        
                        // Filter out only obvious non-item entries
                        if (!title || 
                            title.length < 10 || 
                            title.includes('Shop on eBay') ||
                            title.includes('See all') ||
                            title.includes('View') ||
                            title.includes('Filter') ||
                            title.includes('Sort') ||
                            title.includes('Category') ||
                            title.includes('Brand') ||
                            title.includes('Condition') ||
                            title.includes('Price') ||
                            title.includes('Location') ||
                            title.includes('Shipping') ||
                            title.includes('Buying Format') ||
                            title.includes('Show only') ||
                            title.includes('Min. Number') ||
                            title.includes('Game Type') ||
                            title.includes('Age Level') ||
                            title.includes('Item Location') ||
                            title.includes('Remove filter') ||
                            title.includes('Clear All') ||
                            title.includes('Filters') ||
                            title.includes('Live shopping') ||
                            title.includes('Join now') ||
                            // Filter out single words that are likely categories
                            (title.length < 20 && !title.includes(' ') && !title.includes('-')) ||
                            // Filter out titles that are just brand names
                            title.match(/^[A-Z][a-z]+$/) ||
                            // Filter out titles that look like navigation elements
                            title.match(/^(New|Used|Refurbished|For Parts)$/i) ||
                            // Filter out titles that are just product categories
                            title.match(/^(Microphone|Audio|Computer|Phone|Machine|Mixer|System|Receiver|Array)$/i)) {
                            console.log(`❌ Filtered out non-item: "${title}"`);
                            return;
                        }
                        
                        // Find the parent container that contains both title and price
                        let parentContainer = titleSpan.closest('.s-item, .srp-item, .item, [data-view="item"], .s-item-wrapper, .s-item-container');
                        
                        if (!parentContainer) {
                            // If no specific container found, use the parent element
                            parentContainer = titleSpan.parentElement;
                            while (parentContainer && !parentContainer.textContent.includes('$')) {
                                parentContainer = parentContainer.parentElement;
                            }
                        }
                        
                        if (!parentContainer) {
                            console.log(`❌ No parent container found for title: "${title}"`);
                            return;
                        }
                        
                        // Look for price in the parent container
                        let price = '$0.00';
                        const priceSelectors = [
                            '.s-item__price',
                            '.item-price',
                            '.srp-item-price',
                            '[data-testid="item-price"]',
                            '.s-item__detail--primary',
                            '.s-item__detail',
                            '.price'
                        ];
                        
                        for (const priceSelector of priceSelectors) {
                            const priceEl = parentContainer.querySelector(priceSelector);
                            if (priceEl) {
                                const priceMatch = priceEl.textContent.match(/\$[\d,]+\.?\d*/);
                                if (priceMatch) {
                                    price = priceMatch[0];
                                    break;
                                }
                            }
                        }
                        
                        // If no price found with selectors, try to extract from container text
                        if (price === '$0.00') {
                            const containerText = parentContainer.textContent;
                            const priceMatch = containerText.match(/\$[\d,]+\.?\d*/);
                            if (priceMatch) {
                                price = priceMatch[0];
                            }
                        }
                        
                        // Skip if no valid price found
                        if (price === '$0.00') {
                            console.log(`❌ No price found for: "${title}"`);
                            return;
                        }
                        
                        // Determine condition
                        let condition = 'Used';
                        const containerText = parentContainer.textContent.toLowerCase();
                        if (containerText.includes('brand new') || containerText.includes('new condition')) {
                            condition = 'New';
                        } else if (containerText.includes('refurbished')) {
                            condition = 'Refurbished';
                        }
                        
                        // Try to find the actual eBay URL
                        let itemUrl = '#';
                        const linkEl = parentContainer.querySelector('a[href*="ebay.com"]');
                        if (linkEl) {
                            itemUrl = linkEl.href;
                        }
                        
                        items.push({
                            title: title,
                            price: price,
                            link: itemUrl,
                            condition: condition,
                            soldDate: new Date().toISOString().split('T')[0]
                        });
                        
                        console.log(`✅ Found listing ${index + 1}: "${title}" - ${price}`);
                        
                    } catch (error) {
                        console.log(`❌ Error processing title span ${index}: ${error.message}`);
                    }
                });
                
                console.log(`📊 Found ${items.length} valid listings on this page`);
                return items;
            });
            
            allItems.push(...pageItems);
            console.log(`📊 Page ${currentPage}: Found ${pageItems.length} listings (Total: ${allItems.length})`);
            
            // Check if we have enough samples or no more items
            if (allItems.length >= 150) {
                console.log(`📊 Sample complete: ${allItems.length} items collected for pricing analysis`);
                break;
            }
            
            if (pageItems.length === 0) {
                console.log(`📄 No items found on page ${currentPage}, stopping pagination`);
                break;
            }
            
            // Navigate to next page
            if (currentPage < maxPages) {
                try {
                    const nextButton = await page.$('.pagination__next, .pagination-next, [aria-label="Next page"], .srp-pagination__next');
                    if (nextButton) {
                        const isDisabled = await page.evaluate(el => el.getAttribute('aria-disabled') === 'true', nextButton);
                        if (!isDisabled) {
                            await nextButton.click();
                            await new Promise(resolve => setTimeout(resolve, 3000));
                        } else {
                            console.log(`📄 Next button disabled on page ${currentPage}`);
                            break;
                        }
                    } else {
                        console.log(`📄 No next button found on page ${currentPage}`);
                        break;
                    }
                } catch (error) {
                    console.log(`📄 Error navigating to page ${currentPage + 1}: ${error.message}`);
                    break;
                }
            }
            
            currentPage++;
        }
        
        const pageItems = allItems;

        console.log(`📊 Sample: Found ${pageItems.length} listings for pricing analysis`);
        console.log(`📊 Total available: ${totalResults} sold listings`);
        
        // Calculate analytics based on sample
        const prices = pageItems.map(item => {
            const priceStr = item.price.replace(/[$,]/g, '');
            return parseFloat(priceStr) || 0;
        }).filter(p => p > 0);

        const newItems = pageItems.filter(item => item.condition.toLowerCase().includes('new'));
        const usedItems = pageItems.filter(item => item.condition.toLowerCase().includes('used'));
        
        // Calculate proportional estimates for New vs Used based on sample
        const sampleSize = pageItems.length;
        const newRatio = sampleSize > 0 ? newItems.length / sampleSize : 0;
        const usedRatio = sampleSize > 0 ? usedItems.length / sampleSize : 0;
        
        const estimatedNewCount = Math.round(totalResults * newRatio);
        const estimatedUsedCount = Math.round(totalResults * usedRatio);
        
        console.log(`📊 Sample breakdown: ${newItems.length} new, ${usedItems.length} used (${(newRatio*100).toFixed(1)}% new, ${(usedRatio*100).toFixed(1)}% used)`);
        console.log(`📊 Estimated totals: ${estimatedNewCount} new, ${estimatedUsedCount} used`);

        const newPrices = newItems.map(item => {
            const priceStr = item.price.replace(/[$,]/g, '');
            return parseFloat(priceStr) || 0;
        }).filter(p => p > 0);

        const usedPrices = usedItems.map(item => {
            const priceStr = item.price.replace(/[$,]/g, '');
            return parseFloat(priceStr) || 0;
        }).filter(p => p > 0);

        const analytics = {
            total: {
                count: totalResults, // Use actual total, not sample size
                highest: prices.length > 0 ? Math.max(...prices) : 0,
                lowest: prices.length > 0 ? Math.min(...prices) : 0,
                average: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
            },
            new: {
                count: estimatedNewCount, // Estimated total based on sample ratio
                highest: newPrices.length > 0 ? Math.max(...newPrices) : 0,
                lowest: newPrices.length > 0 ? Math.min(...newPrices) : 0,
                average: newPrices.length > 0 ? newPrices.reduce((a, b) => a + b, 0) / newPrices.length : 0
            },
            used: {
                count: estimatedUsedCount, // Estimated total based on sample ratio
                highest: usedPrices.length > 0 ? Math.max(...usedPrices) : 0,
                lowest: usedPrices.length > 0 ? Math.min(...usedPrices) : 0,
                average: usedPrices.length > 0 ? usedPrices.reduce((a, b) => a + b, 0) / usedPrices.length : 0
            }
        };

        res.json({
            success: true,
            message: `Found ${totalResults} total sold listings (analyzed ${pageItems.length} for pricing)`,
            analytics: analytics,
            items: pageItems,
            totalSold: totalResults
        });

    } catch (error) {
        console.error('Playwright failed:', error);
        res.json({
            success: false,
            message: `Scraping failed: ${error.message}`,
            analytics: { 
                total: { count: 0, highest: 0, lowest: 0, average: 0 }, 
                new: { count: 0, highest: 0, lowest: 0, average: 0 }, 
                used: { count: 0, highest: 0, lowest: 0, average: 0 } 
            },
            items: [],
            totalSold: 0
        });
    } finally {
        if (browser) {
            await browser.close();
        }
    }
});

// eBay API endpoint for Active listings
app.get('/api/ebay-active', async (req, res) => {
    const { keywords, limit = 50 } = req.query;
    
    if (!keywords) {
        return res.json({ success: false, message: 'Keywords required' });
    }

    console.log(`🔍 eBay API Active search for: ${keywords}`);

    try {
        // First, get the total count without pagination limits
        const countResponse = await makeEbayApiCall(`${EBAY_API_BASE_URL}/item_summary/search`, {
            q: keywords,
            limit: 1, // Just get 1 item to get the total count
            sort: 'price'
        });

        const totalCount = countResponse.data.total || 0;
        console.log(`📊 eBay Browse API total available: ${totalCount} active listings`);

        // Now get a representative sample for analytics (up to 150 items)
        let allItems = [];
        let offset = 0;
        const maxResults = Math.min(150, totalCount);
        const itemsPerPage = 50;
        
        while (allItems.length < maxResults && allItems.length < totalCount) {
            const response = await makeEbayApiCall(`${EBAY_API_BASE_URL}/item_summary/search`, {
                q: keywords,
                limit: Math.min(itemsPerPage, maxResults - allItems.length),
                sort: 'price',
                offset: offset
            });

            const pageItems = response.data.itemSummaries || [];
            console.log(`📊 eBay Browse API page ${Math.floor(offset/itemsPerPage) + 1}: found ${pageItems.length} active listings`);
            
            if (pageItems.length === 0) {
                console.log('📊 No more items found, stopping pagination');
                break;
            }
            
            allItems.push(...pageItems);
            offset += itemsPerPage;
            
            // Stop if we got fewer items than requested (last page)
            if (pageItems.length < itemsPerPage) {
                console.log('📊 Last page reached, stopping pagination');
                break;
            }
        }

        const items = allItems;
        console.log(`📊 eBay Browse API sampled ${items.length} items from ${totalCount} total active listings`);

        // Calculate analytics
        const prices = items.map(item => {
            const price = item.price?.value || 0;
            return parseFloat(price) || 0;
        }).filter(p => p > 0);

        const newItems = items.filter(item => 
            item.condition?.conditionId === '3000' || 
            item.condition?.conditionDisplayName?.toLowerCase().includes('new')
        );
        const usedItems = items.filter(item => 
            item.condition?.conditionId === '4000' || 
            item.condition?.conditionDisplayName?.toLowerCase().includes('used')
        );

        const newPrices = newItems.map(item => parseFloat(item.price?.value || 0)).filter(p => p > 0);
        const usedPrices = usedItems.map(item => parseFloat(item.price?.value || 0)).filter(p => p > 0);

        const analytics = {
            total: {
                count: totalCount, // Use real total count, not sampled count
                highest: prices.length > 0 ? Math.max(...prices) : 0,
                lowest: prices.length > 0 ? Math.min(...prices) : 0,
                average: prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
            },
            new: {
                count: Math.round((newItems.length / items.length) * totalCount), // Estimate based on sample
                highest: newPrices.length > 0 ? Math.max(...newPrices) : 0,
                lowest: newPrices.length > 0 ? Math.min(...newPrices) : 0,
                average: newPrices.length > 0 ? newPrices.reduce((a, b) => a + b, 0) / newPrices.length : 0
            },
            used: {
                count: Math.round((usedItems.length / items.length) * totalCount), // Estimate based on sample
                highest: usedPrices.length > 0 ? Math.max(...usedPrices) : 0,
                lowest: usedPrices.length > 0 ? Math.min(...usedPrices) : 0,
                average: usedPrices.length > 0 ? usedPrices.reduce((a, b) => a + b, 0) / usedPrices.length : 0
            }
        };

        // Format items for display
        const formattedItems = items.map(item => ({
            title: item.title,
            price: `$${parseFloat(item.price?.value || 0).toFixed(2)}`,
            link: item.itemWebUrl || '#',
            condition: item.condition?.conditionDisplayName || 'Unknown',
            image: item.image?.imageUrl || '',
            itemId: item.itemId,
            buyItNowPrice: item.price?.value ? `$${parseFloat(item.price.value).toFixed(2)}` : 'N/A',
            timeLeft: item.buyingOptions?.includes('AUCTION') ? 'Auction' : 'Buy It Now'
        }));

        res.json({
            success: true,
            message: `Found ${totalCount} total active listings via eBay API (sampled ${items.length} for analytics)`,
            analytics: analytics,
            items: formattedItems,
            totalActive: totalCount, // Real total count
            sampledActive: items.length, // Sample size for analytics
            source: 'eBay API'
        });

    } catch (error) {
        console.error('eBay API Error:', error.response?.data || error.message);
        res.json({
            success: false,
            message: `eBay API search failed: ${error.response?.data?.message || error.message}`,
            analytics: { 
                total: { count: 0, highest: 0, lowest: 0, average: 0 }, 
                new: { count: 0, highest: 0, lowest: 0, average: 0 }, 
                used: { count: 0, highest: 0, lowest: 0, average: 0 } 
            },
            items: [],
            totalActive: 0,
            source: 'eBay API'
        });
    }
});

app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>eBay eXamen</title>
            <style>
                body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    max-width: 1200px; 
                    margin: 0 auto; 
                    padding: 20px; 
                    background: #0d1117; 
                    color: #c9d1d9; 
                    line-height: 1.6;
                }
                h1 { color: #58a6ff; text-align: center; margin-bottom: 30px; }
                .search-box { 
                    margin: 30px 0; 
                    display: flex; 
                    gap: 15px; 
                    align-items: center;
                    justify-content: center;
                    flex-wrap: wrap;
                }
                input[type="text"] { 
                    width: 400px; 
                    max-width: 90vw; 
                    padding: 12px 16px; 
                    font-size: 16px; 
                    background: #21262d; 
                    border: 1px solid #30363d; 
                    border-radius: 8px; 
                    color: #c9d1d9; 
                    transition: all 0.2s ease;
                }
                input[type="text"]:focus { 
                    outline: none; 
                    border-color: #58a6ff; 
                    box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2); 
                }
                button { 
                    padding: 12px 24px; 
                    font-size: 16px; 
                    background: #238636; 
                    color: white; 
                    border: none; 
                    border-radius: 8px; 
                    cursor: pointer; 
                    transition: all 0.2s ease;
                }
                button:hover { background: #2ea043; }
                .results { margin-top: 30px; }
                .analytics { 
                    background: #161b22; 
                    padding: 20px; 
                    border-radius: 8px; 
                    border: 1px solid #30363d; 
                    margin-bottom: 20px;
                }
                .analytics h3 { color: #58a6ff; margin: 0 0 15px 0; }
                .analytics-grid { 
                    display: grid; 
                    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); 
                    gap: 20px; 
                    margin-top: 20px; 
                }
                .analytics-panel { 
                    background: #21262d; 
                    padding: 20px; 
                    border-radius: 8px; 
                    border: 1px solid #30363d; 
                }
                .analytics-panel h4 { 
                    color: #58a6ff; 
                    margin: 0 0 15px 0; 
                    font-size: 18px; 
                }
                .analytics-panel.used h4 { color: #ffd700; }
                .analytics-panel.new h4 { color: #3fb950; }
                .items-list { 
                    margin-top: 20px; 
                }
                .item-card { 
                    background: #21262d; 
                    padding: 15px; 
                    border-radius: 8px; 
                    border: 1px solid #30363d; 
                    margin-bottom: 10px; 
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                }
                .item-details { flex: 1; }
                .item-title { 
                    font-size: 16px; 
                    color: #58a6ff; 
                    margin-bottom: 5px; 
                    line-height: 1.4; 
                    text-decoration: none;
                    cursor: pointer;
                }
                .item-title:hover { 
                    text-decoration: underline; 
                    color: #79c0ff;
                }
                .item-price { 
                    font-size: 18px; 
                    font-weight: bold; 
                    color: #3fb950; 
                    margin-left: 20px; 
                }
                .item-condition { 
                    font-size: 12px; 
                    color: #8b949e; 
                    margin-top: 5px; 
                }
                @keyframes rainbow {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
                @media (max-width: 768px) {
                    .search-box { flex-direction: column; }
                    input[type="text"] { width: 100%; }
                    .analytics-grid { grid-template-columns: 1fr; }
                    .items-list { grid-template-columns: 1fr; }
                }
            </style>
        </head>
        <body>
            <h1>eBay eXamen</h1>
            
            <div class="search-box">
                <input type="text" id="searchInput" placeholder="Enter item title to search..." onkeypress="handleKeyPress(event)">
                <button onclick="searchBoth()">GO</button>
            </div>
            
            <div id="results"></div>
            
            <script>
                function handleKeyPress(event) {
                    if (event.key === 'Enter') {
                        searchBoth();
                    }
                }
                
                async function searchBoth() {
                    const keywords = document.getElementById('searchInput').value;
                    const resultsDiv = document.getElementById('results');

                    if (!keywords.trim()) {
                        resultsDiv.innerHTML = '<p style="color: #cc0000;">Please enter search terms.</p>';
                        return;
                    }

                    // Show initial status
                    resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><p>🔍 Starting comprehensive market analysis...</p></div>';

                    try {
                        // Start both searches with status updates
                        resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><p>📊 Analyzing sold listings from eBay history...</p><p>🛒 Checking current active listings via eBay API...</p></div>';

                        const [soldResponse, activeResponse] = await Promise.all([
                            fetch('/api/scrape-sold?keywords=' + encodeURIComponent(keywords)),
                            fetch('/api/ebay-active?keywords=' + encodeURIComponent(keywords))
                        ]);

                        resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><p>📈 Processing market data and calculating analytics...</p></div>';

                        const soldData = await soldResponse.json();
                        const activeData = await activeResponse.json();

                        displayBothResults(soldData, activeData);
                    } catch (error) {
                        resultsDiv.innerHTML = '<p style="color: #cc0000;">Error: ' + error.message + '</p>';
                    }
                }
                
                // Removed updateProgress function - not needed for simple status messages
                
                async function searchSold() {
                    const keywords = document.getElementById('searchInput').value;
                    const resultsDiv = document.getElementById('results');

                    if (!keywords.trim()) {
                        resultsDiv.innerHTML = '<p style="color: #cc0000;">Please enter search terms.</p>';
                        return;
                    }

                    resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><p>📊 Analyzing sold listings from eBay history...</p><p>⏳ This may take a moment as we scan through multiple pages...</p></div>';

                    try {
                        const response = await fetch('/api/scrape-sold?keywords=' + encodeURIComponent(keywords));
                        const data = await response.json();

                        if (data.success) {
                            displayResults(data);
                        } else {
                            resultsDiv.innerHTML = '<p style="color: #cc0000;">Error: ' + data.message + '</p>';
                        }
                    } catch (error) {
                        resultsDiv.innerHTML = '<p style="color: #cc0000;">Error: ' + error.message + '</p>';
                    }
                }
                
                async function searchActive() {
                    const keywords = document.getElementById('searchInput').value;
                    const resultsDiv = document.getElementById('results');

                    if (!keywords.trim()) {
                        resultsDiv.innerHTML = '<p style="color: #cc0000;">Please enter search terms.</p>';
                        return;
                    }

                    resultsDiv.innerHTML = '<div style="text-align: center; padding: 20px;"><p>🛒 Checking current active listings via eBay API...</p><p>📊 Getting real-time market data and pricing...</p></div>';

                    try {
                        const response = await fetch('/api/ebay-active?keywords=' + encodeURIComponent(keywords));
                        const data = await response.json();

                        if (data.success) {
                            displayActiveResults(data);
                        } else {
                            resultsDiv.innerHTML = '<p style="color: #cc0000;">Error: ' + data.message + '</p>';
                        }
                    } catch (error) {
                        resultsDiv.innerHTML = '<p style="color: #cc0000;">Error: ' + error.message + '</p>';
                    }
                }
                
                function displayResults(data) {
                    const resultsDiv = document.getElementById('results');
                    
                    let html = '<div class="analytics">' +
                        '<h3>📊 Sold Listings Analytics</h3>' +
                        '<div class="analytics-grid">' +
                            '<div class="analytics-panel used">' +
                                '<h4>🔧 Used Items</h4>' +
                                '<p><strong>Used Listings:</strong> ' + data.analytics.used.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + data.analytics.used.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + data.analytics.used.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + data.analytics.used.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel new">' +
                                '<h4>🆕 New Items</h4>' +
                                '<p><strong>New Listings:</strong> ' + data.analytics.new.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + data.analytics.new.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + data.analytics.new.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + data.analytics.new.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel">' +
                                '<h4>📈 Total Sold</h4>' +
                                '<p><strong>Total Listings:</strong> ' + data.analytics.total.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + data.analytics.total.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + data.analytics.total.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + data.analytics.total.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="items-list">';
                    
                    data.items.forEach(item => {
                        html += '<div class="item-card">' +
                            '<div class="item-details">' +
                                '<a href="' + item.link + '" target="_blank" class="item-title">' + item.title + '</a>' +
                                '<div class="item-condition">' + item.condition + '</div>' +
                            '</div>' +
                            '<div class="item-price">' + item.price + '</div>' +
                        '</div>';
                    });
                    
                    html += '</div>';
                    resultsDiv.innerHTML = html;
                }
                
                function displayActiveResults(data) {
                    const resultsDiv = document.getElementById('results');
                    
                    let html = '<div class="analytics">' +
                        '<h3>🛒 Active Listings Analytics</h3>' +
                        '<div class="analytics-grid">' +
                            '<div class="analytics-panel used">' +
                                '<h4>🔧 Used Items</h4>' +
                                '<p><strong>Used Listings:</strong> ' + data.analytics.used.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + data.analytics.used.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + data.analytics.used.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + data.analytics.used.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel new">' +
                                '<h4>🆕 New Items</h4>' +
                                '<p><strong>New Listings:</strong> ' + data.analytics.new.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + data.analytics.new.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + data.analytics.new.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + data.analytics.new.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel">' +
                                '<h4>🛒 Total Active</h4>' +
                                '<p><strong>Total Listings:</strong> ' + data.analytics.total.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + data.analytics.total.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + data.analytics.total.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + data.analytics.total.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="items-list">';
                    
                    data.items.forEach(item => {
                        html += '<div class="item-card">' +
                            '<div class="item-details">' +
                                '<a href="' + item.link + '" target="_blank" class="item-title">' + item.title + '</a>' +
                                '<div class="item-condition">' + item.condition + ' • ' + item.timeLeft + '</div>' +
                            '</div>' +
                            '<div class="item-price">' + item.price + '</div>' +
                        '</div>';
                    });
                    
                    html += '</div>';
                    resultsDiv.innerHTML = html;
                }
                
                function displayProductionResults(activeData) {
                    const resultsDiv = document.getElementById('results');
                    
                    let html = '<div class="analytics">' +
                        '<h3>🛒 Active Listings Analytics (Production Mode)</h3>' +
                        '<div style="background: #f0f8ff; border: 1px solid #58a6ff; border-radius: 8px; padding: 15px; margin-bottom: 20px; text-align: center;">' +
                            '<p style="color: #58a6ff; margin: 0;"><strong>ℹ️ Production Environment</strong></p>' +
                            '<p style="color: #666; margin: 5px 0 0 0; font-size: 14px;">Sold listings analysis is not available in production. Only active listings are shown.</p>' +
                        '</div>' +
                        '<div class="analytics-grid">' +
                            '<div class="analytics-panel">' +
                                '<h4>🛒 Active Listings</h4>' +
                                '<p><strong>Total Listings:</strong> ' + activeData.analytics.total.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + activeData.analytics.total.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + activeData.analytics.total.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + activeData.analytics.total.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    '<div class="items-list">' +
                        '<h3>🛒 Active Listings</h3>';
                    
                    activeData.items.forEach(item => {
                        html += '<div class="item-card">' +
                            '<div class="item-details">' +
                                '<a href="' + item.link + '" target="_blank" class="item-title">' + item.title + '</a>' +
                                '<div class="item-condition">' + item.condition + ' • ' + item.timeLeft + '</div>' +
                            '</div>' +
                            '<div class="item-price">' + item.price + '</div>' +
                        '</div>';
                    });
                    
                    html += '</div>';
                    resultsDiv.innerHTML = html;
                }
                
                function displayBothResults(soldData, activeData) {
                    const resultsDiv = document.getElementById('results');
                    
                    // Store sold data globally for expand functionality
                    window.currentSoldData = soldData;
                    
                    let html = '<div class="analytics">' +
                        '<h3>📊 Complete Analytics</h3>' +
                        '<div class="analytics-grid">' +
                            '<div class="analytics-panel used">' +
                                '<h4>🔧 Used Items (Sold)</h4>' +
                                '<p><strong>Used Listings:</strong> ' + soldData.analytics.used.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + soldData.analytics.used.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + soldData.analytics.used.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + soldData.analytics.used.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel new">' +
                                '<h4>🆕 New Items (Sold)</h4>' +
                                '<p><strong>New Listings:</strong> ' + soldData.analytics.new.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + soldData.analytics.new.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + soldData.analytics.new.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + soldData.analytics.new.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel">' +
                                '<h4>📈 Total Sold</h4>' +
                                '<p><strong>Total Listings:</strong> ' + soldData.analytics.total.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + soldData.analytics.total.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + soldData.analytics.total.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + soldData.analytics.total.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                            '<div class="analytics-panel" style="border: 2px solid #58a6ff;">' +
                                '<h4>🛒 Active Listings</h4>' +
                                '<p><strong>Total Active:</strong> ' + activeData.analytics.total.count + '</p>' +
                                '<p><strong>Average Price:</strong> $' + activeData.analytics.total.average.toFixed(2) + '</p>' +
                                '<p><strong>Highest Price:</strong> $' + activeData.analytics.total.highest.toFixed(2) + '</p>' +
                                '<p><strong>Lowest Price:</strong> $' + activeData.analytics.total.lowest.toFixed(2) + '</p>' +
                            '</div>' +
                        '</div>' +
                    '</div>' +
                    
                    // Calculate and display sell-through rate within analytics
                    (() => {
                        const totalSold = soldData.totalSold || soldData.analytics.total.count;
                        const totalActive = activeData.totalActive || activeData.analytics.total.count;
                        const sellThroughRate = totalActive > 0 ? (totalSold / totalActive) * 100 : 0;
                        
                        // Determine color based on sellthrough rate
                        let color, bgColor;
                        if (sellThroughRate < 20) {
                            color = '#f85149'; // Red
                            bgColor = '#21262d';
                        } else if (sellThroughRate >= 20 && sellThroughRate <= 50) {
                            color = '#ffa500'; // Orange
                            bgColor = '#21262d';
                        } else if (sellThroughRate >= 51 && sellThroughRate <= 99) {
                            color = '#3fb950'; // Green
                            bgColor = '#21262d';
                        } else if (sellThroughRate >= 100) {
                            // Rainbow effect using CSS animation
                            color = 'transparent';
                            bgColor = '#21262d';
                        } else {
                            color = '#58a6ff'; // Default blue
                            bgColor = '#21262d';
                        }
                        
                        const rainbowStyle = sellThroughRate >= 100 ? 
                            'background: linear-gradient(45deg, #ff0000, #ff7f00, #ffff00, #00ff00, #0000ff, #4b0082, #9400d3); background-size: 400% 400%; animation: rainbow 2s ease infinite; -webkit-background-clip: text; -webkit-text-fill-color: transparent;' : '';
                        
                        return '<div class="analytics-panel" style="border: 1px solid ' + (sellThroughRate >= 100 ? '#58a6ff' : color) + '; background: ' + bgColor + '; text-align: center; padding: 15px; max-width: 200px; margin: 0 auto;">' +
                            '<h4 style="color: #58a6ff; margin: 0 0 8px 0; font-size: 14px;">📊 Sellthrough Rate</h4>' +
                            '<div style="font-size: 20px; font-weight: bold; color: ' + color + '; margin: 3px 0; ' + rainbowStyle + '">' + sellThroughRate.toFixed(1) + '%</div>' +
                            '<div style="color: #8b949e; font-size: 10px;">' + totalSold.toLocaleString() + ' sold ÷ ' + totalActive.toLocaleString() + ' active</div>' +
                        '</div>';
                    })() +
                    '</div>' +
                    
                    '<div class="items-list">' +
                        '<h3>📈 Sold Listings (Recent Sales)</h3>';
                    
                    // Show only first 10 sold items
                    const soldItemsToShow = soldData.items.slice(0, 10);
                    soldItemsToShow.forEach(item => {
                        html += '<div class="item-card">' +
                            '<div class="item-details">' +
                                '<a href="' + item.link + '" target="_blank" class="item-title">' + item.title + '</a>' +
                                '<div class="item-condition">' + item.condition + '</div>' +
                            '</div>' +
                            '<div class="item-price">' + item.price + '</div>' +
                        '</div>';
                    });
                    
                    // Add expand button if there are more items
                    if (soldData.items.length > 10) {
                        html += '<div style="text-align: center; margin: 20px 0;">' +
                            '<button onclick="expandSoldList()" style="padding: 10px 20px; background: #58a6ff; color: white; border: none; border-radius: 5px; cursor: pointer;">' +
                                'Show All ' + soldData.items.length + ' Sold Listings' +
                            '</button>' +
                        '</div>';
                    }
                    
                    html += '</div>';
                    resultsDiv.innerHTML = html;
                }
                
                function expandSoldList() {
                    // Get all sold items and replace the current display
                            const allItems = window.currentSoldData.items;
                    let html = '<h3>📈 Sold Listings (All ' + allItems.length + ' Items)</h3>';
                    
                            allItems.forEach((item, index) => {
                        html += '<div class="item-card">' +
                            '<div class="item-details">' +
                                '<a href="' + item.link + '" target="_blank" class="item-title">' + item.title + '</a>' +
                                '<div class="item-condition">' + item.condition + '</div>' +
                                    '</div>' +
                            '<div class="item-price">' + item.price + '</div>' +
                                '</div>';
                            });
                    
                    // Find the items list container and replace its content
                    const itemsList = document.querySelector('.items-list');
                    if (itemsList) {
                            itemsList.innerHTML = html;
                    }
                            
                            // Hide the expand button
                            const expandButton = document.querySelector('button[onclick="expandSoldList()"]');
                            if (expandButton) {
                                expandButton.style.display = 'none';
                    }
                }
            </script>
        </body>
        </html>
    `);
});

app.listen(PORT, () => {
    console.log(`🔍 Title-Targeted eBay Scraper running at http://localhost:${PORT}`);
    console.log(`📱 Targets: span.su-styled-text.primary.default`);
    console.log(`🔗 Test: http://localhost:${PORT}`);
});
