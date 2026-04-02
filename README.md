# Wi-Fi Amazon Money - Backend API

By Juan Camilo Villada - Wifi Money Group

## Descripcion

Backend API que conecta con Easyparser para obtener datos reales de Amazon:
- BSR (Best Seller Rank)
- Sales Rank Drops (ventas estimadas)
- Precio, rating, reviews
- Cache inteligente para ahorrar creditos

## Endpoints

| Metodo | Endpoint | Descripcion |
|--------|----------|-------------|
| GET | `/api/health` | Health check |
| GET | `/api/product/:asin` | Obtener datos de un producto |
| POST | `/api/products/batch` | Analizar multiples ASINs |
| GET | `/api/cache/stats` | Estadisticas del cache |

## Ejemplo de uso

### Un producto
```bash
curl http://localhost:3000/api/product/B0BQXHK363
```

### Batch de productos
```bash
curl -X POST http://localhost:3000/api/products/batch \
  -H "Content-Type: application/json" \
  -d '{"asins": ["B0BQXHK363", "B09V3KXJPB"], "marketplace": "US"}'
```

## Instalacion Local

```bash
npm install
npm start
```

## Deploy en Railway (GRATIS)

1. Crea cuenta en https://railway.app
2. Click "New Project" → "Deploy from GitHub"
3. Conecta tu repo
4. Agrega variables de entorno:
   - `EASYPARSER_API_KEY` = tu API key
   - `PORT` = 3000
5. Deploy automatico

## Deploy en Render (GRATIS)

1. Crea cuenta en https://render.com
2. New → Web Service
3. Conecta tu repo
4. Build Command: `npm install`
5. Start Command: `npm start`
6. Agrega Environment Variables
7. Deploy

## Variables de Entorno

| Variable | Descripcion | Default |
|----------|-------------|---------|
| `EASYPARSER_API_KEY` | API key de Easyparser | (requerido) |
| `PORT` | Puerto del servidor | 3000 |
| `CACHE_TTL_PRODUCT` | TTL cache en segundos | 86400 (24h) |

## Cache

El sistema usa cache en memoria para:
- Reducir llamadas a Easyparser (ahorro de creditos)
- Respuestas mas rapidas
- TTL de 24 horas por defecto

**Ahorro estimado:** 80-95% de creditos con cache activo

## Estructura

```
wifi-amazon-backend/
├── server.js        # Servidor principal
├── package.json     # Dependencias
├── .env             # Variables de entorno (no subir a git)
└── README.md        # Documentacion
```
