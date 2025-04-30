import { Express } from "express";
import { exchangeService } from "./exchangeService";

// This function can be added to routes.ts to test the getCurrentPrice method
export function registerPriceTestRoutes(app: Express) {
  // Test endpoint for fetching current price
  app.get('/api/price-test/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol;
      console.log(`Testing price fetching for ${symbol}`);
      
      // Try to get price
      const price = await exchangeService.getCurrentPrice(symbol);
      
      // Send response
      res.json({
        symbol,
        price,
        timestamp: new Date().toISOString(),
        source: price ? 'Real-time' : 'Not available'
      });
    } catch (error) {
      console.error('Error in price test endpoint:', error);
      res.status(500).json({ 
        error: 'Failed to fetch price', 
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });
}