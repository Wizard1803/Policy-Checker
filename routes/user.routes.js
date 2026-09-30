const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const userModel = require('../models/user.model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const quotaService = require('../services/quota.service');

const cookieOptions = {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
};

function wantsHtml(req) {
    return Boolean(req.accepts('html') && !req.xhr && !(req.headers.accept && req.headers.accept.includes('application/json')));
}

router.get("/register", (req, res) => {
    res.render('register', { error: null });
});

router.post("/register",
    body('email').trim().isEmail(),
    body('password').trim().isLength({ min: 5 }),
    body('username').trim().isLength({ min: 3 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const firstMsg = errors.array()[0]?.msg || 'Invalid input data';
            if (wantsHtml(req)) {
                return res.status(400).render('register', {
                    error: firstMsg === 'Invalid value' ? 'Invalid input data. Please check all fields.' : firstMsg
                });
            }
            return res.status(400).json({
                errors: errors.array(),
                message: "Invalid input data"
            });
        }
        try {
            const { username, email, password } = req.body;
            const hashedPassword = await bcrypt.hash(password, 10);
            const newUser = await userModel.create({
                username,
                email,
                password: hashedPassword
            });

            const token = jwt.sign({
                id: newUser._id,
                email: newUser.email,
                username: newUser.username
            }, process.env.JWT_SECRET);

            res.cookie('token', token, cookieOptions);
            res.redirect('/');
        } catch (err) {
            if (err.code === 11000) {
                const field = Object.keys(err.keyPattern || {})[0] || 'field';
                const msg = `That ${field} is already registered.`;
                if (wantsHtml(req)) {
                    return res.status(409).render('register', { error: msg });
                }
                return res.status(409).json({
                    message: msg,
                });
            }
            console.error('Register error:', err);
            if (wantsHtml(req)) {
                return res.status(500).render('register', { error: 'Registration failed. Please try again.' });
            }
            return res.status(500).json({ message: 'Registration failed.' });
        }
    });

router.get('/login', (req, res) => {
    res.render('login', { error: null });
});

router.post('/login',
    body('username').trim().isLength({ min: 1 }),
    body('password').trim().isLength({ min: 5 }),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            const firstMsg = errors.array()[0]?.msg || 'Invalid input data';
            if (wantsHtml(req)) {
                return res.status(400).render('login', {
                    error: firstMsg === 'Invalid value' ? 'Invalid username or password' : firstMsg
                });
            }
            return res.status(400).json({ errors: errors.array(), message: "Invalid input data" });
        }
        const { username, password } = req.body;
        const id = (username || '').trim().toLowerCase();
        const user = await userModel.findOne({
            $or: [{ username: id }, { email: id }]
        });
        if (!user) {
            if (wantsHtml(req)) {
                return res.status(401).render('login', { error: 'Invalid username or password' });
            }
            return res.status(401).json({ message: "Invalid username or password" });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            if (wantsHtml(req)) {
                return res.status(401).render('login', { error: 'Invalid username or password' });
            }
            return res.status(401).json({ message: "Invalid username or password" });
        }
        const token = jwt.sign({
            id: user._id,
            email: user.email,
            username: user.username
        }, process.env.JWT_SECRET);

        res.cookie('token', token, cookieOptions);
        res.redirect('/');
    });



router.get('/logout', (req, res) => {
    res.clearCookie('token'); 
    res.redirect('/user/login?message=logged_out'); // Redirect to login, maybe with a query param
});

// GET USER QUOTA & USAGE (Feature G)
router.get('/quota', async (req, res) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const quota = await quotaService.getUserQuota(decoded.id);
        res.json(quota);
    } catch (err) {
        res.status(401).json({ success: false, message: err.message || 'Invalid token.' });
    }
});

module.exports = router;