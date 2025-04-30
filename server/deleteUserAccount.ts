import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import { users, exchanges, bots, trades, backtestResults, optimizationResults, portfolios, portfolioAllocations, aiRecommendations, watchlistItems, wallets, tradingPairs } from "@shared/schema";

/**
 * Permanently deletes a user account and all associated data
 * This follows the same pattern as the removeUserDemoData script
 * but actually removes the user record as well at the end
 * 
 * @param userId The ID of the user to delete
 */
export async function deleteUserAccount(userId: number): Promise<void> {
  try {
    // First, delete dependent records
    console.log(`Deleting all data for user ID: ${userId}`);
    
    console.log("Deleting watchlist items...");
    await db.delete(watchlistItems).where(eq(watchlistItems.userId, userId));
    
    console.log("Deleting AI recommendations...");
    await db.delete(aiRecommendations).where(eq(aiRecommendations.userId, userId));
    
    console.log("Deleting portfolio allocations...");
    // Need to join with portfolios to get the allocations for this user
    const userPortfolios = await db.select().from(portfolios).where(eq(portfolios.userId, userId));
    for (const portfolio of userPortfolios) {
      await db.delete(portfolioAllocations).where(eq(portfolioAllocations.portfolioId, portfolio.id));
    }
    
    console.log("Deleting portfolios...");
    await db.delete(portfolios).where(eq(portfolios.userId, userId));
    
    console.log("Deleting wallets...");
    await db.delete(wallets).where(eq(wallets.userId, userId));
    
    // Get user exchanges and bots first
    const userExchanges = await db.select().from(exchanges).where(eq(exchanges.userId, userId));
    const userBots = await db.select().from(bots).where(eq(bots.userId, userId));
    
    console.log("Deleting optimization results...");
    for (const bot of userBots) {
      await db.delete(optimizationResults).where(eq(optimizationResults.botId, bot.id));
    }
    
    console.log("Deleting backtest results...");
    for (const bot of userBots) {
      await db.delete(backtestResults).where(eq(backtestResults.botId, bot.id));
    }
    
    console.log("Deleting trades...");
    for (const bot of userBots) {
      await db.delete(trades).where(eq(trades.botId, bot.id));
    }
    
    console.log("Deleting bots...");
    await db.delete(bots).where(eq(bots.userId, userId));
    
    console.log("Deleting trading pairs...");
    for (const exchange of userExchanges) {
      await db.delete(tradingPairs).where(eq(tradingPairs.exchangeId, exchange.id));
    }
    
    console.log("Deleting exchange connections...");
    await db.delete(exchanges).where(eq(exchanges.userId, userId));
    
    // Finally, delete the user record itself
    console.log("Deleting user account...");
    await db.delete(users).where(eq(users.id, userId));
    
    console.log("Account deletion completed successfully!");
  } catch (error) {
    console.error("Error deleting user account:", error);
    throw error;
  }
}