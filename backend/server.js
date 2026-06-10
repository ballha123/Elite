import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import morgan from 'morgan'
import 'dotenv/config'
import { validateEnv, getCorsOrigins } from './config/env.js'
import connectDB from './config/mongodb.js'
import connectCloudinary from './config/cloudinary.js'
import userRouter from './routes/userRoute.js'
import productRouter from './routes/productRoute.js'
import cartRouter from './routes/cartRoute.js'
import orderRouter from './routes/orderRoute.js'
import reviewRouter from './routes/reviewRoute.js'
import categoryRouter from './routes/categoryRoute.js'
import favoriteRouter from './routes/favoriteRoute.js'
import newsletterRouter from './routes/newsletterRoute.js'
import heroRouter from './routes/heroRoute.js'

validateEnv()

// App Config
const app = express()
const port = process.env.PORT || 4000
connectDB()
connectCloudinary()
const path = require('path');
// Security: Helmet (security headers)
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

// Security: Rate limiting - 100 req/15min per IP (skip health checks)
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health'
})
app.use(limiter)

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false
})
app.use('/api/user/login', authLimiter)
app.use('/api/user/admin', authLimiter)
app.use('/api/user/register', authLimiter)
app.use('/public', express.static(path.join(__dirname, 'public')));
const newsletterSubscribeLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false
})
app.use('/api/newsletter/subscribe', newsletterSubscribeLimiter)

const PRODUCTION_ORIGINS = [
    'https://elite-admin-one.vercel.app',
    'https://elite-ecru-alpha.vercel.app',
    'https://eliteadmin-panel.vercel.app' // Ajout de ton domaine admin principal au cas où
]

const isAllowedOrigin = (origin) => {
    if (!origin) return true

    // allow localhost via your existing config
    const allowed = getCorsOrigins()
    if (allowed.includes(origin)) return true

    // allow all Vercel preview + production deployments
    if (origin.endsWith('.vercel.app')) return true

    // fallback production whitelist
    if (PRODUCTION_ORIGINS.includes(origin)) return true

    return false
}

// Configuration CORS corrigée et optimisée pour Vercel Serverless
app.use(cors({
    origin: function (origin, callback) {
        if (isAllowedOrigin(origin)) {
            callback(null, true)
        } else {
            // On refuse l'accès gentiment (false) au lieu de lever une exception (Error) 
            // qui fait crasher l'application sur Vercel
            callback(null, false)
        }
    },
    credentials: true,
    optionsSuccessStatus: 200 // Indispensable pour que le navigateur valide les requêtes de preflight (OPTIONS)
}))

// Logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// middlewares
app.use(express.json())

// api endpoints
app.use('/api/user', userRouter)
app.use('/api/product', productRouter)
app.use('/api/cart', cartRouter)
app.use('/api/order', orderRouter)
app.use('/api/review', reviewRouter)
app.use('/api/category', categoryRouter)
app.use('/api/favorite', favoriteRouter)
app.use('/api/newsletter', newsletterRouter)
app.use('/api/hero', heroRouter)

app.get('/', (req, res) => {
    res.send("API Working")
})

// Health check (for load balancers, uptime monitoring)
app.get('/health', async (req, res) => {
    try {
        const mongoose = (await import('mongoose')).default
        const state = mongoose.connection.readyState
        const ok = state === 1 // 1 = connected
        res.status(ok ? 200 : 503).json({
            status: ok ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            mongodb: state === 1 ? 'connected' : state === 2 ? 'connecting' : state === 3 ? 'disconnecting' : 'disconnected'
        })
    } catch (err) {
        res.status(503).json({ status: 'error', message: err.message })
    }
})

// 404 - unknown routes
app.use((req, res) => {
    res.status(404).json({ success: false, message: 'Not found' })
})

// Global error handler (catches multer, mongoose, jwt, etc.)
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err)

    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, message: 'File too large. Max: 5MB for product images, 50MB for hero videos.' })
    }
    if (err.message && err.message.startsWith('Invalid file type')) {
        return res.status(400).json({ success: false, message: err.message })
    }
    if (err.name === 'ValidationError') {
        const msg = Object.values(err.errors || {}).map((e) => e.message).join(', ') || err.message
        return res.status(400).json({ success: false, message: msg })
    }
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({ success: false, message: 'Not authorized. Please login again.' })
    }
    if (err.code === 11000) {
        return res.status(409).json({ success: false, message: 'Duplicate value. Resource already exists.' })
    }

    console.error('Error:', err.message || err)
    res.status(500).json({ success: false, message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : (err.message || 'Something went wrong') })
})

// Export for Vercel serverless
export default app

// Start server when running locally (not on Vercel)
if (!process.env.VERCEL) {
    app.listen(port, () => console.log('Server started on PORT : ' + port))
}