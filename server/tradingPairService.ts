import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { Exchange, TradingPair } from "@shared/schema";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { tradingPairs } from "@shared/schema";
import { eq, and, lt } from "drizzle-orm";

/**
 * Service for managing trading pairs data
 * Handles automatic refresh, data storage and retrieval
 */
export class TradingPairService {
  private refreshIntervalMinutes: number = 1440; // Default: refresh once every 24 hours
  
  /**
   * Set the refresh interval for trading pairs
   * @param minutes Number of minutes between refreshes
   */
  setRefreshInterval(minutes: number): void {
    if (minutes < 5) {
      console.warn(`Refresh interval of ${minutes} minutes is too low. Setting to 5 minutes minimum.`);
      this.refreshIntervalMinutes = 5;
    } else {
      this.refreshIntervalMinutes = minutes;
      console.log(`Trading pair refresh interval set to ${minutes} minutes`);
    }
  }
  
  /**
   * Get trading pairs for an exchange, refreshing if needed
   * @param exchangeId Exchange ID to get pairs for
   * @param forceRefresh Whether to force refresh regardless of last refresh time
   */
  async getTradingPairsForExchange(exchangeId: number, forceRefresh: boolean = false): Promise<TradingPair[]> {
    try {
      // Get exchange details
      const exchange = await storage.getExchange(exchangeId);
      if (!exchange) {
        throw new Error(`Exchange with ID ${exchangeId} not found`);
      }
      
      // Check if we need to refresh based on last refresh time
      const needsRefresh = await this.shouldRefreshPairs(exchangeId, forceRefresh);
      
      if (needsRefresh) {
        console.log(`Refreshing trading pairs for exchange ${exchange.name} (ID: ${exchangeId})`);
        try {
          // Attempt to fetch fresh pairs
          const freshPairs = await exchangeService.fetchTradingPairs(exchangeId);
          
          // Update refreshed timestamp for all pairs from this exchange
          await this.updateLastRefreshedTimestamp(exchangeId);
          
          return freshPairs;
        } catch (error) {
          console.error(`Error refreshing trading pairs for exchange ${exchange.name}:`, error);
          
          // Check if we have any pairs for this exchange
          const existingPairs = await storage.getTradingPairsByExchangeId(exchangeId);
          
          if (existingPairs.length === 0) {
            // If no pairs exist, try loading sample pairs as a fallback
            console.log(`No pairs found for ${exchange.name}, attempting to load sample pairs`);
            
            try {
              // Import here to avoid circular dependency
              const { loadSampleTradingPairsIfNeeded } = await import("./initialDataLoader");
              await loadSampleTradingPairsIfNeeded(exchangeId);
              
              // After loading samples, update the timestamp
              await this.updateLastRefreshedTimestamp(exchangeId);
            } catch (sampleError) {
              console.error(`Failed to load sample pairs for ${exchange.name}:`, sampleError);
            }
          } else {
            // Otherwise just fall back to stored pairs
            console.log(`Falling back to ${existingPairs.length} stored pairs for ${exchange.name}`);
          }
        }
      }
      
      // Return stored pairs (either because refresh wasn't needed or it failed)
      return await storage.getTradingPairsByExchangeId(exchangeId);
    } catch (error) {
      console.error(`Error in getTradingPairsForExchange for exchange ID ${exchangeId}:`, error);
      throw error;
    }
  }
  
  /**
   * Check if trading pairs for an exchange need refreshing
   * @param exchangeId Exchange ID to check
   * @param forceRefresh Whether to force refresh regardless of last refresh time
   */
  private async shouldRefreshPairs(exchangeId: number, forceRefresh: boolean): Promise<boolean> {
    if (forceRefresh) {
      return true;
    }
    
    // Get the oldest last_refreshed_at timestamp for this exchange
    const result = await db.select({ lastRefreshed: tradingPairs.lastRefreshedAt })
      .from(tradingPairs)
      .where(eq(tradingPairs.exchangeId, exchangeId))
      .orderBy(tradingPairs.lastRefreshedAt)
      .limit(1);
    
    // If no pairs exist yet, we need to refresh
    if (result.length === 0) {
      return true;
    }
    
    const lastRefreshed = result[0].lastRefreshed;
    if (!lastRefreshed) {
      return true;
    }
    
    // Check if the refresh interval has passed
    const refreshThreshold = new Date();
    refreshThreshold.setMinutes(refreshThreshold.getMinutes() - this.refreshIntervalMinutes);
    
    return lastRefreshed < refreshThreshold;
  }
  
  /**
   * Update last refreshed timestamp for all pairs from an exchange
   * @param exchangeId Exchange ID to update timestamps for
   */
  private async updateLastRefreshedTimestamp(exchangeId: number): Promise<void> {
    const now = new Date();
    await db.update(tradingPairs)
      .set({ lastRefreshedAt: now })
      .where(eq(tradingPairs.exchangeId, exchangeId));
  }
  
