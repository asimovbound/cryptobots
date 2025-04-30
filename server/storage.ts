import {
  User, InsertUser, users,
  Exchange, InsertExchange, exchanges,
  Bot, InsertBot, bots, 
  TradingPair, InsertTradingPair, tradingPairs,
  Trade, InsertTrade, trades,
  Portfolio, InsertPortfolio, portfolios,
  PortfolioAllocation, InsertPortfolioAllocation, portfolioAllocations,
  BacktestResult, InsertBacktestResult, backtestResults,
  OptimizationResult, InsertOptimizationResult, optimizationResults,
  AiRecommendation, InsertAiRecommendation, aiRecommendations,
  WatchlistItem, InsertWatchlistItem, watchlistItems,
  Wallet, InsertWallet, wallets,
  SupportedExchange, InsertSupportedExchange, supportedExchanges,
  BacktestHistory, InsertBacktestHistory, backtestHistory,
  DefaultStrategy, InsertDefaultStrategy, defaultStrategies
} from "@shared/schema";
import { db } from "./db";
import { eq, and, not, inArray, desc } from "drizzle-orm";

// Interface for storage operations
export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  
  // Exchange operations
  getExchange(id: number): Promise<Exchange | undefined>;
  getExchangesByUserId(userId: number): Promise<Exchange[]>;
  getAllExchanges(): Promise<Exchange[]>;
  createExchange(exchange: InsertExchange): Promise<Exchange>;
  updateExchange(id: number, updates: Partial<Exchange>): Promise<Exchange | undefined>;
  updateExchangeStatus(id: number, connected: boolean): Promise<Exchange | undefined>;
  deleteExchange(id: number): Promise<boolean>;
  
  // Supported Exchanges operations
  getSupportedExchanges(): Promise<SupportedExchange[]>;
  getSupportedExchange(id: number): Promise<SupportedExchange | undefined>;
  getSupportedExchangeByName(name: string): Promise<SupportedExchange | undefined>;
  addSupportedExchange(exchange: InsertSupportedExchange): Promise<SupportedExchange>;
  updateSupportedExchange(id: number, updates: Partial<SupportedExchange>): Promise<SupportedExchange | undefined>;
  toggleSupportedExchange(id: number, isEnabled: boolean): Promise<SupportedExchange | undefined>;
  
  // Bot operations
  getBot(id: number): Promise<Bot | undefined>;
  getBotsByUserId(userId: number): Promise<Bot[]>;
  createBot(bot: InsertBot): Promise<Bot>;
  updateBot(id: number, updates: Partial<Bot>): Promise<Bot | undefined>;
  updateBotStatus(id: number, status: string): Promise<Bot | undefined>;
  deleteBot(id: number): Promise<boolean>;
  deleteBotTrades(botId: number): Promise<boolean>;
  
  // Trading pair operations
  getTradingPair(id: number): Promise<TradingPair | undefined>;
  getTradingPairBySymbol(symbol: string): Promise<TradingPair | undefined>;
  getTradingPairsByExchangeId(exchangeId: number): Promise<TradingPair[]>;
  getAllTradingPairs(): Promise<TradingPair[]>;
  createTradingPair(pair: InsertTradingPair): Promise<TradingPair>;
  updateTradingPair(id: number, updates: Partial<TradingPair>): Promise<TradingPair | undefined>;
  updateTradingPairs(exchangeId: number, updates: Partial<TradingPair>): Promise<void>;
  removeInactiveTradingPairs(exchangeId: number, activeSymbols: string[]): Promise<void>;
  batchCreateTradingPairs(pairs: InsertTradingPair[]): Promise<TradingPair[]>;
  
  // Trade operations
  getTrade(id: number): Promise<Trade | undefined>;
  getTradesByBotId(botId: number): Promise<Trade[]>;
  createTrade(trade: InsertTrade): Promise<Trade>;
  updateTrade(id: number, updates: Partial<Trade>): Promise<Trade | undefined>;
  
  // Portfolio operations
  getPortfolio(id: number): Promise<Portfolio | undefined>;
  getPortfoliosByUserId(userId: number): Promise<Portfolio[]>;
  createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio>;
  updatePortfolio(id: number, updates: Partial<Portfolio>): Promise<Portfolio | undefined>;
  
  // Portfolio allocation operations
  getPortfolioAllocation(id: number): Promise<PortfolioAllocation | undefined>;
  getPortfolioAllocationsByPortfolioId(portfolioId: number): Promise<PortfolioAllocation[]>;
  createPortfolioAllocation(allocation: InsertPortfolioAllocation): Promise<PortfolioAllocation>;
  updatePortfolioAllocation(id: number, updates: Partial<PortfolioAllocation>): Promise<PortfolioAllocation | undefined>;
  
  // Backtest operations
  getBacktestResult(id: number): Promise<BacktestResult | undefined>;
  getBacktestResultsByBotId(botId: number): Promise<BacktestResult[]>;
  createBacktestResult(result: InsertBacktestResult): Promise<BacktestResult>;
  
  // Optimization operations
  getOptimizationResult(id: number): Promise<OptimizationResult | undefined>;
  getOptimizationResultsByBotId(botId: number): Promise<OptimizationResult[]>;
  createOptimizationResult(result: InsertOptimizationResult): Promise<OptimizationResult>;
  updateOptimizationResult(id: number, updates: Partial<OptimizationResult>): Promise<OptimizationResult | undefined>;
  
  // AI recommendation operations
  getAiRecommendation(id: number): Promise<AiRecommendation | undefined>;
  getAiRecommendationsByUserId(userId: number): Promise<AiRecommendation[]>;
  createAiRecommendation(recommendation: InsertAiRecommendation): Promise<AiRecommendation>;
  updateAiRecommendationStatus(id: number, status: string): Promise<AiRecommendation | undefined>;
  
  // Watchlist operations
  getWatchlistItem(id: number): Promise<WatchlistItem | undefined>;
  getWatchlist(userId: number): Promise<WatchlistItem[]>;
  getWatchlistByFolder(userId: number, folderName: string): Promise<WatchlistItem[]>;
  addToWatchlist(userId: number, item: Partial<InsertWatchlistItem>): Promise<WatchlistItem>;
  removeFromWatchlist(userId: number, id: string): Promise<boolean>;
  updateWatchlistItem(id: number, updates: Partial<WatchlistItem>): Promise<WatchlistItem | undefined>;
  
  // Wallet operations
  getWallet(id: number): Promise<Wallet | undefined>;
  getWalletsByUserId(userId: number): Promise<Wallet[]>;
  createWallet(wallet: InsertWallet): Promise<Wallet>;
  updateWallet(id: number, updates: Partial<Wallet>): Promise<Wallet | undefined>;
  deleteWallet(id: number): Promise<boolean>;
  
  // Backtest History operations - for standalone backtests
  getBacktestHistory(id: number): Promise<BacktestHistory | undefined>;
  getBacktestHistoryByUserId(userId: number, limit?: number): Promise<BacktestHistory[]>;
  createBacktestHistory(history: InsertBacktestHistory): Promise<BacktestHistory>;
  deleteBacktestHistory(id: number): Promise<boolean>;
  
  // Default Strategy operations
  getDefaultStrategy(id: number): Promise<DefaultStrategy | undefined>;
  getDefaultStrategyByName(name: string): Promise<DefaultStrategy | undefined>;
  getAllDefaultStrategies(): Promise<DefaultStrategy[]>;
  getDefaultStrategiesByCategory(category: string): Promise<DefaultStrategy[]>;
  getDefaultStrategiesByType(strategyType: string): Promise<DefaultStrategy[]>;
  createDefaultStrategy(strategy: InsertDefaultStrategy): Promise<DefaultStrategy>;
  updateDefaultStrategy(id: number, updates: Partial<DefaultStrategy>): Promise<DefaultStrategy | undefined>;
  deleteDefaultStrategy(id: number): Promise<boolean>;
}

