var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import express from 'express';
import { createOrder, takeOrder } from '../controllers/orderController.js';
import { settleHoldInvoicesByOrderIdService } from '../services/invoiceService.js';
const router = express.Router();
router.post('/', createOrder);
router.post('/take', takeOrder); // New endpoint for taking an order
router.post('/settle-holdinvoices-by-order', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { orderId } = req.body;
    try {
        yield settleHoldInvoicesByOrderIdService(orderId);
        res.status(200).json({ message: 'Successfully settled hold invoices for the order' });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ error: error.message });
    }
}));
export default router;
