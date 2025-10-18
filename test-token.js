const axios = require('axios');

// This file is for testing OAuth tokens - not used in main application
// Remove this file if not needed for development

const token = process.env.EBAY_OAUTH_TOKEN;

async function testToken() {
    if (!token) {
        console.log('❌ EBAY_OAUTH_TOKEN environment variable not set');
        console.log('Note: This is only needed for token testing, not main app');
        return;
    }
    
    try {
        console.log('🧪 Testing eBay OAuth token...');
        
        const response = await axios.get('https://api.ebay.com/buy/browse/v1/item_summary/search', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            params: {
                q: 'test',
                limit: 1
            }
        });
        
        console.log('✅ Token works! Response:', response.data);
    } catch (error) {
        console.log('❌ Token failed:');
        console.log('Status:', error.response?.status);
        console.log('Error:', error.response?.data);
    }
}

testToken();
