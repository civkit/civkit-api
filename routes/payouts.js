import express from 'express';
import { submitPayout } from '../controllers/payoutController.js';

const router = express.Router();

// POST request to submit payout
router.post('/submit', submitPayout);

export default router;
