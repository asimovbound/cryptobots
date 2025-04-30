import { db } from "./db";
import { eq, and, sql } from "drizzle-orm";
import { users, exchanges, bots, trades, backtestResults, optimizationResults, portfolios, portfolioAllocations, aiRecommendations, watchlistItems, wallets, tradingPairs } from "@shared/schema";

async function removeUserDemoData(email: string) {
  try {
    // Find the user ID
    const [user] = await db.select().from(users).where(eq(users.email, email));
    
    if (!user) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }
    
    const userId = user.id;
    console.log(`Found user with ID: ${userId}`);

    // Delete user data in the correct order to respect foreign key constraints
    console.log("Removing user data...");

    // First, delete dependent records
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
    
    // Get user exchanges first
    const userExchanges = await db.select().from(exchanges).where(eq(exchanges.userId, userId));
    
    console.log("Deleting optimization results...");
    // Need to join with bots to get the optimization results for this user
    const userBots = await db.select().from(bots).where(eq(bots.userId, userId));
    for (const bot of userBots) {
      await db.delete(optimizationResults).where(eq(optimizationResults.botId, bot.id));
    }
    
    console.log("Deleting backtest results...");
    // Need to join with bots to get the backtest results for this user
    for (const bot of userBots) {
      await db.delete(backtestResults).where(eq(backtestResults.botId, bot.id));
    }
    
    console.log("Deleting trades...");
    // Need to join with bots to get the trades for this user
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
    
    console.log("All demo data removed successfully!");
  } catch (error) {
    console.error("Error removing user data:", error);
  } finally {
    process.exit(0);
  }
}

// Run for the specific email provided
removeUserDemoData("asimovbound@gmail.com");