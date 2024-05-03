import express from 'express';
import { createOrder, takeOrder } from '../controllers/orderController.js';

const router = express.Router();

router.post('/', createOrder);
router.post('/take', takeOrder);  // New endpoint for taking an order


export default router;
