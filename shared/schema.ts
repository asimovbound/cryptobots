import { pgTable, text, serial, integer, boolean, timestamp, real, varchar, json, pgEnum, decimal, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// User model
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").unique(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  role: text("role").notNull().default("user"), // user, admin
  isActive: boolean("is_active").default(true),
  isVerified: boolean("is_verified").default(false),
  verificationToken: text("verification_token"),
  resetPasswordToken: text("reset_password_token"),
  resetPasswordExpires: timestamp("reset_password_expires"),
  riskProfile: text("risk_profile").default("moderate"),
  maxDrawdown: real("max_drawdown").default(10),
  lastLogin: timestamp("last_login"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const usersRelations = relations(users, ({ many }) => ({
  exchanges: many(exchanges),
  bots: many(bots),
  portfolios: many(portfolios),
  watchlistItems: many(watchlistItems),
  wallets: many(wallets),
  speculationBots: many(speculationBots),
  backtestHistory: many(backtestHistory),
}));

// Standard insert schema for common user registration fields
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  firstName: true,
  lastName: true,
  riskProfile: true,
  maxDrawdown: true,
});

// Validation schema for user registration
export const userRegisterSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
  password: z.string().min(8, "Password must be at least 8 characters"),
  email: z.string().email("Invalid email address"),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

// Validation schema for user login
export const userLoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserRegister = z.infer<typeof userRegisterSchema>;
export type UserLogin = z.infer<typeof userLoginSchema>;
export type User = typeof users.$inferSelect;

// Exchange model
export const exchanges = pgTable("exchanges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // exchange name from CCXT (e.g., 'binanceus', 'kraken')
  displayName: text("display_name"), // custom name for the exchange connection
  apiKey: text("api_key").notNull(),
  apiSecret: text("api_secret").notNull(),
  apiKeyLabel: text("api_key_label"),
  canWithdraw: boolean("can_withdraw").default(false), // whether the API key has withdrawal permissions
  isDemo: boolean("is_demo").default(false), // whether this is a demo exchange
  status: text("status").notNull().default("disconnected"),
  userId: integer("user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const exchangesRelations = relations(exchanges, ({ one, many }) => ({
  user: one(users, {
    fields: [exchanges.userId],
    references: [users.id],
  }),
  tradingPairs: many(tradingPairs),
  bots: many(bots),
}));

export const insertExchangeSchema = createInsertSchema(exchanges).pick({
  name: true,
  displayName: true,
  apiKey: true,
  apiSecret: true,
  apiKeyLabel: true,
  canWithdraw: true,
  isDemo: true,
  userId: true,
});

export type InsertExchange = z.infer<typeof insertExchangeSchema>;
export type Exchange = typeof exchanges.$inferSelect;

// Define strategy types enum
export const strategyTypeEnum = pgEnum("strategy_type", [
  "Grid Trading", 
  "Grid Derivatives", 
  "DCA", 
  "DCA Derivatives", 
  "DCA Combo", 
  "MACD Crossover", 
  "Bollinger Bands",
  "Signal"
]);

// Bot model
export const bots = pgTable("bots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull().default("stopped"),
  strategyType: text("strategy_type").notNull(),
  tradingPair: text("trading_pair").notNull(),
  exchangeId: integer("exchange_id").notNull().references(() => exchanges.id),
  userId: integer("user_id").notNull().references(() => users.id),
  pnlAmount: real("pnl_amount").notNull().default(0),
  pnlPercentage: real("pnl_percentage").notNull().default(0),
  totalProfit: real("total_profit").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastUpdated: timestamp("last_updated").notNull().defaultNow(),
  parameters: text("parameters").notNull(), // JSON string of parameters
  completedTrades: integer("completed_trades").notNull().default(0),
  runningDays: integer("running_days").notNull().default(0),
  // New fields for risk management and leverage
  leverage: real("leverage").default(1),
  riskLevel: text("risk_level").default("moderate"),
  positionSizePercent: real("position_size_percent").default(10),
  maxDrawdown: real("max_drawdown").default(10),
  aiOptimized: boolean("ai_optimized").default(false),
  lastOptimizedAt: timestamp("last_optimized_at"),
  botType: text("bot_type").default("live"), // 'live' or 'paper' to distinguish between real and paper trading bots
});

