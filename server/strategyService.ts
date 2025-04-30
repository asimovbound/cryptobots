import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { Bot, Trade } from "@shared/schema";

/**
 * Service for managing and executing trading strategies
 */
export class StrategyService {
  // Track running bot intervals
  private botIntervals: Map<number, NodeJS.Timeout> = new Map();
  
  /**
   * Deploy a trading bot
   * @param botId ID of the bot to deploy
   */
  async deployBot(botId: number): Promise<void> {
    try {
      console.log(`Deploying bot ID: ${botId}`);
      
      const bot = await storage.getBot(botId);
      if (!bot) {
        throw new Error(`Bot with ID ${botId} not found`);
      }
      
      // Parse strategy parameters
      const parameters = JSON.parse(bot.parameters);
      
      // Validate that the exchange is connected
      const exchange = await storage.getExchange(bot.exchangeId);
      if (!exchange || exchange.status !== "connected") {
        throw new Error(`Exchange is not connected for bot ${bot.name}`);
      }
      
      // Validate that the trading pair exists
      const tradingPair = await storage.getTradingPairBySymbol(bot.tradingPair);
      if (!tradingPair) {
        throw new Error(`Trading pair ${bot.tradingPair} not found`);
      }
      
      // Initialize the strategy based on bot type
      await this.initializeStrategy(bot, parameters);
      
      // Update bot status to active
      await storage.updateBotStatus(botId, "active");
      
      // Start the bot's trading operations
      await this.startBot(botId);
      
      console.log(`Bot ${bot.name} (ID: ${botId}) deployed successfully`);
    } catch (error) {
      console.error(`Failed to deploy bot ID ${botId}:`, error);
      throw new Error(`Failed to deploy bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Initialize a trading strategy
   * @param bot The bot to initialize
   * @param parameters Strategy parameters
   */
  private async initializeStrategy(bot: Bot, parameters: any): Promise<void> {
    console.log(`Initializing ${bot.strategyType} strategy for bot ID: ${bot.id}`);
    
    switch (bot.strategyType) {
      case "Grid Trading":
        await this.initializeGridStrategy(bot, parameters);
        break;
      case "DCA":
      case "DCA (Dollar-cost averaging)":
        await this.initializeDCAStrategy(bot, parameters);
        break;
      case "MACD Crossover":
        await this.initializeMACDStrategy(bot, parameters);
        break;
      case "Bollinger Bands":
        await this.initializeBollingerStrategy(bot, parameters);
        break;
      default:
        console.log(`Using default strategy initialization for ${bot.strategyType}`);
        // Default initialization for custom strategies
        break;
    }
  }
  
  /**
   * Initialize a grid trading strategy
   * @param bot The bot to initialize
   * @param parameters Strategy parameters
   */
  private async initializeGridStrategy(bot: Bot, parameters: any): Promise<void> {
    console.log(`Initializing grid strategy for bot ${bot.name} with parameters:`, parameters);
    
    const {
      upperPriceLimit,
      lowerPriceLimit,
      gridCount,
      investment
    } = parameters;
    
    if (!upperPriceLimit || !lowerPriceLimit || !gridCount || !investment) {
      throw new Error("Missing required parameters for grid strategy");
    }
    
    // Calculate grid levels
    const priceRange = upperPriceLimit - lowerPriceLimit;
    const gridSize = priceRange / gridCount;
    
    console.log(`Grid strategy initialized with ${gridCount} grids between ${lowerPriceLimit} and ${upperPriceLimit}`);
    console.log(`Grid size: ${gridSize}`);
    
    // In a production application, this would:
    // 1. Place initial grid orders on the exchange
    // 2. Save the grid configuration
    // 3. Set up monitoring for grid hits
  }
  
  /**
   * Initialize a DCA (Dollar-Cost Averaging) strategy
   * @param bot The bot to initialize
   * @param parameters Strategy parameters
   */
  private async initializeDCAStrategy(bot: Bot, parameters: any): Promise<void> {
    console.log(`Initializing DCA strategy for bot ${bot.name}`);
    
    // DCA strategy initialization logic
  }
  
  /**
   * Initialize a MACD Crossover strategy
   * @param bot The bot to initialize
   * @param parameters Strategy parameters
   */
  private async initializeMACDStrategy(bot: Bot, parameters: any): Promise<void> {
    console.log(`Initializing MACD strategy for bot ${bot.name}`);
    
    // MACD strategy initialization logic
  }
  
  /**
   * Initialize a Bollinger Bands strategy
   * @param bot The bot to initialize
   * @param parameters Strategy parameters
   */
  private async initializeBollingerStrategy(bot: Bot, parameters: any): Promise<void> {
    console.log(`Initializing Bollinger Bands strategy for bot ${bot.name}`);
    
    // Bollinger Bands strategy initialization logic
  }
  
  /**
   * Start a bot's trading operations
   * @param botId ID of the bot to start
   */
  async startBot(botId: number): Promise<void> {
    try {
      console.log(`Starting bot ID: ${botId}`);
      
      const bot = await storage.getBot(botId);
      if (!bot) {
        throw new Error(`Bot with ID ${botId} not found`);
      }
      
      // Stop any existing interval for this bot
      await this.stopBot(botId);
      
      // Start a new interval for the bot's trading operations
      const interval = setInterval(async () => {
        try {
          await this.executeBotCycle(botId);
        } catch (error) {
          console.error(`Error in bot ${botId} execution cycle:`, error);
        }
      }, 60000); // Check every minute
      
      // Store the interval reference
      this.botIntervals.set(botId, interval);
      
      console.log(`Bot ${bot.name} (ID: ${botId}) started successfully`);
    } catch (error) {
      console.error(`Failed to start bot ID ${botId}:`, error);
      throw new Error(`Failed to start bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Stop a bot's trading operations
   * @param botId ID of the bot to stop
   */
  async stopBot(botId: number): Promise<void> {
    try {
      console.log(`Stopping bot ID: ${botId}`);
      
      // Clear any existing interval
      const interval = this.botIntervals.get(botId);
      if (interval) {
        clearInterval(interval);
        this.botIntervals.delete(botId);
      }
      
      console.log(`Bot ID: ${botId} stopped successfully`);
    } catch (error) {
      console.error(`Failed to stop bot ID ${botId}:`, error);
      throw new Error(`Failed to stop bot: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Execute a single trading cycle for a bot
   * @param botId ID of the bot to execute a cycle for
   */
  private async executeBotCycle(botId: number): Promise<void> {
    try {
      const bot = await storage.getBot(botId);
      if (!bot) {
        throw new Error(`Bot with ID ${botId} not found`);
      }
      
      if (bot.status !== "active") {
        return; // Don't execute if bot is not active
      }
      
      console.log(`Executing trading cycle for bot ${bot.name} (ID: ${botId})`);
      
      // Parse strategy parameters
      const parameters = JSON.parse(bot.parameters);
      
      // Get current market data
      const marketData = await exchangeService.getMarketData(
        bot.exchangeId,
        bot.tradingPair,
        "1h",
        100
      );
      
      // Execute strategy logic based on bot type
      switch (bot.strategyType) {
        case "Grid Trading":
          await this.executeGridStrategy(bot, parameters, marketData);
          break;
        case "DCA":
        case "DCA (Dollar-cost averaging)":
          await this.executeDCAStrategy(bot, parameters, marketData);
          break;
        case "MACD Crossover":
          await this.executeMACDStrategy(bot, parameters, marketData);
          break;
        case "Bollinger Bands":
          await this.executeBollingerStrategy(bot, parameters, marketData);
          break;
        default:
          console.log(`No specific execution logic for ${bot.strategyType}, using default`);
          // Default execution logic
          break;
      }
      
      // Update bot statistics
      await this.updateBotStatistics(botId);
      
    } catch (error) {
      console.error(`Error executing bot cycle for bot ID ${botId}:`, error);
      // Don't rethrow here to prevent the interval from stopping
    }
  }
  
  /**
   * Execute grid trading strategy logic
   * @param bot The bot to execute strategy for
   * @param parameters Strategy parameters
   * @param marketData Current market data
   */
  private async executeGridStrategy(bot: Bot, parameters: any, marketData: any[]): Promise<void> {
    try {
      console.log(`Executing grid strategy for bot ${bot.name}`);
      
      const {
        upperPriceLimit,
        lowerPriceLimit,
        gridCount,
        gridProfit
      } = parameters;
      
      // Get the current price from the latest candle
      const latestCandle = marketData[marketData.length - 1];
      const currentPrice = latestCandle[4]; // Close price
      
      console.log(`Current price for ${bot.tradingPair}: ${currentPrice}`);
      
      // Check if price is within grid range
      if (currentPrice < lowerPriceLimit || currentPrice > upperPriceLimit) {
        console.log(`Price ${currentPrice} is outside grid range [${lowerPriceLimit} - ${upperPriceLimit}]`);
        return;
      }
      
      // In a production application, this would:
      // 1. Check for triggered grid levels
      // 2. Execute buy/sell orders at grid levels
      // 3. Update grid positions
      
      // Simulate a successful grid trade for demonstration
      await this.simulateGridTrade(bot, currentPrice, parameters);
      
    } catch (error) {
      console.error(`Error executing grid strategy for bot ${bot.name}:`, error);
    }
  }
  
  /**
   * Simulate a grid trade for demonstration purposes
   * @param bot The bot to simulate trade for
   * @param currentPrice Current market price
   * @param parameters Strategy parameters
   */
  private async simulateGridTrade(bot: Bot, currentPrice: number, parameters: any): Promise<void> {
    // 50% chance of buy, 50% chance of sell
    const isBuy = Math.random() > 0.5;
    
    // Calculate a realistic amount
    const baseAmount = parameters.investment / parameters.gridCount / currentPrice;
    const amount = baseAmount * (0.8 + Math.random() * 0.4); // Vary by ±20%
    
    // Calculate profit/loss for this trade
    const profitPercent = parameters.gridProfit * (0.8 + Math.random() * 0.4); // Vary by ±20%
    const entryPrice = isBuy 
      ? currentPrice
      : currentPrice * (1 + profitPercent / 100);
    const exitPrice = isBuy
      ? currentPrice * (1 + profitPercent / 100)
      : currentPrice;
    
    // Simulate trade execution
    try {
      // Create a trade record
      const trade: InsertTrade = {
        botId: bot.id,
        tradingPair: bot.tradingPair,
        type: isBuy ? "buy" : "sell",
        entryPrice,
        amount,
      };
      
      const createdTrade = await storage.createTrade(trade);
      
      // Update to closed status after a simulated delay
      setTimeout(async () => {
        try {
          const profit = amount * Math.abs(exitPrice - entryPrice);
          
          await storage.updateTrade(createdTrade.id, {
            status: "closed",
            exitPrice,
            profit,
            profitPercentage: profitPercent,
            closedAt: new Date()
          });
          
          // Update bot statistics
          const updatedBot = await storage.getBot(bot.id);
          if (updatedBot) {
            const newTotalProfit = updatedBot.totalProfit + profit;
            const newCompletedTrades = updatedBot.completedTrades + 1;
            
            await storage.updateBot(bot.id, {
              totalProfit: newTotalProfit,
              completedTrades: newCompletedTrades,
              pnlAmount: profit,
              pnlPercentage: profitPercent
            });
          }
          
          console.log(`Simulated ${isBuy ? "buy" : "sell"} trade completed for bot ${bot.name}, profit: ${profit.toFixed(2)}`);
        } catch (error) {
          console.error(`Error updating simulated trade:`, error);
        }
      }, 30000); // Simulate 30-second trade completion
      
    } catch (error) {
      console.error(`Error simulating trade:`, error);
    }
  }
  
  /**
   * Execute DCA strategy logic
   * @param bot The bot to execute strategy for
   * @param parameters Strategy parameters
   * @param marketData Current market data
   */
  private async executeDCAStrategy(bot: Bot, parameters: any, marketData: any[]): Promise<void> {
    console.log(`Executing DCA strategy for bot ${bot.name}`);
    
    // DCA strategy execution logic
  }
  
  /**
   * Execute MACD strategy logic
   * @param bot The bot to execute strategy for
   * @param parameters Strategy parameters
   * @param marketData Current market data
   */
  private async executeMACDStrategy(bot: Bot, parameters: any, marketData: any[]): Promise<void> {
    console.log(`Executing MACD strategy for bot ${bot.name}`);
    
    // MACD strategy execution logic
  }
  
  /**
   * Execute Bollinger Bands strategy logic
   * @param bot The bot to execute strategy for
   * @param parameters Strategy parameters
   * @param marketData Current market data
   */
  private async executeBollingerStrategy(bot: Bot, parameters: any, marketData: any[]): Promise<void> {
    console.log(`Executing Bollinger Bands strategy for bot ${bot.name}`);
    
    // Bollinger Bands strategy execution logic
  }
  
  /**
   * Update bot statistics
   * @param botId ID of the bot to update statistics for
   */
  private async updateBotStatistics(botId: number): Promise<void> {
    try {
      const bot = await storage.getBot(botId);
      if (!bot) {
        throw new Error(`Bot with ID ${botId} not found`);
      }
      
      // Calculate running days
      const createdDate = new Date(bot.createdAt);
      const currentDate = new Date();
      const runningDays = Math.floor((currentDate.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Get all trades for this bot
      const trades = await storage.getTradesByBotId(botId);
      
      // Calculate profit/loss if we have trades
      if (trades.length > 0) {
        // Calculate total profit
        const totalProfit = trades
          .filter(trade => trade.profit !== undefined && trade.status === "closed")
          .reduce((sum, trade) => sum + (trade.profit || 0), 0);
        
        // Calculate today's P&L
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const todayTrades = trades.filter(trade => {
          return trade.closedAt && new Date(trade.closedAt) >= today && trade.status === "closed";
        });
        
        const todayPnL = todayTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0);
        
        // Calculate P&L percentage based on investment
        // In a real app, this would be calculated based on actual investment amount
        const parameters = JSON.parse(bot.parameters);
        const investment = parameters.investment || 1000; // Default to 1000 if not specified
        
        const pnlPercentage = (todayPnL / investment) * 100;
        
        // Update bot with calculated statistics
        await storage.updateBot(botId, {
          totalProfit,
          pnlAmount: todayPnL,
          pnlPercentage,
          completedTrades: trades.filter(trade => trade.status === "closed").length,
          runningDays
        });
      } else {
        // Just update running days if no trades
        await storage.updateBot(botId, { runningDays });
      }
    } catch (error) {
      console.error(`Error updating bot statistics for bot ID ${botId}:`, error);
    }
  }
}

// Helper type for InsertTrade to use in this file
type InsertTrade = {
  botId: number;
  tradingPair: string;
  type: string;
  entryPrice: number;
  amount: number;
};

export const strategyService = new StrategyService();
