const jwt = require('jsonwebtoken');
const User = require('../models/user.model'); 

const protect = async (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
      
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password');

        if (!user) {
            req.user = null; 
            return next();
        }

        req.user = user; 
        next();
    } catch (error) {
       
        console.error('Token verification failed:', error);
        req.user = null;
        next();
    }
};

function isAjaxRequest(req) {
    return Boolean(
        req.xhr ||
        req.headers?.['x-requested-with'] === 'XMLHttpRequest' ||
        (req.headers?.accept && req.headers.accept.includes('application/json'))
    );
}

const requireAuth = async (req, res, next) => {
    const token = req.cookies?.token;

    const handleUnauthorized = () => {
        if (isAjaxRequest(req)) {
            return res.status(401).json({ success: false, message: 'Unauthorized' });
        }
        return res.status(401).redirect('/user/login');
    };

    if (!token) {
        return handleUnauthorized();
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user) {
            return handleUnauthorized();
        }

        req.user = user;
        next();
    } catch (_error) {
        return handleUnauthorized();
    }
};

module.exports = { protect, requireAuth };