export const botsRelations = relations(bots, ({ one, many }) => ({
  user: one(users, {
    fields: [bots.userId],
    references: [users.id],
  }),
  exchange: one(exchanges, {
    fields: [bots.exchangeId],
    references: [exchanges.id],
  }),
  trades: many(trades),
  backtestResults: many(backtestResults),
  optimizationResults: many(optimizationResults),
}));

export const insertBotSchema = createInsertSchema(bots).pick({
  name: true,
  strategyType: true,
  tradingPair: true,
  exchangeId: true,
  userId: true,
  parameters: true,
  leverage: true,
  riskLevel: true,
  positionSizePercent: true,
  maxDrawdown: true,
  botType: true, // Include botType field to distinguish between paper and live bots
});

export type InsertBot = z.infer<typeof insertBotSchema>;
export type Bot = typeof bots.$inferSelect;

// Trading pair model
export const tradingPairs = pgTable("trading_pairs", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  baseAsset: text("base_asset").notNull(),
  quoteAsset: text("quote_asset").notNull(),
  exchangeId: integer("exchange_id").notNull().references(() => exchanges.id),
  lastPrice: real("last_price"),
  volume24h: real("volume_24h"),
  priceChange24h: real("price_change_24h"),
  active: boolean("active").default(true),
  market: text("market").default("spot"), // spot, future, margin, etc.
  name: text("name"), // Full name or description of the trading pair
  updatedAt: timestamp("updated_at").defaultNow(),
  lastRefreshedAt: timestamp("last_refreshed_at").defaultNow(),
});

export const tradingPairsRelations = relations(tradingPairs, ({ one }) => ({
  exchange: one(exchanges, {
    fields: [tradingPairs.exchangeId],
    references: [exchanges.id],
  }),
}));

export const insertTradingPairSchema = createInsertSchema(tradingPairs).pick({
  symbol: true,
  baseAsset: true,
  quoteAsset: true,
  exchangeId: true,
  lastPrice: true,
  volume24h: true,
  priceChange24h: true,
  active: true,
  market: true,
  name: true,
});

export type InsertTradingPair = z.infer<typeof insertTradingPairSchema>;
export type TradingPair = typeof tradingPairs.$inferSelect;

// Trade model
export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => bots.id),
  tradingPair: text("trading_pair").notNull(),
  type: text("type").notNull(), // buy or sell
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  amount: real("amount").notNull(),
  leverage: real("leverage").default(1),
  profit: real("profit"),
  profitPercentage: real("profit_percentage"),
  status: text("status").notNull().default("open"), // open, closed
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const tradesRelations = relations(trades, ({ one }) => ({
  bot: one(bots, {
    fields: [trades.botId],
    references: [bots.id],
  }),
}));

export const insertTradeSchema = createInsertSchema(trades).pick({
  botId: true,
  tradingPair: true,
  type: true,
  entryPrice: true,
  amount: true,
  leverage: true,
});

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof trades.$inferSelect;

// Backtest results table
export const backtestResults = pgTable("backtest_results", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => bots.id),
  tradingPair: text("trading_pair").notNull(),
  timeframe: text("timeframe").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  initialCapital: real("initial_capital").notNull(),
  finalCapital: real("final_capital").notNull(),
  totalProfit: real("total_profit").notNull(),
  profitPercentage: real("profit_percentage").notNull(),
  winRate: real("win_rate").notNull(),
  totalTrades: integer("total_trades").notNull(),
  winningTrades: integer("winning_trades").notNull(),
  losingTrades: integer("losing_trades").notNull(),
  maxDrawdown: real("max_drawdown").notNull(),
  sharpeRatio: real("sharpe_ratio").notNull(),
  profitFactor: real("profit_factor").notNull(),
  averageProfit: real("average_profit").notNull(),
  averageLoss: real("average_loss").notNull(),
  maxConsecutiveLosses: integer("max_consecutive_losses").notNull(),
  trades: json("trades").notNull(), // JSON array of trades
  equityCurve: json("equity_curve").notNull(), // JSON array of equity points
  parameters: json("parameters").notNull(), // JSON of strategy parameters
  createdAt: timestamp("created_at").defaultNow(),
});

export const backtestResultsRelations = relations(backtestResults, ({ one }) => ({
  bot: one(bots, {
    fields: [backtestResults.botId],
    references: [bots.id],
  }),
}));

