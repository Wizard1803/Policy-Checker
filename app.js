
require('dotenv').config();

['JWT_SECRET', 'ATLAS_URI'].forEach((key) => {
    if (!process.env[key]) {
        console.error(`Missing required environment variable: ${key}`);
        process.exit(1);
    }
});

const hasCloudinaryUrl = Boolean(process.env.CLOUDINARY_URL);
const hasCloudinaryParts =
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET;
if (!hasCloudinaryUrl && !hasCloudinaryParts) {
    console.error(
        'Missing Cloudinary config: set CLOUDINARY_URL or CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET'
    );
    process.exit(1);
}

const express = require('express');
const app = express();
const userRouter = require('./routes/user.routes');
const indexRouter = require('./routes/index.routes');
const connectDb = require('./config/db');
const cookieParser = require('cookie-parser');
const path = require('path');
const { reconcileOrphanedFiles } = require('./services/document.service');

// 3. Your app setup
app.set('view engine', 'ejs');
app.use(cookieParser());

// Security headers (inline baseline without heavy external dependencies)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
});

connectDb()
    ?.then(() => {
        return Promise.resolve(reconcileOrphanedFiles()).catch((err) => {
            console.warn('Orphan reconciliation notice:', err?.message || err);
        });
    })
    .catch((err) => {
        console.error('MongoDB startup error:', err?.message || err);
    });
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static assets (CSS/JS)
app.use(express.static(path.join(__dirname, 'public')));

// Vendor assets (served locally from node_modules)
app.use('/vendor/marked', express.static(path.join(__dirname, 'node_modules', 'marked')));
app.use('/vendor/dompurify', express.static(path.join(__dirname, 'node_modules', 'dompurify', 'dist')));

// 4. Your routes
app.use('/', indexRouter);
app.use('/user', userRouter);

// Central error boundary
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    const statusCode = err.statusCode || err.status || 500;
    const isProd = process.env.NODE_ENV === 'production';

    console.error(`[Error] ${req.method} ${req.originalUrl}:`, {
        message: err.message,
        statusCode,
        code: err.code,
        stack: isProd ? undefined : err.stack,
    });

    const isAjax = req.xhr ||
        req.headers?.['x-requested-with'] === 'XMLHttpRequest' ||
        (req.headers?.accept && req.headers.accept.includes('application/json')) ||
        (req.path && (req.path.startsWith('/files/') || req.path.startsWith('/compare-policies')));

    if (isAjax || !req.accepts('html')) {
        return res.status(statusCode).json({
            success: false,
            code: err.code || 'INTERNAL_ERROR',
            message: err.message || 'An unexpected error occurred.',
        });
    }

    return res.status(statusCode).render('error', {
        statusCode,
        message: err.message || 'An unexpected error occurred.',
    }, (renderErr, html) => {
        if (renderErr) {
            return res.status(statusCode).send(`Error ${statusCode}: ${err.message || 'An unexpected error occurred.'}`);
        }
        res.send(html);
    });
});

if (require.main === module) {
    app.listen(3000, () => {
        console.log("server is started");
    });
}

module.exports = app;