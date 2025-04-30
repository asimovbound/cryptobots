/**
 * This file handles schema migrations to add missing columns to the trading_pairs table
 */
import { db } from "./db";
import { log } from "./vite";

export async function migrateTradingPairsSchema() {
  try {
    log("Starting trading_pairs table schema migration");
    
    // First check if columns exist
    const columnCheckResult = await db.execute(`
      SELECT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'trading_pairs' AND column_name = 'active'
      ) as active_exists,
      EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'trading_pairs' AND column_name = 'market'
      ) as market_exists,
      EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'trading_pairs' AND column_name = 'name'
      ) as name_exists,
      EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'trading_pairs' AND column_name = 'last_refreshed_at'
      ) as last_refreshed_at_exists
    `);
    
    // Extract the results
    const result = columnCheckResult.rows[0];
    const columns = {
      active: result.active_exists,
      market: result.market_exists,
      name: result.name_exists,
      lastRefreshedAt: result.last_refreshed_at_exists
    };
    
    log(`Column check results: ${JSON.stringify(columns)}`);
    
    // Add missing columns
    if (!columns.active) {
      log("Adding 'active' column to trading_pairs table");
      await db.execute(`ALTER TABLE trading_pairs ADD COLUMN active BOOLEAN DEFAULT TRUE`);
    }
    
    if (!columns.market) {
      log("Adding 'market' column to trading_pairs table");
      await db.execute(`ALTER TABLE trading_pairs ADD COLUMN market TEXT DEFAULT 'spot'`);
    }
    
    if (!columns.name) {
      log("Adding 'name' column to trading_pairs table");
      await db.execute(`ALTER TABLE trading_pairs ADD COLUMN name TEXT`);
    }
    
    if (!columns.lastRefreshedAt) {
      log("Adding 'last_refreshed_at' column to trading_pairs table");
      await db.execute(`ALTER TABLE trading_pairs ADD COLUMN last_refreshed_at TIMESTAMP DEFAULT NOW()`);
    }
    
    log("Trading pairs schema migration completed successfully");
    return true;
  } catch (error) {
    console.error("Error during trading_pairs schema migration:", error);
    throw error;
  }
}

// Export as default for direct execution
export default migrateTradingPairsSchema;