const express = require('express');
const router = express.Router();
const db = require('../models/database');
const logger = require('../utils/logger');

// Simple Admin Authentication Middleware
const adminAuth = (req, res, next) => {
  const token = req.headers['x-admin-token'];
  // In a real app, this should be a secure token from env or a session
  // For this MVP, we'll use a simple check (user should set this in .env)
  const ADMIN_TOKEN = process.env.DASHBOARD_ADMIN_TOKEN || 'aquaiq-admin-2024';
  
  if (token === ADMIN_TOKEN) {
    next();
  } else {
    logger.warn(`Unauthorized dashboard access attempt from ${req.ip}`);
    res.status(401).json({ error: 'Unauthorized' });
  }
};

// Apply auth to all dashboard routes
router.use(adminAuth);

/**
 * GET /api/dashboard/stats
 * Returns high-level KPIs
 */
router.get('/stats', async (req, res) => {
  try {
    const stats = await db.getDashboardStats();
    res.json(stats);
  } catch (err) {
    logger.error('Error fetching dashboard stats', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/**
 * GET /api/dashboard/users
 * Returns list of farmers with pond counts
 */
router.get('/users', async (req, res) => {
  try {
    const users = await db.getAllFarmersForDashboard();
    res.json(users);
  } catch (err) {
    logger.error('Error fetching dashboard users', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

/**
 * GET /api/dashboard/chats/:farmerId
 * Returns full chat history for a farmer
 */
router.get('/chats/:farmerId', async (req, res) => {
  try {
    const { farmerId } = req.params;
    const chats = await db.getFullChatHistory(farmerId);
    res.json(chats);
  } catch (err) {
    logger.error('Error fetching chat history', { farmerId, error: err.message });
    res.status(500).json({ error: 'Failed to fetch chat history' });
  }
});

module.exports = router;
