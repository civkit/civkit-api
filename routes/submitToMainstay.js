import express from 'express';
import { submit } from '../controllers/submitToMainstayController.js';

const router = express.Router();

// POST request to submit order details to Mainstay
router.post('/', submit);

export default router;
