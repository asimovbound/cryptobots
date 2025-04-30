import { db } from "./db";
import { 
  speculationBots, 
  speculationTrades, 
  InsertSpeculationBot, 
  InsertSpeculationTrade 
} from "@shared/schema";
import { eq, desc, and, inArray } from "drizzle-orm";

type PriceData = {
  price: number;
  volatility: number;
};

const PRICE_DATA: Record<string, PriceData> = {
  "BTC/USDT": { price: 67500, volatility: 0.03 },
  "ETH/USDT": { price: 3650, volatility: 0.04 },
  "SOL/USDT": { price: 145, volatility: 0.05 },
  "BNB/USDT": { price: 530, volatility: 0.025 },
  "XRP/USDT": { price: 0.65, volatility: 0.035 },
  "ADA/USDT": { price: 0.48, volatility: 0.045 },
  "AVAX/USDT": { price: 38, volatility: 0.055 },
  "DOT/USDT": { price: 9.5, volatility: 0.04 },
  "DOGE/USDT": { price: 0.12, volatility: 0.06 },
  "SHIB/USDT": { price: 0.000032, volatility: 0.07 },
};

// Helper function to get current price with some random movement
function getCurrentPrice(asset: string): number {
  const baseData = PRICE_DATA[asset] || { price: 1000, volatility: 0.02 };
  const randomFactor = 1 + (Math.random() * 2 - 1) * baseData.volatility;
  return baseData.price * randomFactor;
}

// Schedule simulated trades for active bots
let simulationInterval: NodeJS.Timeout | null = null;

export function startSimulation() {
  if (simulationInterval) {
    clearInterval(simulationInterval);
  }
  
  simulationInterval = setInterval(async () => {
    try {
      // Get all active bots
      const activeBots = await db.select().from(speculationBots).where(eq(speculationBots.status, "active"));
      
      for (const bot of activeBots) {
        await simulateTrade(bot.id);
      }
    } catch (error) {
      console.error("Error in speculation simulation:", error);
    }
  }, 60000); // Run every minute
}

// Run simulation at startup
startSimulation();