export const insertBacktestResultSchema = createInsertSchema(backtestResults).pick({
  botId: true,
  tradingPair: true,
  timeframe: true,
  startDate: true,
  endDate: true,
  initialCapital: true,
  finalCapital: true,
  totalProfit: true,
  profitPercentage: true,
  winRate: true,
  totalTrades: true,
  winningTrades: true,
  losingTrades: true,
  maxDrawdown: true,
  sharpeRatio: true,
  profitFactor: true,
  averageProfit: true,
  averageLoss: true,
  maxConsecutiveLosses: true,
  trades: true,
  equityCurve: true,
  parameters: true,
});

export type InsertBacktestResult = z.infer<typeof insertBacktestResultSchema>;
export type BacktestResult = typeof backtestResults.$inferSelect;

// Strategy optimization results
export const optimizationResults = pgTable("optimization_results", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => bots.id),
  optimizationDate: timestamp("optimization_date").defaultNow(),
  optimizationType: text("optimization_type").notNull(), // e.g., "parameters", "risk", "ai"
  originalParameters: json("original_parameters").notNull(),
  optimizedParameters: json("optimized_parameters").notNull(),
  performanceImprovement: real("performance_improvement").notNull(),
  description: text("description"),
  appliedToBot: boolean("applied_to_bot").default(false),
});

export const optimizationResultsRelations = relations(optimizationResults, ({ one }) => ({
  bot: one(bots, {
    fields: [optimizationResults.botId],
    references: [bots.id],
  }),
}));

export const insertOptimizationResultSchema = createInsertSchema(optimizationResults).pick({
  botId: true,
  optimizationType: true,
  originalParameters: true,
  optimizedParameters: true,
  performanceImprovement: true,
  description: true,
  appliedToBot: true,
});

export type InsertOptimizationResult = z.infer<typeof insertOptimizationResultSchema>;
export type OptimizationResult = typeof optimizationResults.$inferSelect;

// Portfolio management
export const portfolios = pgTable("portfolios", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  totalValue: real("total_value").default(0),
  profitLoss: real("profit_loss").default(0),
  profitLossPercentage: real("profit_loss_percentage").default(0),
  riskLevel: text("risk_level").default("moderate"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, {
    fields: [portfolios.userId],
    references: [users.id],
  }),
  allocations: many(portfolioAllocations),
}));

export const insertPortfolioSchema = createInsertSchema(portfolios).pick({
  userId: true,
  name: true,
  description: true,
  riskLevel: true,
});

export type InsertPortfolio = z.infer<typeof insertPortfolioSchema>;
export type Portfolio = typeof portfolios.$inferSelect;

// Portfolio allocations
export const portfolioAllocations = pgTable("portfolio_allocations", {
  id: serial("id").primaryKey(),
  portfolioId: integer("portfolio_id").notNull().references(() => portfolios.id),
  assetType: text("asset_type").notNull(), // "cryptocurrency", "bot", "exchange"
  assetId: integer("asset_id").notNull(), // ID of bot, exchange, or refers to a crypto asset
  symbol: text("symbol").notNull(), // e.g., BTC, ETH, or bot name
  allocation: real("allocation").notNull(), // percentage
  currentValue: real("current_value").default(0),
  profitLoss: real("profit_loss").default(0),
  profitLossPercentage: real("profit_loss_percentage").default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const portfolioAllocationsRelations = relations(portfolioAllocations, ({ one }) => ({
  portfolio: one(portfolios, {
    fields: [portfolioAllocations.portfolioId],
    references: [portfolios.id],
  }),
}));

export const insertPortfolioAllocationSchema = createInsertSchema(portfolioAllocations).pick({
  portfolioId: true,
  assetType: true,
  assetId: true,
  symbol: true,
  allocation: true,
  currentValue: true,
});

export type InsertPortfolioAllocation = z.infer<typeof insertPortfolioAllocationSchema>;
export type PortfolioAllocation = typeof portfolioAllocations.$inferSelect;

// AI Recommendations
export const aiRecommendations = pgTable("ai_recommendations", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  recommendationType: text("recommendation_type").notNull(), // "strategy", "portfolio", "risk"
  targetId: integer("target_id"), // ID of the bot, portfolio, etc.
  title: text("title").notNull(),
  description: text("description").notNull(),
  parameters: json("parameters"), // Optional JSON for strategy parameters
  potentialImprovement: real("potential_improvement"),
  confidence: real("confidence").notNull(),
  status: text("status").default("pending"), // "pending", "applied", "rejected"
  createdAt: timestamp("created_at").defaultNow(),
  appliedAt: timestamp("applied_at"),
});

export const aiRecommendationsRelations = relations(aiRecommendations, ({ one }) => ({
  user: one(users, {
    fields: [aiRecommendations.userId],
    references: [users.id],
  }),
}));

export const insertAiRecommendationSchema = createInsertSchema(aiRecommendations).pick({
  userId: true,
  recommendationType: true,
  targetId: true,
  title: true,
  description: true,
  parameters: true,
  potentialImprovement: true,
  confidence: true,
  status: true,
});

export type InsertAiRecommendation = z.infer<typeof insertAiRecommendationSchema>;
export type AiRecommendation = typeof aiRecommendations.$inferSelect;

// Market data for AI analysis
export const marketIndicators = pgTable("market_indicators", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  price: real("price").notNull(),
  volume: real("volume").notNull(),
  macd: real("macd"),
  rsi: real("rsi"),
  bollingerUpper: real("bollinger_upper"),
  bollingerLower: real("bollinger_lower"),
  sentiment: real("sentiment"), // -1.0 to 1.0
  volatility: real("volatility"),
  marketCap: real("market_cap"),
  trend: text("trend"), // "bullish", "bearish", "neutral"
});

