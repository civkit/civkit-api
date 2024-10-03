import express from 'express';
import { authenticateJWT, authorizePayoutSubmission } from '../middleware/authMiddleware.js';
import { submitPayout } from '../controllers/payoutController.js';

const router = express.Router();

// POST request to submit payout
router.post('/submit', authenticateJWT, authorizePayoutSubmission, submitPayout);

export default router;