// Simulate a trade for a bot based on its strategy
async function simulateTrade(botId: number) {
  try {
    // Get bot details
    const [bot] = await db
      .select()
      .from(speculationBots)
      .where(eq(speculationBots.id, botId));
    
    if (!bot) return;
    
    // Get current price for the asset
    const currentPrice = getCurrentPrice(bot.asset);
    
    // Simulate trade decision based on strategy
    const shouldTrade = Math.random() > 0.7; // 30% chance to trade
    
    if (!shouldTrade) return;
    
    // Decide buy or sell
    const tradeType = Math.random() > 0.5 ? "buy" : "sell";
    
    const currentBalanceNum = parseFloat(bot.currentBalance.toString());
    
    // Get recent trade history to check if we have any of this asset
    const recentTrades = await db
      .select()
      .from(speculationTrades)
      .where(eq(speculationTrades.botId, bot.id))
      .orderBy(desc(speculationTrades.executedAt))
      .limit(100);
    
    // Calculate total asset holdings based on trade history
    let assetHoldings = 0;
    for (const trade of recentTrades) {
      if (trade.asset === bot.asset) {
        const tradeAmount = parseFloat(trade.amount);
        if (trade.type === "buy") {
          assetHoldings += tradeAmount;
        } else {
          assetHoldings -= tradeAmount;
        }
      }
    }
    
    // For buys: calculate how much of the asset we can buy with a portion of our balance
    // For sells: calculate how much of the asset to sell based on what we own
    let tradeAmount: number;
    let total: number;
    
    // Get initial balance for later use in profit calculations
    const initialBalance = parseFloat(bot.initialBalance.toString());
    
    if (tradeType === "buy") {
      // Make sure we never use more than 10% of balance for a single buy
      const maxBuyPercentage = 0.1;
      const balanceToUse = currentBalanceNum * (0.01 + Math.random() * maxBuyPercentage);
      
      // If the balance is too small, don't trade
      if (balanceToUse < 5) return;
      
      // Calculate how much of the asset we can buy with that amount
      tradeAmount = parseFloat((balanceToUse / currentPrice).toFixed(8));
      
      // Make the amount more realistic
      if (currentPrice > 10000) { // For expensive assets like BTC
        // Most retail traders buy small fractions of BTC, rarely a whole coin
        tradeAmount = Math.min(tradeAmount, 0.05 + (Math.random() * 0.1));
      } else if (currentPrice > 1000) { // For mid-price assets like ETH
        tradeAmount = Math.min(tradeAmount, 0.5 + (Math.random() * 0.5));
      }
      
      total = parseFloat((tradeAmount * currentPrice).toFixed(2));
      
      // Double-check we aren't spending more than we have
      if (total > currentBalanceNum * 0.9) {
        return; // Skip if this would use too much of our balance
      }
    } else { // Sell
      // If we don't have any assets or very little, don't sell
      if (assetHoldings <= 0.0001) return;
      
      // Sell a portion of what we own (5-15%)
      const sellPercentage = 0.05 + Math.random() * 0.1;
      tradeAmount = parseFloat((assetHoldings * sellPercentage).toFixed(8));
      
      // Make sure we're not selling more than we have
      tradeAmount = Math.min(tradeAmount, assetHoldings * 0.9);
      
      total = parseFloat((tradeAmount * currentPrice).toFixed(2));
    }
    
    // Skip if amounts are invalid or too small
    if (tradeAmount <= 0 || total <= 0) return;
    
    // For low-value assets like SHIB, ensure reasonable amounts
    if (currentPrice < 0.001 && tradeAmount < 100) {
      tradeAmount = parseFloat((tradeAmount * 100).toFixed(8));
      total = parseFloat((tradeAmount * currentPrice).toFixed(2));
    }
    
    // Calculate fee (0.1%)
    const fee = parseFloat((total * 0.001).toFixed(2));
    
    // Execute the trade
    const trade: InsertSpeculationTrade = {
      botId: bot.id,
      type: tradeType,
      asset: bot.asset,
      price: currentPrice.toFixed(2),
      amount: tradeAmount.toString(),
      total: total.toString(),
      fee: fee.toString(),
      notes: `Simulated ${bot.strategy} strategy trade`,
      status: "executed"
    };
    
    // Insert the trade
    await db.insert(speculationTrades).values(trade);
    
    // Update bot balance and stats
    const newBalance = tradeType === "buy" 
      ? parseFloat((currentBalanceNum - total - fee).toFixed(8))
      : parseFloat((currentBalanceNum + total - fee).toFixed(8));
    
    // Calculate profit/loss
    const profitLoss = parseFloat((newBalance - initialBalance).toFixed(8));
    const profitLossPercentage = parseFloat(((profitLoss / initialBalance) * 100).toFixed(2));
    
    await db.update(speculationBots)
      .set({
        currentBalance: newBalance.toString(),
        profitLoss: profitLoss.toString(),
        profitLossPercentage: profitLossPercentage.toString(),
        tradesExecuted: bot.tradesExecuted + 1,
        lastTradeAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(speculationBots.id, bot.id));
      
  } catch (error) {
    console.error(`Error simulating trade for bot ${botId}:`, error);
  }
}

// Create a new speculation bot
export async function createSpeculationBot(data: InsertSpeculationBot) {
  const currentBalance = parseFloat(data.initialBalance.toString());
  
  const bot = await db.insert(speculationBots)
    .values({
      ...data,
      currentBalance: currentBalance.toString(),
      status: "stopped"
    })
    .returning();
    
  return bot[0];
}

// Get all speculation bots for a user
export async function getUserSpeculationBots(userId: number) {
  return db
    .select()
    .from(speculationBots)
    .where(eq(speculationBots.userId, userId))
    .orderBy(desc(speculationBots.createdAt));
}

// Get a specific speculation bot
export async function getSpeculationBot(botId: number) {
  const [bot] = await db
    .select()
    .from(speculationBots)
    .where(eq(speculationBots.id, botId));
    
  return bot;
}

// Start, pause or stop a speculation bot
export async function updateBotStatus(botId: number, userId: number, status: "active" | "paused" | "stopped") {
  const [bot] = await db
    .select()
    .from(speculationBots)
    .where(and(
      eq(speculationBots.id, botId),
      eq(speculationBots.userId, userId)
    ));
    
  if (!bot) {
    throw new Error("Bot not found or not owned by user");
  }
  
  const updatedBot = await db
    .update(speculationBots)
    .set({
      status,
      updatedAt: new Date()
    })
    .where(eq(speculationBots.id, botId))
    .returning();
    
  return updatedBot[0];
}

// Update bot settings (name, strategy, initialBalance, etc.)
export async function updateSpeculationBot(botId: number, userId: number, data: any) {
  // First check if bot exists and belongs to user
  const [bot] = await db
    .select()
    .from(speculationBots)
    .where(and(
      eq(speculationBots.id, botId),
      eq(speculationBots.userId, userId)
    ));
    
  if (!bot) {
    throw new Error("Bot not found or not owned by user");
  }
  
  // Handle special case where initialBalance is being updated
  if (data.initialBalance && data.initialBalance !== bot.initialBalance) {
    // Calculate new current balance based on relative change in initial balance
    const initialBalanceNum = parseFloat(bot.initialBalance.toString());
    const currentBalanceNum = parseFloat(bot.currentBalance.toString());
    const newInitialBalanceNum = parseFloat(data.initialBalance.toString());
    
    // Adjust current balance proportionally
    const ratio = currentBalanceNum / initialBalanceNum;
    const newCurrentBalance = (newInitialBalanceNum * ratio).toFixed(2);
    
    // Update profitLoss calculations
    const newProfitLoss = (parseFloat(newCurrentBalance) - newInitialBalanceNum).toFixed(2);
    const newProfitLossPercentage = ((parseFloat(newProfitLoss) / newInitialBalanceNum) * 100).toFixed(2);
    
    // Add these calculated fields to the update data
    data.currentBalance = newCurrentBalance;
    data.profitLoss = newProfitLoss;
    data.profitLossPercentage = newProfitLossPercentage;
  }
  
  // Update the bot with the new data
  const updatedBot = await db
    .update(speculationBots)
    .set({
      ...data,
      updatedAt: new Date()
    })
    .where(eq(speculationBots.id, botId))
    .returning();
    
  return updatedBot[0];
}

// Delete a speculation bot
export async function deleteSpeculationBot(botId: number, userId: number) {
  // First check if bot exists and belongs to user
  const [bot] = await db
    .select()
    .from(speculationBots)
    .where(and(
      eq(speculationBots.id, botId),
      eq(speculationBots.userId, userId)
    ));
    
  if (!bot) {
    throw new Error("Bot not found or not owned by user");
  }
  
  // Delete associated trades
  await db
    .delete(speculationTrades)
    .where(eq(speculationTrades.botId, botId));
    
  // Delete the bot
  await db
    .delete(speculationBots)
    .where(eq(speculationBots.id, botId));
    
  return { success: true };
}

// Get trades for a speculation bot
export async function getBotTrades(botId: number, userId: number) {
  // First check if bot exists and belongs to user
  const [bot] = await db
    .select()
    .from(speculationBots)
    .where(and(
      eq(speculationBots.id, botId),
      eq(speculationBots.userId, userId)
    ));
    
  if (!bot) {
    throw new Error("Bot not found or not owned by user");
  }
  
  // Get trades
  return db
    .select()
    .from(speculationTrades)
    .where(eq(speculationTrades.botId, botId))
    .orderBy(desc(speculationTrades.executedAt));
}

// Get all trades for a user's bots
export async function getUserTrades(userId: number) {
  const bots = await getUserSpeculationBots(userId);
  const botIds = bots.map(bot => bot.id);
  
  if (botIds.length === 0) {
    return [];
  }
  
  // Get all trades for user's bots
  const trades = await db
    .select({
      trade: speculationTrades,
      bot: {
        id: speculationBots.id,
        name: speculationBots.name
      }
    })
    .from(speculationTrades)
    .innerJoin(
      speculationBots,
      eq(speculationTrades.botId, speculationBots.id)
    )
    .where(eq(speculationBots.userId, userId))
    .orderBy(desc(speculationTrades.executedAt));
    
  return trades.map(({ trade, bot }) => ({
    ...trade,
    botName: bot.name
  }));
}

// Clear all trades for a user's bots and reset balances to initial values
export async function clearAllUserTrades(userId: number) {
  try {
    const bots = await getUserSpeculationBots(userId);
    const botIds = bots.map(bot => bot.id);
    
    if (botIds.length === 0) {
      return { success: true, message: "No bots found for this user" };
    }
    
    // First, delete all trades for these bots
    await db
      .delete(speculationTrades)
      .where(
        botIds.length === 1
          ? eq(speculationTrades.botId, botIds[0])
          : inArray(speculationTrades.botId, botIds)
      );
    
    // Reset each bot's stats and balance to initial values
    for (const bot of bots) {
      await db.update(speculationBots)
        .set({
          currentBalance: bot.initialBalance,
          profitLoss: "0",
          profitLossPercentage: "0",
          tradesExecuted: 0,
          lastTradeAt: null,
          updatedAt: new Date()
        })
        .where(eq(speculationBots.id, bot.id));
    }
    
    return { success: true, message: `All trades cleared for ${botIds.length} bots` };
  } catch (error) {
    console.error("Error clearing user trades:", error);
    throw error;
  }
}