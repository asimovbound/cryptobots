/**
 * Utility to load initial sample data for new users or demo environments
 */
import { storage } from "./storage";
import { tradingPairService } from "./tradingPairService";
import { log } from "./vite";
import { insertExchangeSchema } from "@shared/schema";

/**
 * Creates a demo exchange for a user if they don't have any exchanges yet
 * @param userId The user ID to create demo exchange for
 */
export async function createDemoExchangeIfNeeded(userId: number): Promise<void> {
  try {
    // Check if user already has exchanges
    const userExchanges = await storage.getExchangesByUserId(userId);
    
    if (userExchanges.length === 0) {
      log(`Creating demo exchange for new user (ID: ${userId})`);
      
      // Create a demo exchange with Kraken as the backend
      const demoExchangeData = insertExchangeSchema.parse({
        userId,
        name: 'kraken',
        displayName: 'Demo Exchange',
        apiKey: 'demo-api-key',
        apiSecret: 'demo-api-secret',
        isDemo: true,
        canWithdraw: false,
        status: 'connected'
      });
      
      // Create the exchange
      const exchange = await storage.createExchange(demoExchangeData);
      log(`Created demo exchange (ID: ${exchange.id}) for user ${userId}`);
      
      // Load initial trading pairs for the demo exchange
      try {
        await tradingPairService.getTradingPairsForExchange(exchange.id, true);
        log(`Loaded initial trading pairs for demo exchange (ID: ${exchange.id})`);
      } catch (pairError) {
        console.error(`Failed to load initial trading pairs for demo exchange:`, pairError);
      }
    }
  } catch (error) {
    console.error(`Error creating demo exchange for user ${userId}:`, error);
  }
}

/**
 * Loads a set of common trading pairs for an exchange if none exist yet
 * Used as a fallback when API connection fails
 * @param exchangeId The exchange ID to load sample pairs for
 */
export async function loadSampleTradingPairsIfNeeded(exchangeId: number): Promise<void> {
  try {
    // Check if exchange already has trading pairs
    const existingPairs = await storage.getTradingPairsByExchangeId(exchangeId);
    
    if (existingPairs.length === 0) {
      // Get the exchange to determine its name/type
      const exchange = await storage.getExchange(exchangeId);
      if (!exchange) {
        throw new Error(`Exchange with ID ${exchangeId} not found`);
      }
      
      log(`Loading sample trading pairs for exchange ${exchange.name} (ID: ${exchangeId})`);
      
      // Define common trading pairs that should be available on most exchanges
      const commonPairs = [
        { symbol: 'BTC/USDT', name: 'Bitcoin/USDT', baseAsset: 'BTC', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'ETH/USDT', name: 'Ethereum/USDT', baseAsset: 'ETH', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'ETH/BTC', name: 'Ethereum/Bitcoin', baseAsset: 'ETH', quoteAsset: 'BTC', market: 'spot' },
        { symbol: 'SOL/USDT', name: 'Solana/USDT', baseAsset: 'SOL', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'XRP/USDT', name: 'Ripple/USDT', baseAsset: 'XRP', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'BNB/USDT', name: 'Binance Coin/USDT', baseAsset: 'BNB', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'ADA/USDT', name: 'Cardano/USDT', baseAsset: 'ADA', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'DOGE/USDT', name: 'Dogecoin/USDT', baseAsset: 'DOGE', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'DOT/USDT', name: 'Polkadot/USDT', baseAsset: 'DOT', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'LINK/USDT', name: 'Chainlink/USDT', baseAsset: 'LINK', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'UNI/USDT', name: 'Uniswap/USDT', baseAsset: 'UNI', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'AVAX/USDT', name: 'Avalanche/USDT', baseAsset: 'AVAX', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'MATIC/USDT', name: 'Polygon/USDT', baseAsset: 'MATIC', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'LTC/USDT', name: 'Litecoin/USDT', baseAsset: 'LTC', quoteAsset: 'USDT', market: 'spot' },
        { symbol: 'ATOM/USDT', name: 'Cosmos/USDT', baseAsset: 'ATOM', quoteAsset: 'USDT', market: 'spot' },
      ];
      
      // Insert sample pairs
      for (const pair of commonPairs) {
        await storage.createTradingPair({
          exchangeId,
          symbol: pair.symbol,
          name: pair.name,
          baseAsset: pair.baseAsset,
          quoteAsset: pair.quoteAsset,
          market: pair.market,
          active: true
        });
      }
      
      // Note: We rely on the database default for lastRefreshedAt which is set to NOW() in the schema
      
      log(`Loaded ${commonPairs.length} sample trading pairs for exchange ${exchange.name}`);
    }
  } catch (error) {
    console.error(`Error loading sample trading pairs for exchange ${exchangeId}:`, error);
  }
}