export const insertMarketIndicatorSchema = createInsertSchema(marketIndicators).pick({
  symbol: true,
  timestamp: true,
  price: true,
  volume: true,
  macd: true,
  rsi: true,
  bollingerUpper: true,
  bollingerLower: true,
  sentiment: true,
  volatility: true,
  marketCap: true,
  trend: true,
});

export type InsertMarketIndicator = z.infer<typeof insertMarketIndicatorSchema>;
export type MarketIndicator = typeof marketIndicators.$inferSelect;

// Watchlist model
export const watchlistItems = pgTable("watchlist_items", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").notNull(),
  timeframe: text("timeframe").default("1h"),
  price: real("price"),
  priceChange24h: real("price_change_24h"),
  volume24h: real("volume_24h"),
  folderName: text("folder_name").default("default"),
  isCustom: boolean("is_custom").default(false),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const watchlistItemsRelations = relations(watchlistItems, ({ one }) => ({
  user: one(users, {
    fields: [watchlistItems.userId],
    references: [users.id],
  }),
}));

export const insertWatchlistItemSchema = createInsertSchema(watchlistItems).pick({
  userId: true,
  symbol: true,
  exchange: true,
  timeframe: true,
  price: true,
  priceChange24h: true,
  volume24h: true,
  folderName: true,
  isCustom: true,
  notes: true,
});

export type InsertWatchlistItem = z.infer<typeof insertWatchlistItemSchema>;
export type WatchlistItem = typeof watchlistItems.$inferSelect;

// Supported exchanges table to replace hardcoded lists
export const supportedExchanges = pgTable("supported_exchanges", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(), // Exchange ID as used in CCXT (e.g., 'binance', 'kraken')
  displayName: text("display_name").notNull(), // User-friendly display name
  isEnabled: boolean("is_enabled").default(true), // Whether exchange is available for users
  supportsSpot: boolean("supports_spot").default(true), // Whether exchange supports spot trading
  supportsMargin: boolean("supports_margin").default(false), // Whether exchange supports margin trading
  supportsFutures: boolean("supports_futures").default(false), // Whether exchange supports futures trading
  requiresCredentials: boolean("requires_credentials").default(true), // Whether exchange requires API keys
  sortOrder: integer("sort_order").default(999), // For controlling display order
  supportedTimeframes: text("supported_timeframes").array(), // Array of timeframes supported by the exchange
  iconUrl: text("icon_url"), // URL to exchange icon/logo
  websiteUrl: text("website_url"), // Exchange website URL
  apiDocsUrl: text("api_docs_url"), // Exchange API documentation URL
  notes: text("notes"), // Additional notes about this exchange
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertSupportedExchangeSchema = createInsertSchema(supportedExchanges).pick({
  name: true,
  displayName: true,
  isEnabled: true,
  supportsSpot: true,
  supportsMargin: true,
  supportsFutures: true,
  requiresCredentials: true,
  sortOrder: true,
  supportedTimeframes: true,
  iconUrl: true,
  websiteUrl: true, 
  apiDocsUrl: true,
  notes: true,
});

export type InsertSupportedExchange = z.infer<typeof insertSupportedExchangeSchema>;
export type SupportedExchange = typeof supportedExchanges.$inferSelect;

// Speculation Station Paper Trading Bots
export const speculationBots = pgTable("speculation_bots", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  userId: integer("user_id").notNull().references(() => users.id),
  strategy: text("strategy").notNull(), // grid, dca, macd, rsi, bollinger
  asset: text("asset").notNull(), // Trading pair (e.g., BTC/USDT)
  status: text("status").notNull().default("stopped"), // active, paused, stopped
  initialBalance: decimal("initial_balance", { precision: 18, scale: 8 }).notNull(),
  currentBalance: decimal("current_balance", { precision: 18, scale: 8 }).notNull(),
  profitLoss: decimal("profit_loss", { precision: 18, scale: 8 }).notNull().default("0"),
  profitLossPercentage: decimal("profit_loss_percentage", { precision: 10, scale: 2 }).notNull().default("0"),
  tradesExecuted: integer("trades_executed").notNull().default(0),
  timeframe: text("time_frame").notNull().default("1h"), // 5m, 15m, 30m, 1h, 4h, 1d
  parameters: json("parameters"), // Strategy specific parameters
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastTradeAt: timestamp("last_trade_at"),
  exchangeId: integer("exchange_id").references(() => exchanges.id),
});

export const speculationBotsRelations = relations(speculationBots, ({ one, many }) => ({
  user: one(users, {
    fields: [speculationBots.userId],
    references: [users.id],
  }),
  exchange: one(exchanges, {
    fields: [speculationBots.exchangeId],
    references: [exchanges.id],
  }),
  trades: many(speculationTrades),
}));

export const insertSpeculationBotSchema = createInsertSchema(speculationBots).pick({
  name: true,
  userId: true,
  strategy: true,
  asset: true,
  initialBalance: true,
  currentBalance: true,
  timeframe: true,
  parameters: true,
  exchangeId: true,
});

export type InsertSpeculationBot = z.infer<typeof insertSpeculationBotSchema>;
export type SpeculationBot = typeof speculationBots.$inferSelect;

// Speculation Paper Trades
export const speculationTrades = pgTable("speculation_trades", {
  id: serial("id").primaryKey(),
  botId: integer("bot_id").notNull().references(() => speculationBots.id),
  type: text("type").notNull(), // buy, sell
  asset: text("asset").notNull(),
  price: decimal("price", { precision: 18, scale: 8 }).notNull(),
  amount: decimal("amount", { precision: 18, scale: 8 }).notNull(),
  total: decimal("total", { precision: 18, scale: 8 }).notNull(),
  fee: decimal("fee", { precision: 18, scale: 8 }).notNull().default("0"),
  profitLoss: decimal("profit_loss", { precision: 18, scale: 8 }),
  profitLossPercentage: decimal("profit_loss_percentage", { precision: 10, scale: 2 }),
  status: text("status").notNull().default("executed"), // executed, failed, pending
  notes: text("notes"),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
});

export const speculationTradesRelations = relations(speculationTrades, ({ one }) => ({
  bot: one(speculationBots, {
    fields: [speculationTrades.botId],
    references: [speculationBots.id],
  }),
}));

export const insertSpeculationTradeSchema = createInsertSchema(speculationTrades).pick({
  botId: true,
  type: true,
  asset: true,
  price: true,
  amount: true,
  total: true,
  fee: true,
  notes: true,
  status: true,
});

export type InsertSpeculationTrade = z.infer<typeof insertSpeculationTradeSchema>;
export type SpeculationTrade = typeof speculationTrades.$inferSelect;

// Wallets model
export const wallets = pgTable("wallets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: text("type").notNull(), // spot, margin, futures, savings, other
  address: text("address"),
  balance: real("balance").default(0),
  currency: text("currency").notNull().default("USDT"),
  lastUpdated: timestamp("last_updated").defaultNow(),
  notes: text("notes"),
  isTracking: boolean("is_tracking").default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const walletsRelations = relations(wallets, ({ one }) => ({
  user: one(users, {
    fields: [wallets.userId],
    references: [users.id],
  }),
}));

export const insertWalletSchema = createInsertSchema(wallets).pick({
  userId: true,
  name: true,
  type: true,
  address: true,
  balance: true,
  currency: true,
  notes: true,
  isTracking: true,
});

export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;

// Backtest History - for storing standalone backtest runs (not associated with a specific bot)
export const backtestHistory = pgTable("backtest_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  strategyType: text("strategy_type").notNull(),
  tradingPair: text("trading_pair").notNull(),
  timeframe: text("timeframe").notNull(),
  exchange: text("exchange").notNull(), // Name of the exchange (e.g., "binanceus")
  exchangeId: integer("exchange_id").references(() => exchanges.id),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  initialCapital: real("initial_capital").notNull(),
  finalCapital: real("final_capital").notNull(),
  totalProfit: real("total_profit").notNull(),
  profitPercentage: real("profit_percentage").notNull(),
  winRate: real("win_rate"),
  totalTrades: integer("total_trades"),
  winningTrades: integer("winning_trades"),
  losingTrades: integer("losing_trades"),
  maxDrawdown: real("max_drawdown"),
  sharpeRatio: real("sharpe_ratio"),
  profitFactor: real("profit_factor"),
  averageProfit: real("average_profit"),
  averageLoss: real("average_loss"),
  maxConsecutiveLosses: integer("max_consecutive_losses"),
  trades: json("trades"), // Detailed JSON array of trades with entry/exit information
  equityCurve: json("equity_curve"), // JSON array of equity points over time
  parameters: json("parameters").notNull(), // JSON of strategy parameters
  metrics: json("metrics").default({}), // Additional metrics as JSON
  createdAt: timestamp("created_at").defaultNow(),
});

export const backtestHistoryRelations = relations(backtestHistory, ({ one }) => ({
  user: one(users, {
    fields: [backtestHistory.userId],
    references: [users.id],
  }),
  exchange: one(exchanges, {
    fields: [backtestHistory.exchangeId],
    references: [exchanges.id],
  }),
}));

export const insertBacktestHistorySchema = createInsertSchema(backtestHistory).pick({
  userId: true,
  strategyType: true,
  tradingPair: true,
  timeframe: true,
  exchange: true, // Add exchange field
  exchangeId: true,
  startDate: true,
  endDate: true,
  initialCapital: true,
  finalCapital: true,
  totalProfit: true,
  profitPercentage: true,
  winRate: true,
  totalTrades: true,
  winningTrades: true,
  losingTrades: true,
  maxDrawdown: true,
  sharpeRatio: true,
  profitFactor: true,
  averageProfit: true,
  averageLoss: true,
  maxConsecutiveLosses: true,
  trades: true,
  equityCurve: true,
  parameters: true,
  metrics: true, // Add metrics field
});

export type InsertBacktestHistory = z.infer<typeof insertBacktestHistorySchema>;
export type BacktestHistory = typeof backtestHistory.$inferSelect;

// Default Strategies - Template strategies that can be selected in Bot Creation and Backtesting
export const defaultStrategies = pgTable("default_strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  strategyType: text("strategy_type").notNull(),
  category: text("category").notNull(), // "grid", "trend", "mean-reversion", "momentum", etc.
  parameters: json("parameters").notNull(), // JSON of default strategy parameters
  parameterDescriptions: json("parameter_descriptions").notNull(), // JSON of parameter descriptions for tooltips
  riskLevel: text("risk_level").default("moderate"), // "low", "moderate", "high"
  recommendedAssets: json("recommended_assets"), // JSON array of recommended trading pairs
  isActive: boolean("is_active").default(true),
  displayOrder: integer("display_order").default(0), // For controlling display order
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDefaultStrategySchema = createInsertSchema(defaultStrategies).pick({
  name: true,
  description: true,
  strategyType: true,
  category: true,
  parameters: true,
  parameterDescriptions: true,
  riskLevel: true,
  recommendedAssets: true,
  isActive: true,
  displayOrder: true,
});

export type InsertDefaultStrategy = z.infer<typeof insertDefaultStrategySchema>;
export type DefaultStrategy = typeof defaultStrategies.$inferSelect;
