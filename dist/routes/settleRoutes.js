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
import { settleHoldInvoices } from '../services/invoiceService.js';
import { authenticateJWT } from '../middleware/authMiddleware.js';
const router = express.Router();
router.post('/settle-hold-invoices', authenticateJWT, (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { orderId } = req.body;
        const result = yield settleHoldInvoices(orderId);
        res.status(200).json({ message: 'Hold invoices settled successfully', result });
    }
    catch (error) {
        // @ts-expect-error TS(2571): Object is of type 'unknown'.
        res.status(500).json({ message: 'Error settling hold invoices', error: error.message });
    }
}));
export default router;
