import { authenticateJWT, identifyUserRoleInOrder } from '../middleware/authMiddleware';

// ... other imports ...

router.get('/orders/:orderId', authenticateJWT, identifyUserRoleInOrder, async (req, res) => {
  const order = req.order;
  const userRole = req.userRole;
  const acceptOfferUrl = req.acceptOfferUrl;

  res.json({
    order,
    userRole,
    acceptOfferUrl: userRole === 'taker' ? acceptOfferUrl : null
  });
});

// ... other routes ...