  /**
   * Refresh trading pairs for all exchanges
   * This can be called from a scheduled job
   */
  async refreshAllExchanges(): Promise<void> {
    try {
      console.log("Starting scheduled refresh of trading pairs for all exchanges");
      
      // Get all exchanges
      const exchanges = await storage.getAllExchanges();
      
      // Count of successful and failed refreshes
      let successCount = 0;
      let failCount = 0;
      
      // Process each exchange
      for (const exchange of exchanges) {
        try {
          // Check if exchange has valid credentials (for non-demo exchanges)
          if (!exchange.isDemo && (!exchange.apiKey || !exchange.apiSecret)) {
            console.log(`Skipping exchange ${exchange.name} (ID: ${exchange.id}) - missing API credentials`);
            continue;
          }
          
          console.log(`Refreshing trading pairs for ${exchange.name} (ID: ${exchange.id})`);
          await this.getTradingPairsForExchange(exchange.id, true);
          successCount++;
        } catch (error) {
          console.error(`Failed to refresh trading pairs for exchange ${exchange.name}:`, error);
          
          // Check if we need to load sample trading pairs as fallback
          try {
            const pairs = await storage.getTradingPairsByExchangeId(exchange.id);
            
            if (pairs.length === 0) {
              console.log(`No trading pairs found for ${exchange.name}, attempting to load sample pairs`);
              
              // Import here to avoid circular dependency
              const { loadSampleTradingPairsIfNeeded } = await import("./initialDataLoader");
              await loadSampleTradingPairsIfNeeded(exchange.id);
              
              // We loaded sample pairs successfully
              console.log(`Successfully loaded sample trading pairs for ${exchange.name}`);
            }
          } catch (sampleError) {
            console.error(`Failed to load sample pairs for ${exchange.name}:`, sampleError);
          }
          
          failCount++;
        }
      }
      
      console.log(`Completed trading pairs refresh. Success: ${successCount}, Failed: ${failCount}`);
    } catch (error) {
      console.error("Error in refreshAllExchanges:", error);
      throw error;
    }
  }
  
  /**
   * Get all trading pairs across all exchanges
   * Optionally refresh pairs that are outdated first
   * @param refreshOutdated Whether to refresh outdated pairs first
   */
  async getAllTradingPairs(refreshOutdated: boolean = false): Promise<(TradingPair & { exchangeName: string })[]> {
    try {
      if (refreshOutdated) {
        // Get exchanges with outdated trading pairs
        const refreshThreshold = new Date();
        refreshThreshold.setMinutes(refreshThreshold.getMinutes() - this.refreshIntervalMinutes);
        
        const result = await db.select({ exchangeId: tradingPairs.exchangeId })
          .from(tradingPairs)
          .where(lt(tradingPairs.lastRefreshedAt, refreshThreshold))
          .groupBy(tradingPairs.exchangeId);
        
        // Refresh outdated exchanges
        for (const row of result) {
          try {
            await this.getTradingPairsForExchange(row.exchangeId, true);
          } catch (error) {
            console.error(`Error refreshing outdated pairs for exchange ID ${row.exchangeId}:`, error);
            
            // Check if we need to load sample trading pairs as fallback
            try {
              const pairs = await storage.getTradingPairsByExchangeId(row.exchangeId);
              
              if (pairs.length === 0) {
                console.log(`No trading pairs found for exchange ID ${row.exchangeId}, attempting to load sample pairs`);
                
                // Import here to avoid circular dependency
                const { loadSampleTradingPairsIfNeeded } = await import("./initialDataLoader");
                await loadSampleTradingPairsIfNeeded(row.exchangeId);
                
                // After loading samples, update the timestamp
                await this.updateLastRefreshedTimestamp(row.exchangeId);
                
                console.log(`Successfully loaded sample trading pairs for exchange ID ${row.exchangeId}`);
              }
            } catch (sampleError) {
              console.error(`Failed to load sample pairs for exchange ID ${row.exchangeId}:`, sampleError);
            }
          }
        }
      }
      
      // Get all exchanges
      const exchanges = await storage.getAllExchanges();
      const exchangeMap: Record<number, Exchange> = {};
      exchanges.forEach(exchange => {
        exchangeMap[exchange.id] = exchange;
      });
      
      // Get all trading pairs
      const pairs = await storage.getAllTradingPairs();
      
      // Add exchange name to each pair
      return pairs.map(pair => ({
        ...pair,
        exchangeName: exchangeMap[pair.exchangeId]?.displayName || exchangeMap[pair.exchangeId]?.name || 'Unknown'
      }));
    } catch (error) {
      console.error("Error in getAllTradingPairs:", error);
      throw error;
    }
  }
}

export const tradingPairService = new TradingPairService();