var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { addOrderAndGenerateInvoice, generateTakerInvoice, checkAndUpdateOrderStatus } from '../services/orderService.js';
import { prisma } from '../config/db.js'; // Import Prisma client
//
export function createOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log('Entering createOrder function');
        try {
            const customer_id = req.user.id;
            console.log('Customer ID:', customer_id);
            const orderData = Object.assign(Object.assign({}, req.body), { customer_id });
            console.log('Order data to be processed:', orderData);
            const result = yield addOrderAndGenerateInvoice(orderData);
            console.log('Order creation result:', result);
            res.status(201).json(result);
        }
        catch (error) {
            console.error('Error in createOrder:', error);
            res.status(500).json({ error: error.message || 'An unexpected error occurred' });
        }
    });
}
export function takeOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { orderId, takerDetails } = req.body;
        const customer_id = req.user.id; // Extract customer ID from authenticated user
        try {
            // Generate hold invoice for the taker
            const invoice = yield generateTakerInvoice(orderId, takerDetails, customer_id);
            // Update the taker_customer_id in the orders table using Prisma
            yield prisma.order.update({
                where: { order_id: orderId },
                data: { taker_customer_id: customer_id }
            });
            res.status(201).json({ message: "Invoice generated for taker", invoice });
        }
        catch (error) {
            res.status(500).json({ error: error.message });
        }
    });
}
export function checkInvoicePayment(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const { orderId, payment_hash } = req.body;
        try {
            const order = yield checkAndUpdateOrderStatus(orderId, payment_hash);
            res.status(200).json({ message: "Order status updated based on invoice payment", order });
        }
        catch (error) {
            // @ts-expect-error TS(2571): Object is of type 'unknown'.
            res.status(500).json({ error: error.message });
        }
    });
}
