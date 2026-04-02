/**
 * Wi-Fi Amazon Money - Backend API
 * By Juan Camilo Villada - Wifi Money Group
 * 
 * CORREGIDO: Extrae datos reales de Easyparser
 * - bought_activity.value = ventas mensuales
 * - bestsellers_rank = BSR real
 * - ratings_total = reviews
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache: TTL de 24 horas
const cache = new NodeCache({ 
  stdTTL: 86400,
  checkperiod: 600 
});

// Middleware
app.use(cors());
app.use(express.json());

// Easyparser API config
const EASYPARSER_API_KEY = process.env.EASYPARSER_API_KEY;

// ============================================
// EASYPARSER API FUNCTIONS
// ============================================

async function fetchProductFromEasyparser(asin, marketplace = 'US') {
  const cacheKey = `product_${marketplace}_${asin}`;
  
  // Check cache first
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${asin}`);
    return { ...cached, fromCache: true };
  }
  
  console.log(`[API CALL] Fetching ${asin} from Easyparser...`);
  
  try {
    const domain = getDomainFromMarketplace(marketplace);
    const url = `https://realtime.easyparser.com/v1/request?api_key=${EASYPARSER_API_KEY}&platform=AMZ&operation=DETAIL&domain=${domain}&asin=${asin}`;
    
    console.log(`[URL] ${url.replace(EASYPARSER_API_KEY, 'API_KEY_HIDDEN')}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API ERROR] ${response.status}: ${errorText}`);
      return null;
    }
    
    const data = await response.json();
    
    // Check if successful
    if (!data.result || !data.result.detail) {
      console.error(`[API ERROR] No result.detail for ${asin}`);
      console.log(`[DEBUG] Response keys:`, Object.keys(data));
      return null;
    }
    
    // Transform to our format
    const productData = transformEasyparserData(data.result.detail, asin);
    
    // Cache the result
    cache.set(cacheKey, productData);
    console.log(`[CACHED] ${asin} - Sales: ${productData.monthlySales}, BSR: ${productData.bsr}`);
    
    return { ...productData, fromCache: false };
    
  } catch (error) {
    console.error(`[ERROR] Failed to fetch ${asin}:`, error.message);
    return null;
  }
}

function getDomainFromMarketplace(marketplace) {
  const domains = {
    'US': '.com',
    'MX': '.com.mx',
    'ES': '.es',
    'UK': '.co.uk',
    'DE': '.de',
    'CA': '.ca',
    'FR': '.fr',
    'IT': '.it',
    'JP': '.co.jp'
  };
  return domains[marketplace] || '.com';
}

function transformEasyparserData(detail, asin) {
  // Extract monthly sales from bought_activity
  let monthlySales = 0;
  if (detail.bought_activity && detail.bought_activity.value) {
    monthlySales = parseInt(detail.bought_activity.value) || 0;
  }
  
  // Extract BSR from bestsellers_rank array
  let bsr = null;
  if (detail.bestsellers_rank && detail.bestsellers_rank.length > 0) {
    bsr = detail.bestsellers_rank[0].rank;
  }
  
  // Extract price from buybox_winner
  let price = 0;
  if (detail.buybox_winner && detail.buybox_winner.price) {
    price = parseFloat(detail.buybox_winner.price.value) || 0;
  }
  
  // Extract rating
  let rating = 0;
  if (detail.rating) {
    rating = parseFloat(detail.rating) || 0;
  }
  
  // Extract reviews count
  let reviews = 0;
  if (detail.ratings_total) {
    reviews = parseInt(detail.ratings_total) || 0;
  }
  
  // Check if FBA
  let isFBA = false;
  if (detail.buybox_winner && detail.buybox_winner.seller_type) {
    isFBA = detail.buybox_winner.seller_type.fba === true;
  }
  
  // Calculate daily sales
  const dailySales = Math.round(monthlySales / 30 * 10) / 10;
  
  // Calculate monthly revenue
  const monthlyRevenue = Math.round(price * monthlySales);
  
  // Get main image
  let image = '';
  if (detail.main_image && detail.main_image.link) {
    image = detail.main_image.link;
  }
  
  // Get category
  let category = '';
  if (detail.bestsellers_rank && detail.bestsellers_rank.length > 0) {
    category = detail.bestsellers_rank[0].category;
  }
  
  return {
    asin: asin,
    title: detail.title || '',
    price: price,
    currency: 'USD',
    rating: rating,
    reviews: reviews,
    bsr: bsr,
    category: category,
    monthlySales: monthlySales,
    dailySales: dailySales,
    monthlyRevenue: monthlyRevenue,
    isFBA: isFBA,
    isPrime: detail.buybox_winner?.seller_type?.is_prime || false,
    seller: detail.buybox_winner?.seller_type?.third_party_seller?.name || '',
    brand: detail.brand || '',
    image: image,
    url: `https://amazon.com/dp/${asin}`,
    boughtActivity: detail.bought_activity?.raw || '',
    fetchedAt: new Date().toISOString()
  };
}

// Calculate product score
function calculateScore(product) {
  let score = 0;
  
  // Sales Score (max 40) - based on actual monthly sales
  if (product.monthlySales) {
    if (product.monthlySales >= 10000) score += 40;
    else if (product.monthlySales >= 5000) score += 35;
    else if (product.monthlySales >= 2000) score += 30;
    else if (product.monthlySales >= 1000) score += 25;
    else if (product.monthlySales >= 500) score += 20;
    else if (product.monthlySales >= 100) score += 15;
    else if (product.monthlySales >= 50) score += 10;
    else score += 5;
  }
  
  // Rating Score (max 25)
  if (product.rating) {
    if (product.rating >= 4.5) score += 25;
    else if (product.rating >= 4.0) score += 20;
    else if (product.rating >= 3.5) score += 12;
    else score += 5;
  }
  
  // Price Score (max 20) - sweet spot $15-$50
  if (product.price) {
    if (product.price >= 15 && product.price <= 50) score += 20;
    else if (product.price >= 10 && product.price <= 75) score += 15;
    else if (product.price >= 5 && product.price <= 100) score += 10;
    else score += 5;
  }
  
  // Reviews Score (max 10)
  if (product.reviews) {
    if (product.reviews > 1000) score += 10;
    else if (product.reviews > 500) score += 8;
    else if (product.reviews > 100) score += 5;
    else score += 2;
  }
  
  // FBA bonus (max 5)
  if (product.isFBA) score += 5;
  
  return Math.min(100, score);
}

// ============================================
// API ROUTES
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'Wi-Fi Amazon Money API',
    version: '2.0.0',
    cacheStats: cache.getStats()
  });
});

// Get single product
app.get('/api/product/:asin', async (req, res) => {
  const { asin } = req.params;
  const marketplace = req.query.marketplace || 'US';
  
  if (!asin || asin.length !== 10) {
    return res.status(400).json({ error: 'Invalid ASIN' });
  }
  
  const product = await fetchProductFromEasyparser(asin, marketplace);
  
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  
  // Add score
  product.score = calculateScore(product);
  product.verdict = product.score >= 75 ? 'GANADOR' : 
                    product.score >= 55 ? 'POTENCIAL' : 
                    product.score >= 35 ? 'ANALIZAR' : 'RIESGO';
  
  res.json(product);
});

// Batch analyze products
app.post('/api/products/batch', async (req, res) => {
  const { asins, marketplace = 'US' } = req.body;
  
  if (!asins || !Array.isArray(asins)) {
    return res.status(400).json({ error: 'asins array required' });
  }
  
  if (asins.length > 50) {
    return res.status(400).json({ error: 'Max 50 ASINs per request' });
  }
  
  console.log(`[BATCH] Processing ${asins.length} ASINs...`);
  
  const results = [];
  let cacheHits = 0;
  let apiCalls = 0;
  
  // Process in parallel with limit of 3 concurrent
  const BATCH_SIZE = 3;
  for (let i = 0; i < asins.length; i += BATCH_SIZE) {
    const batch = asins.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(asin => fetchProductFromEasyparser(asin, marketplace))
    );
    
    for (const product of batchResults) {
      if (product) {
        if (product.fromCache) cacheHits++;
        else apiCalls++;
        
        product.score = calculateScore(product);
        product.verdict = product.score >= 75 ? 'GANADOR' : 
                          product.score >= 55 ? 'POTENCIAL' : 
                          product.score >= 35 ? 'ANALIZAR' : 'RIESGO';
        results.push(product);
      }
    }
    
    // Small delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < asins.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  
  // Sort by score
  results.sort((a, b) => b.score - a.score);
  
  console.log(`[BATCH COMPLETE] ${results.length} products | Cache: ${cacheHits} | API: ${apiCalls}`);
  
  res.json({
    products: results,
    stats: {
      total: results.length,
      cacheHits,
      apiCalls,
      winners: results.filter(p => p.score >= 75).length,
      potential: results.filter(p => p.score >= 55 && p.score < 75).length
    }
  });
});

// Cache stats
app.get('/api/cache/stats', (req, res) => {
  res.json(cache.getStats());
});

// Clear cache (admin)
app.post('/api/cache/clear', (req, res) => {
  cache.flushAll();
  res.json({ message: 'Cache cleared' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   WI-FI AMAZON MONEY - Backend API v2.0                  ║
║   By Juan Camilo Villada - Wifi Money Group              ║
║                                                           ║
║   Server running on port ${PORT}                            ║
║   API Key: ${EASYPARSER_API_KEY ? 'Configured ✓' : 'MISSING ✗'}                               ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