// Database storage implementation
export class DatabaseStorage implements IStorage {
  // User operations
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }
  
  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [updatedUser] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return updatedUser;
  }
  
  // Exchange operations
  async getExchange(id: number): Promise<Exchange | undefined> {
    const [exchange] = await db.select().from(exchanges).where(eq(exchanges.id, id));
    return exchange;
  }
  
  // Alias for getExchange method - for semantic clarity in some contexts
  async getExchangeById(id: number): Promise<Exchange | undefined> {
    return this.getExchange(id);
  }
  
  async getExchangesByUserId(userId: number): Promise<Exchange[]> {
    return await db.select().from(exchanges).where(eq(exchanges.userId, userId));
  }
  
  async createExchange(exchange: InsertExchange): Promise<Exchange> {
    const [newExchange] = await db.insert(exchanges).values(exchange).returning();
    return newExchange;
  }
  
  async updateExchange(id: number, updates: Partial<Exchange>): Promise<Exchange | undefined> {
    const [updatedExchange] = await db.update(exchanges)
      .set(updates)
      .where(eq(exchanges.id, id))
      .returning();
    return updatedExchange;
  }

  async updateExchangeStatus(id: number, connected: boolean): Promise<Exchange | undefined> {
    const status = connected ? 'connected' : 'disconnected';
    const [updatedExchange] = await db.update(exchanges)
      .set({ status })
      .where(eq(exchanges.id, id))
      .returning();
    return updatedExchange;
  }
  
  async deleteExchange(id: number): Promise<boolean> {
    try {
      // Get exchange info for cleaning up other references
      const [exchange] = await db.select().from(exchanges).where(eq(exchanges.id, id));
      if (!exchange) {
        console.error(`Exchange with ID ${id} not found`);
        return false;
      }
      
      // 1. First, delete any trading pairs associated with this exchange
      await db.delete(tradingPairs).where(eq(tradingPairs.exchangeId, id));
      console.log(`Deleted trading pairs for exchange ID ${id}`);
      
      // 2. Delete any bots associated with this exchange
      await db.delete(bots).where(eq(bots.exchangeId, id));
      console.log(`Deleted bots for exchange ID ${id}`);
      
      // 3. Delete watchlist items related to this exchange
      await db.delete(watchlistItems).where(eq(watchlistItems.exchange, exchange.name));
      console.log(`Deleted watchlist items for exchange ${exchange.name}`);
      
      // 4. Clean up any portfolio allocations related to this exchange
      // Find portfolio allocations where assetType is 'exchange' and assetId is the exchange ID
      await db.delete(portfolioAllocations)
        .where(and(
          eq(portfolioAllocations.assetType, 'exchange'),
          eq(portfolioAllocations.assetId, id)
        ));
      console.log(`Deleted portfolio allocations for exchange ID ${id}`);
      
      // 5. Finally, delete the exchange itself
      await db.delete(exchanges).where(eq(exchanges.id, id));
      console.log(`Exchange with ID ${id} deleted successfully`);
      
      return true;
    } catch (error) {
      console.error(`Error deleting exchange with ID ${id}:`, error);
      return false;
    }
  }
  
  // Bot operations
  async getBot(id: number): Promise<Bot | undefined> {
    const [bot] = await db.select().from(bots).where(eq(bots.id, id));
    return bot;
  }
  
  async getBotsByUserId(userId: number): Promise<Bot[]> {
    return await db.select().from(bots).where(eq(bots.userId, userId));
  }
  
  async createBot(bot: InsertBot): Promise<Bot> {
    const [newBot] = await db.insert(bots).values(bot).returning();
    return newBot;
  }
  
  async updateBot(id: number, updates: Partial<Bot>): Promise<Bot | undefined> {
    const [updatedBot] = await db.update(bots)
      .set({
        ...updates,
        lastUpdated: new Date()
      })
      .where(eq(bots.id, id))
      .returning();
    return updatedBot;
  }
  
  async updateBotStatus(id: number, status: string): Promise<Bot | undefined> {
    return this.updateBot(id, { status: status as "active" | "stopped" | "paused" });
  }
  
  async deleteBot(id: number): Promise<boolean> {
    try {
      // Get bot info to check if it exists
      const bot = await this.getBot(id);
      if (!bot) {
        console.error(`Bot with ID ${id} not found`);
        return false;
      }
      
      // Delete the bot from the database
      await db.delete(bots).where(eq(bots.id, id));
      console.log(`Bot with ID ${id} deleted successfully`);
      
      return true;
    } catch (error) {
      console.error(`Error deleting bot with ID ${id}:`, error);
      return false;
    }
  }
  
  async deleteBotTrades(botId: number): Promise<boolean> {
    try {
      // Delete all trades associated with this bot
      await db.delete(trades).where(eq(trades.botId, botId));
      console.log(`Trades for bot ID ${botId} deleted successfully`);
      
      return true;
    } catch (error) {
      console.error(`Error deleting trades for bot ID ${botId}:`, error);
      return false;
    }
  }
  
  // Trading pair operations
  async getTradingPair(id: number): Promise<TradingPair | undefined> {
    const [pair] = await db.select().from(tradingPairs).where(eq(tradingPairs.id, id));
    return pair;
  }
  
  async getTradingPairBySymbol(symbol: string): Promise<TradingPair | undefined> {
    const [pair] = await db.select().from(tradingPairs).where(eq(tradingPairs.symbol, symbol));
    return pair;
  }
  
  async getTradingPairsByExchangeId(exchangeId: number): Promise<TradingPair[]> {
    return await db.select().from(tradingPairs).where(eq(tradingPairs.exchangeId, exchangeId));
  }
  
  async createTradingPair(pair: InsertTradingPair): Promise<TradingPair> {
    try {
      // Check if this trading pair already exists for this exchange
      const existingPairs = await db.select()
        .from(tradingPairs)
        .where(and(
          eq(tradingPairs.symbol, pair.symbol),
          eq(tradingPairs.exchangeId, pair.exchangeId)
        ));
      
      if (existingPairs.length > 0) {
        // Trading pair already exists for this exchange, return the existing one
        console.log(`Trading pair ${pair.symbol} already exists for exchange ID ${pair.exchangeId}, returning existing pair`);
        return existingPairs[0];
      }
      
      // Doesn't exist, create a new pair
      const [newPair] = await db.insert(tradingPairs).values(pair).returning();
      return newPair;
    } catch (error) {
      console.error(`Error creating trading pair:`, error);
      
      // Check if the error is a unique constraint violation
      if (error instanceof Error && error.message.includes('duplicate key value violates unique constraint')) {
        // Try to get the existing pair by symbol
        const [existingPair] = await db.select()
          .from(tradingPairs)
          .where(eq(tradingPairs.symbol, pair.symbol));
        
        if (existingPair) {
          console.log(`Retrieved existing pair ${pair.symbol} after constraint error`);
          return existingPair;
        }
      }
      
      // Re-throw if we couldn't handle the error
      throw error;
    }
  }
  
  async updateTradingPair(id: number, updates: Partial<TradingPair>): Promise<TradingPair | undefined> {
    const [updatedPair] = await db.update(tradingPairs)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(tradingPairs.id, id))
      .returning();
    return updatedPair;
  }
  
  // Trade operations
  async getTrade(id: number): Promise<Trade | undefined> {
    const [trade] = await db.select().from(trades).where(eq(trades.id, id));
    return trade;
  }
  
  async getTradesByBotId(botId: number): Promise<Trade[]> {
    return await db.select().from(trades).where(eq(trades.botId, botId));
  }
  
  async createTrade(trade: InsertTrade): Promise<Trade> {
    const [newTrade] = await db.insert(trades).values(trade).returning();
    return newTrade;
  }
  
  async updateTrade(id: number, updates: Partial<Trade>): Promise<Trade | undefined> {
    const [updatedTrade] = await db.update(trades)
      .set(updates)
      .where(eq(trades.id, id))
      .returning();
    return updatedTrade;
  }
  
  // Portfolio operations
  async getPortfolio(id: number): Promise<Portfolio | undefined> {
    const [portfolio] = await db.select().from(portfolios).where(eq(portfolios.id, id));
    return portfolio;
  }
  
  async getPortfoliosByUserId(userId: number): Promise<Portfolio[]> {
    return await db.select().from(portfolios).where(eq(portfolios.userId, userId));
  }
  
  async createPortfolio(portfolio: InsertPortfolio): Promise<Portfolio> {
    const [newPortfolio] = await db.insert(portfolios).values(portfolio).returning();
    return newPortfolio;
  }
  
  async updatePortfolio(id: number, updates: Partial<Portfolio>): Promise<Portfolio | undefined> {
    const [updatedPortfolio] = await db.update(portfolios)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(portfolios.id, id))
      .returning();
    return updatedPortfolio;
  }
  
  // Portfolio allocation operations
  async getPortfolioAllocation(id: number): Promise<PortfolioAllocation | undefined> {
    const [allocation] = await db.select().from(portfolioAllocations).where(eq(portfolioAllocations.id, id));
    return allocation;
  }
  
  async getPortfolioAllocationsByPortfolioId(portfolioId: number): Promise<PortfolioAllocation[]> {
    return await db.select().from(portfolioAllocations).where(eq(portfolioAllocations.portfolioId, portfolioId));
  }
  
  async createPortfolioAllocation(allocation: InsertPortfolioAllocation): Promise<PortfolioAllocation> {
    const [newAllocation] = await db.insert(portfolioAllocations).values(allocation).returning();
    return newAllocation;
  }
  
  async updatePortfolioAllocation(id: number, updates: Partial<PortfolioAllocation>): Promise<PortfolioAllocation | undefined> {
    const [updatedAllocation] = await db.update(portfolioAllocations)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(portfolioAllocations.id, id))
      .returning();
    return updatedAllocation;
  }
  
  // Backtest operations
  async getBacktestResult(id: number): Promise<BacktestResult | undefined> {
    const [result] = await db.select().from(backtestResults).where(eq(backtestResults.id, id));
    return result;
  }
  
  async getBacktestResultsByBotId(botId: number): Promise<BacktestResult[]> {
    return await db.select().from(backtestResults).where(eq(backtestResults.botId, botId));
  }
  
  async createBacktestResult(result: InsertBacktestResult): Promise<BacktestResult> {
    const [newResult] = await db.insert(backtestResults).values(result).returning();
    return newResult;
  }
  
  // Optimization operations
  async getOptimizationResult(id: number): Promise<OptimizationResult | undefined> {
    const [result] = await db.select().from(optimizationResults).where(eq(optimizationResults.id, id));
    return result;
  }
  
  async getOptimizationResultsByBotId(botId: number): Promise<OptimizationResult[]> {
    return await db.select().from(optimizationResults).where(eq(optimizationResults.botId, botId));
  }
  
  async createOptimizationResult(result: InsertOptimizationResult): Promise<OptimizationResult> {
    const [newResult] = await db.insert(optimizationResults).values(result).returning();
    return newResult;
  }
  
  // AI recommendation operations
  async getAiRecommendation(id: number): Promise<AiRecommendation | undefined> {
    const [recommendation] = await db.select().from(aiRecommendations).where(eq(aiRecommendations.id, id));
    return recommendation;
  }
  
  async getAiRecommendationsByUserId(userId: number): Promise<AiRecommendation[]> {
    return await db.select().from(aiRecommendations).where(eq(aiRecommendations.userId, userId));
  }
  
  async createAiRecommendation(recommendation: InsertAiRecommendation): Promise<AiRecommendation> {
    const [newRecommendation] = await db.insert(aiRecommendations).values(recommendation).returning();
    return newRecommendation;
  }
  
  async updateAiRecommendationStatus(id: number, status: string): Promise<AiRecommendation | undefined> {
    const [updatedRecommendation] = await db.update(aiRecommendations)
      .set({
        status,
        appliedAt: status === "applied" ? new Date() : null
      })
      .where(eq(aiRecommendations.id, id))
      .returning();
    return updatedRecommendation;
  }
  
  // Watchlist operations
  async getWatchlistItem(id: number): Promise<WatchlistItem | undefined> {
    const [item] = await db.select().from(watchlistItems).where(eq(watchlistItems.id, id));
    return item;
  }
  
  async getWatchlist(userId: number): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId));
  }
  
  async getWatchlistByFolder(userId: number, folderName: string): Promise<WatchlistItem[]> {
    return await db.select().from(watchlistItems)
      .where(and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.folderName, folderName)
      ));
  }
  
  async addToWatchlist(userId: number, item: Partial<InsertWatchlistItem>): Promise<WatchlistItem> {
    // First check if the item already exists
    const existingItems = await db.select().from(watchlistItems)
      .where(and(
        eq(watchlistItems.userId, userId),
        eq(watchlistItems.symbol, item.symbol || ''),
        eq(watchlistItems.exchange, item.exchange || '')
      ));
    
    if (existingItems.length > 0) {
      // Update existing item
      const [updatedItem] = await db.update(watchlistItems)
        .set({
          ...item,
          updatedAt: new Date()
        })
        .where(eq(watchlistItems.id, existingItems[0].id))
        .returning();
      return updatedItem;
    }
    
    // Add new item
    const [newItem] = await db.insert(watchlistItems)
      .values({
        ...item,
        userId,
        createdAt: new Date(),
        updatedAt: new Date()
      } as InsertWatchlistItem)
      .returning();
    return newItem;
  }
  
  async removeFromWatchlist(userId: number, id: string): Promise<boolean> {
    try {
      await db.delete(watchlistItems)
        .where(and(
          eq(watchlistItems.userId, userId),
          eq(watchlistItems.id, parseInt(id))
        ));
      return true;
    } catch (error) {
      console.error('Error removing item from watchlist:', error);
      return false;
    }
  }
  
  async updateWatchlistItem(id: number, updates: Partial<WatchlistItem>): Promise<WatchlistItem | undefined> {
    const [updatedItem] = await db.update(watchlistItems)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(watchlistItems.id, id))
      .returning();
    return updatedItem;
  }
  
  // Wallet operations
  async getWallet(id: number): Promise<Wallet | undefined> {
    const [wallet] = await db.select().from(wallets).where(eq(wallets.id, id));
    return wallet;
  }
  
  async getWalletsByUserId(userId: number): Promise<Wallet[]> {
    return await db.select().from(wallets).where(eq(wallets.userId, userId));
  }
  
  async createWallet(wallet: InsertWallet): Promise<Wallet> {
    const [newWallet] = await db.insert(wallets).values(wallet).returning();
    return newWallet;
  }
  
  async updateWallet(id: number, updates: Partial<Wallet>): Promise<Wallet | undefined> {
    const [updatedWallet] = await db.update(wallets)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(wallets.id, id))
      .returning();
    return updatedWallet;
  }
  
  async deleteWallet(id: number): Promise<boolean> {
    try {
      // First, find the wallet to ensure it exists
      const wallet = await this.getWallet(id);
      if (!wallet) {
        console.error(`Wallet with ID ${id} not found`);
        return false;
      }
      
      // Delete the wallet
      await db.delete(wallets).where(eq(wallets.id, id));
      console.log(`Wallet with ID ${id} deleted successfully`);
      
      return true;
    } catch (error) {
      console.error(`Error deleting wallet with ID ${id}:`, error);
      return false;
    }
  }

  // Supported Exchanges operations
  async getSupportedExchanges(): Promise<SupportedExchange[]> {
    return await db.select().from(supportedExchanges).orderBy(supportedExchanges.sortOrder);
  }

  async getSupportedExchange(id: number): Promise<SupportedExchange | undefined> {
    const [exchange] = await db.select().from(supportedExchanges).where(eq(supportedExchanges.id, id));
    return exchange;
  }

  async getSupportedExchangeByName(name: string): Promise<SupportedExchange | undefined> {
    const [exchange] = await db.select().from(supportedExchanges).where(eq(supportedExchanges.name, name.toLowerCase()));
    return exchange;
  }

  async addSupportedExchange(exchange: InsertSupportedExchange): Promise<SupportedExchange> {
    // Check if exchange already exists
    const existingExchange = await this.getSupportedExchangeByName(exchange.name);
    if (existingExchange) {
      console.log(`Exchange ${exchange.name} already exists in supported exchanges, returning existing one`);
      return existingExchange;
    }

    const [newExchange] = await db.insert(supportedExchanges).values(exchange).returning();
    return newExchange;
  }

  async updateSupportedExchange(id: number, updates: Partial<SupportedExchange>): Promise<SupportedExchange | undefined> {
    const [updatedExchange] = await db.update(supportedExchanges)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(supportedExchanges.id, id))
      .returning();
    return updatedExchange;
  }

  async toggleSupportedExchange(id: number, isEnabled: boolean): Promise<SupportedExchange | undefined> {
    return this.updateSupportedExchange(id, { isEnabled });
  }
  
  // Get all exchanges in the system
  async getAllExchanges(): Promise<Exchange[]> {
    return await db.select().from(exchanges);
  }

  // New method for batch-creating trading pairs (optimized for performance)
  async batchCreateTradingPairs(pairs: InsertTradingPair[]): Promise<TradingPair[]> {
    if (pairs.length === 0) return [];

    try {
      // First, get all existing trading pairs for the exchange to avoid duplicates
      const exchangeId = pairs[0].exchangeId; // Assuming all pairs are for the same exchange
      const existingPairs = await this.getTradingPairsByExchangeId(exchangeId);
      
      // Filter out pairs that already exist
      const existingSymbols = new Set(existingPairs.map(p => p.symbol));
      const newPairs = pairs.filter(p => !existingSymbols.has(p.symbol));
      
      if (newPairs.length === 0) {
        console.log('All trading pairs already exist, returning existing pairs');
        return existingPairs;
      }
      
      // Insert the new pairs in a single batch operation
      const insertedPairs = await db.insert(tradingPairs).values(newPairs).returning();
      
      // Combine existing and newly inserted pairs
      const result = [...existingPairs];
      for (const pair of insertedPairs) {
        if (!existingSymbols.has(pair.symbol)) {
          result.push(pair);
        }
      }
      
      return result;
    } catch (error) {
      console.error('Error batch-creating trading pairs:', error);
      throw error;
    }
  }
  
  // Get all trading pairs in the database
  async getAllTradingPairs(): Promise<TradingPair[]> {
    return await db.select().from(tradingPairs);
  }
  
  // Update multiple trading pairs at once
  async updateTradingPairs(exchangeId: number, updates: Partial<TradingPair>): Promise<void> {
    await db.update(tradingPairs)
      .set({
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(tradingPairs.exchangeId, exchangeId));
  }
  
  // Delete trading pairs that are no longer active for an exchange
  async removeInactiveTradingPairs(exchangeId: number, activeSymbols: string[]): Promise<void> {
    await db.update(tradingPairs)
      .set({ active: false })
      .where(
        and(
          eq(tradingPairs.exchangeId, exchangeId),
          not(inArray(tradingPairs.symbol, activeSymbols))
        )
      );
  }

  // Fix for updateOptimizationResult
  async updateOptimizationResult(id: number, updates: Partial<OptimizationResult>): Promise<OptimizationResult | undefined> {
    const [updatedResult] = await db.update(optimizationResults)
      .set(updates)
      .where(eq(optimizationResults.id, id))
      .returning();
    return updatedResult;
  }
  
  // Backtest History operations
  async getBacktestHistory(id: number): Promise<BacktestHistory | undefined> {
    const [history] = await db.select().from(backtestHistory).where(eq(backtestHistory.id, id));
    return history;
  }
  
  async getBacktestHistoryByUserId(userId: number, limit?: number): Promise<BacktestHistory[]> {
    let query = db.select()
      .from(backtestHistory)
      .where(eq(backtestHistory.userId, userId))
      .orderBy(desc(backtestHistory.createdAt));
    
    if (limit && limit > 0) {
      return await query.limit(limit);
    }
    
    return await query;
  }
  
  async createBacktestHistory(history: InsertBacktestHistory): Promise<BacktestHistory> {
    const [newHistory] = await db.insert(backtestHistory).values(history).returning();
    return newHistory;
  }
  
  async deleteBacktestHistory(id: number): Promise<boolean> {
    try {
      await db.delete(backtestHistory).where(eq(backtestHistory.id, id));
      return true;
    } catch (error) {
      console.error(`Error deleting backtest history with ID ${id}:`, error);
      return false;
    }
  }
  
  // Default Strategy operations
  async getDefaultStrategy(id: number): Promise<DefaultStrategy | undefined> {
    const [strategy] = await db.select().from(defaultStrategies).where(eq(defaultStrategies.id, id));
    return strategy;
  }
  
  async getDefaultStrategyByName(name: string): Promise<DefaultStrategy | undefined> {
    const [strategy] = await db.select().from(defaultStrategies).where(eq(defaultStrategies.name, name));
    return strategy;
  }
  
  async getAllDefaultStrategies(): Promise<DefaultStrategy[]> {
    return await db.select()
      .from(defaultStrategies)
      .where(eq(defaultStrategies.isActive, true))
      .orderBy(defaultStrategies.displayOrder, defaultStrategies.name);
  }
  
  async getDefaultStrategiesByCategory(category: string): Promise<DefaultStrategy[]> {
    return await db.select()
      .from(defaultStrategies)
      .where(and(
        eq(defaultStrategies.category, category),
        eq(defaultStrategies.isActive, true)
      ))
      .orderBy(defaultStrategies.displayOrder, defaultStrategies.name);
  }
  
  async getDefaultStrategiesByType(strategyType: string): Promise<DefaultStrategy[]> {
    return await db.select()
      .from(defaultStrategies)
      .where(and(
        eq(defaultStrategies.strategyType, strategyType),
        eq(defaultStrategies.isActive, true)
      ))
      .orderBy(defaultStrategies.displayOrder, defaultStrategies.name);
  }
  
  async createDefaultStrategy(strategy: InsertDefaultStrategy): Promise<DefaultStrategy> {
    try {
      // Check if a strategy with this name already exists
      const existingStrategy = await this.getDefaultStrategyByName(strategy.name);
      if (existingStrategy) {
        console.log(`Default strategy with name ${strategy.name} already exists, returning existing strategy`);
        return existingStrategy;
      }
      
      // Create new strategy
      const [newStrategy] = await db.insert(defaultStrategies).values(strategy).returning();
      return newStrategy;
    } catch (error) {
      console.error(`Error creating default strategy:`, error);
      throw error;
    }
  }
  
  async updateDefaultStrategy(id: number, updates: Partial<DefaultStrategy>): Promise<DefaultStrategy | undefined> {
    try {
      const [updatedStrategy] = await db.update(defaultStrategies)
        .set({
          ...updates,
          updatedAt: new Date()
        })
        .where(eq(defaultStrategies.id, id))
        .returning();
      return updatedStrategy;
    } catch (error) {
      console.error(`Error updating default strategy with ID ${id}:`, error);
      throw error;
    }
  }
  
  async deleteDefaultStrategy(id: number): Promise<boolean> {
    try {
      await db.delete(defaultStrategies).where(eq(defaultStrategies.id, id));
      return true;
    } catch (error) {
      console.error(`Error deleting default strategy with ID ${id}:`, error);
      return false;
    }
  }
}

// Initialize the database storage
export const storage = new DatabaseStorage();
