/**
 * Wi-Fi Amazon Money - Backend API
 * By Juan Camilo Villada - Wifi Money Group
 * 
 * Endpoints:
 * - POST /api/products/batch - Analiza multiples ASINs
 * - GET /api/product/:asin - Analiza un ASIN individual
 * - GET /api/health - Health check
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const NodeCache = require('node-cache');

const app = express();
const PORT = process.env.PORT || 3000;

// Cache: TTL de 24 horas para productos, 12 horas para BSR
const cache = new NodeCache({ 
  stdTTL: parseInt(process.env.CACHE_TTL_PRODUCT) || 86400,
  checkperiod: 600 
});

// Middleware
app.use(cors());
app.use(express.json());

// Easyparser API config
const EASYPARSER_API_KEY = process.env.EASYPARSER_API_KEY;
const EASYPARSER_BASE_URL = 'https://realtime.easyparser.com/v1/request';

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
    // Easyparser Real-Time API - DETAIL operation
    const domain = getDomainFromMarketplace(marketplace);
    const url = `${EASYPARSER_BASE_URL}?api_key=${EASYPARSER_API_KEY}&platform=AMZ&operation=DETAIL&domain=${domain}&asin=${asin}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[API ERROR] ${response.status}: ${errorText}`);
      throw new Error(`Easyparser API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Check if successful
    if (data.status !== 'success' && !data.title) {
      console.error(`[API ERROR] Invalid response for ${asin}`);
      return null;
    }
    
    // Transform to our format
    const productData = transformEasyparserData(data, asin);
    
    // Cache the result
    cache.set(cacheKey, productData);
    console.log(`[CACHED] ${asin}`);
    
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

function transformEasyparserData(data, asin) {
  // Easyparser response - puede venir en data.result o directamente
  const result = data.result || data;
  
  // Extraer BSR
  const bsr = result.bestseller_rank || result.bsr || result.sales_rank || null;
  const salesEstimate = estimateSalesFromBSR(bsr);
  
  // Price extraction - manejar diferentes formatos
  let price = 0;
  if (result.price) {
    if (typeof result.price === 'object') {
      price = parseFloat(result.price.value || result.price.current || result.price.amount || 0);
    } else {
      price = parseFloat(String(result.price).replace(/[^0-9.]/g, ''));
    }
  }
  
  // Reviews count
  let reviews = 0;
  if (result.reviews_count) reviews = parseInt(result.reviews_count);
  else if (result.reviews) reviews = parseInt(result.reviews);
  else if (result.rating_count) reviews = parseInt(result.rating_count);
  else if (result.total_reviews) reviews = parseInt(result.total_reviews);
  
  // Rating
  let rating = 0;
  if (result.rating) rating = parseFloat(result.rating);
  else if (result.stars) rating = parseFloat(result.stars);
  else if (result.average_rating) rating = parseFloat(result.average_rating);
  
  // Calculate monthly sales
  let monthlySales = salesEstimate?.monthly || 0;
  
  // If no BSR, estimate from reviews
  if (!bsr && reviews > 0) {
    monthlySales = estimateSalesFromReviews(reviews, rating, price);
  }
  
  return {
    asin: asin,
    title: result.title || '',
    price: price,
    currency: result.currency || 'USD',
    rating: rating,
    reviews: reviews,
    bsr: bsr,
    category: result.category || result.main_category || result.department || '',
    monthlySales: monthlySales,
    dailySales: Math.round(monthlySales / 30 * 10) / 10,
    monthlyRevenue: Math.round(price * monthlySales),
    isFBA: result.is_fba || result.fulfilled_by_amazon || result.fulfillment === 'FBA' || false,
    isPrime: result.is_prime || result.prime || false,
    seller: result.seller || result.sold_by || result.merchant || '',
    brand: result.brand || '',
    image: result.main_image || result.image || (result.images && result.images[0]) || '',
    url: `https://amazon.com/dp/${asin}`,
    fetchedAt: new Date().toISOString()
  };
}

// Estimate sales from reviews when BSR not available
function estimateSalesFromReviews(reviews, rating, price) {
  if (!reviews) return 0;
  
  let monthlyEstimate = 0;
  
  if (reviews > 10000) monthlyEstimate = Math.round(reviews * 0.15);
  else if (reviews > 5000) monthlyEstimate = Math.round(reviews * 0.12);
  else if (reviews > 1000) monthlyEstimate = Math.round(reviews * 0.1);
  else if (reviews > 500) monthlyEstimate = Math.round(reviews * 0.08);
  else if (reviews > 100) monthlyEstimate = Math.round(reviews * 0.06);
  else if (reviews > 20) monthlyEstimate = Math.round(reviews * 0.05);
  else monthlyEstimate = Math.round(reviews * 0.03);
  
  // Adjust by rating
  if (rating >= 4.5) monthlyEstimate *= 1.3;
  else if (rating >= 4.0) monthlyEstimate *= 1.1;
  else if (rating < 3.5) monthlyEstimate *= 0.7;
  
  // Adjust by price
  if (price > 100) monthlyEstimate *= 0.6;
  else if (price > 50) monthlyEstimate *= 0.8;
  else if (price < 15) monthlyEstimate *= 1.2;
  
  return Math.max(1, Math.round(monthlyEstimate));
}

// BSR to Sales estimation table
function estimateSalesFromBSR(bsr) {
  if (!bsr || bsr <= 0) return null;
  
  const BSR_TABLE = [
    { maxBSR: 100, daily: 166, monthly: 5000 },
    { maxBSR: 200, daily: 133, monthly: 4000 },
    { maxBSR: 500, daily: 100, monthly: 3000 },
    { maxBSR: 1000, daily: 83, monthly: 2500 },
    { maxBSR: 2000, daily: 66, monthly: 2000 },
    { maxBSR: 3000, daily: 50, monthly: 1500 },
    { maxBSR: 5000, daily: 33, monthly: 1000 },
    { maxBSR: 10000, daily: 16, monthly: 500 },
    { maxBSR: 20000, daily: 10, monthly: 300 },
    { maxBSR: 50000, daily: 5, monthly: 150 },
    { maxBSR: 100000, daily: 2.5, monthly: 75 },
    { maxBSR: 200000, daily: 1, monthly: 30 },
    { maxBSR: 500000, daily: 0.3, monthly: 10 },
    { maxBSR: Infinity, daily: 0.03, monthly: 1 }
  ];
  
  for (const tier of BSR_TABLE) {
    if (bsr <= tier.maxBSR) {
      return { daily: tier.daily, monthly: tier.monthly };
    }
  }
  return { daily: 0, monthly: 0 };
}

// Calculate product score
function calculateScore(product) {
  let score = 0;
  
  // BSR Score (max 35) - ahora tenemos BSR real
  if (product.bsr) {
    if (product.bsr <= 1000) score += 35;
    else if (product.bsr <= 5000) score += 30;
    else if (product.bsr <= 10000) score += 25;
    else if (product.bsr <= 25000) score += 20;
    else if (product.bsr <= 50000) score += 15;
    else if (product.bsr <= 100000) score += 10;
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
  
  // Reviews/Velocity (max 15)
  if (product.reviews) {
    if (product.reviews > 1000) score += 15;
    else if (product.reviews > 500) score += 12;
    else if (product.reviews > 200) score += 10;
    else if (product.reviews > 100) score += 7;
    else if (product.reviews > 50) score += 5;
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
    version: '1.0.0',
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
  
  // Process in parallel with limit
  const BATCH_SIZE = 5;
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
║   WI-FI AMAZON MONEY - Backend API                       ║
║   By Juan Camilo Villada - Wifi Money Group              ║
║                                                           ║
║   Server running on port ${PORT}                            ║
║   Cache TTL: ${process.env.CACHE_TTL_PRODUCT || 86400}s (${Math.round((process.env.CACHE_TTL_PRODUCT || 86400) / 3600)}h)                              ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
