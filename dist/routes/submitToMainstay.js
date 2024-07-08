import express from 'express';
import { submit } from '../controllers/submitToMainstayController.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';
const router = express.Router();
router.post('/submitToMainstay', authenticateJWT, submit);
export default router;
