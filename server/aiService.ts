import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { 
  Bot, 
  OptimizationResult, 
  InsertOptimizationResult,
  AiRecommendation,
  InsertAiRecommendation,
  BacktestResult
} from '@shared/schema';
import { storage } from './storage';
import { backtestService } from './backtestService';
import { exchangeService } from './exchangeService';

/**
 * Service for AI-powered strategy optimization and recommendations
 */
export class AiService {
  private genAI: GoogleGenerativeAI;
  private model: string = 'gemini-1.5-pro';
  
  constructor() {
    // TODO: Replace with secure API key management (e.g., environment variables)
    const apiKey = process.env.GEMINI_API_KEY || 'YOUR_API_KEY_HERE'; // Example placeholder

    if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
      console.warn(`
        **************************************************************************************
        * WARNING: Gemini API Key is missing or using a placeholder.                         *
        * AI features (optimization, recommendations) will not function correctly.           *
        * Please set the GEMINI_API_KEY environment variable with your actual key.           *
        * You can obtain a key from Google AI Studio: https://aistudio.google.com/app/apikey *
        **************************************************************************************
      `);
      // Allow instantiation but AI calls will likely fail
      this.genAI = new GoogleGenerativeAI(''); 
    } else {
        this.genAI = new GoogleGenerativeAI(apiKey);
    }
  }
  
  /**
   * Generate an optimized trading strategy
   * @param botId The ID of the bot to optimize
   */
  async optimizeStrategy(botId: number): Promise<OptimizationResult | null> {
    try {
      const bot = await storage.getBot(botId);
      if (!bot) {
        throw new Error(`Bot with ID ${botId} not found`);
      }
      
      // Get historical backtest results
      const backtestResults = await storage.getBacktestResultsByBotId(botId);
      if (backtestResults.length === 0) {
        // Need to run at least one backtest before optimization
        console.log(`No backtest results found for bot ${botId}, running initial backtest`);
        
        // Get trading pair symbol and parameters
        const parameters = JSON.parse(bot.parameters);
        const pair = bot.tradingPair;
        const period = '30d'; // Use 30 days for initial optimization
        
        // Run initial backtest
        const backtest = await backtestService.runBacktest(pair, parameters, period);
        const backtestResult = this.convertBacktestToDbFormat(botId, backtest, parameters, period);
        await storage.createBacktestResult(backtestResult);
      }
      
      // Get latest backtest
      const latestBacktests = await storage.getBacktestResultsByBotId(botId);
      if (latestBacktests.length === 0) {
        throw new Error('Failed to create initial backtest');
      }
      
      const latestBacktest = latestBacktests[latestBacktests.length - 1];
      
      // Extract original parameters
      const originalParameters = JSON.parse(bot.parameters);
      
      // Generate optimized parameters using Gemini AI
      const optimizedParameters = await this.generateOptimizedParameters(bot, latestBacktest);
      
      // Run backtest with optimized parameters
      const pair = bot.tradingPair;
      const period = '30d';
      const optimizedBacktest = await backtestService.runBacktest(pair, optimizedParameters, period);
      
      // Calculate performance improvement
      const originalProfit = latestBacktest.profitPercentage;
      const optimizedProfit = optimizedBacktest.profitPercentage;
      const performanceImprovement = optimizedProfit - originalProfit;
      
      // Create optimization result
      const optimizationResult: InsertOptimizationResult = {
        botId,
        optimizationType: 'ai',
        originalParameters: JSON.stringify(originalParameters),
        optimizedParameters: JSON.stringify(optimizedParameters),
        performanceImprovement,
        description: this.generateOptimizationDescription(originalParameters, optimizedParameters, performanceImprovement),
        appliedToBot: false
      };
      
      // Save optimization result to database
      const savedResult = await storage.createOptimizationResult(optimizationResult);
      
      return savedResult;
    } catch (error) {
      console.error('Error optimizing strategy:', error);
      return null;
    }
  }
  
  /**
   * Generate optimized parameters using Gemini AI
   * @param bot Bot to optimize
   * @param latestBacktest Latest backtest result
   */
  private async generateOptimizedParameters(bot: Bot, latestBacktest: BacktestResult): Promise<any> {
    const originalParameters = JSON.parse(bot.parameters);
    const strategyType = bot.strategyType;
    const backtestResults = JSON.stringify({
      profitPercentage: latestBacktest.profitPercentage,
      totalTrades: latestBacktest.totalTrades,
      winRate: latestBacktest.winRate,
      maxDrawdown: latestBacktest.maxDrawdown,
      sharpeRatio: latestBacktest.sharpeRatio,
    });
    
    // Get market data
    const marketData = await this.getMarketDataSummary(bot.tradingPair);
    
    // Construct the prompt for Gemini
    const prompt = `
    As an advanced trading strategy optimizer, analyze the following trading bot configuration and suggest optimized parameters to improve performance.
    
    Strategy Type: ${strategyType}
    Trading Pair: ${bot.tradingPair}
    
    Current Parameters: ${JSON.stringify(originalParameters, null, 2)}
    
    Recent Backtest Results: ${backtestResults}
    
    Market Data Summary: ${marketData}
    
    Based on this information, provide optimized parameter values that would likely improve performance.
    
    Consider the following when optimizing:
    - For Grid Trading: Adjust grid levels, price ranges, and grid density based on volatility
    - For DCA: Adjust entry frequency, position sizing, and take profit levels
    - For MACD: Adjust fast, slow, and signal periods, and thresholds
    - For Bollinger Bands: Adjust period and standard deviation values
    - For Signal Bots: Adjust signal thresholds and combinations
    
    Only output the optimized parameters in valid JSON format, with the same structure as the original parameters, but with improved values.
    `;
    
    try {
      const model = this.genAI.getGenerativeModel({ model: this.model });
      
      const generationConfig = {
        temperature: 0.4,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: 4096,
      };
      
      const safetySettings = [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ];
      
      const response = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
        safetySettings,
      });
      
      const responseText = response.response.text();
      
      // Extract JSON from response if needed
      const jsonStartIndex = responseText.indexOf('{');
      const jsonEndIndex = responseText.lastIndexOf('}') + 1;
      const jsonStr = responseText.substring(jsonStartIndex, jsonEndIndex);
      
      try {
        const optimizedParams = JSON.parse(jsonStr);
        
        // Ensure we don't drastically change the parameter values (risk management)
        const safeguardedParams = this.safeguardParameters(originalParameters, optimizedParams);
        return safeguardedParams;
      } catch (e) {
        console.error('Failed to parse AI response as JSON:', e);
        return originalParameters; // Fallback to original parameters
      }
    } catch (error) {
      console.error('Error generating AI optimized parameters:', error);
      return originalParameters;
    }
  }
  
  /**
   * Generate recommended strategies for a user
   * @param userId The ID of the user to generate recommendations for
   */
  async generateRecommendations(userId: number): Promise<AiRecommendation[]> {
    try {
      // Get user's bots
      const userBots = await storage.getBotsByUserId(userId);
      if (userBots.length === 0) {
        return [];
      }
      
      const results: AiRecommendation[] = [];
      
      // Generate recommendations for each bot
      for (const bot of userBots) {
        // Generate portfolio allocation recommendations
        const portfolioRecommendation = await this.generatePortfolioRecommendation(userId, bot);
        if (portfolioRecommendation) {
          results.push(portfolioRecommendation);
        }
        
        // Generate risk management recommendations
        const riskRecommendation = await this.generateRiskManagementRecommendation(userId, bot);
        if (riskRecommendation) {
          results.push(riskRecommendation);
        }
        
        // Generate strategy type recommendations
        const strategyRecommendation = await this.generateStrategyRecommendation(userId, bot);
        if (strategyRecommendation) {
          results.push(strategyRecommendation);
        }
      }
      
      return results;
    } catch (error) {
      console.error('Error generating recommendations:', error);
      return [];
    }
  }
  
  /**
   * Generate a portfolio allocation recommendation
   * @param userId User ID
   * @param bot Bot to analyze
   */
  private async generatePortfolioRecommendation(userId: number, bot: Bot): Promise<AiRecommendation | null> {
    try {
      // Get user's portfolios
      const portfolios = await storage.getPortfoliosByUserId(userId);
      if (portfolios.length === 0) {
        return null;
      }
      
      // Get market data
      const marketData = await this.getMarketDataSummary(bot.tradingPair);
      
      // Construct the prompt for Gemini
      const prompt = `
      As a crypto portfolio optimization advisor, analyze the following trading bot and market information:
      
      Bot Name: ${bot.name}
      Strategy Type: ${bot.strategyType}
      Trading Pair: ${bot.tradingPair}
      Performance: ${bot.pnlPercentage}% (${bot.pnlAmount > 0 ? 'profit' : 'loss'})
      
      Market Data Summary: ${marketData}
      
      Based on this information, provide a recommendation for optimal portfolio allocation.
      Your recommendation should include:
      1. A title for the recommendation
      2. A detailed description with specific allocation suggestions
      3. A confidence score between 0.0 and 1.0
      4. Potential improvement percentage (estimate)
      
      Format your response as follows:
      {
        "title": "Your recommendation title",
        "description": "Your detailed recommendation",
        "confidence": 0.85,
        "potentialImprovement": 2.4
      }
      `;
      
      const model = this.genAI.getGenerativeModel({ model: this.model });
      const response = await model.generateContent(prompt);
      const responseText = response.response.text();
      
      // Extract JSON from response
      const jsonStartIndex = responseText.indexOf('{');
      const jsonEndIndex = responseText.lastIndexOf('}') + 1;
      const jsonStr = responseText.substring(jsonStartIndex, jsonEndIndex);
      
      try {
        const recommendation = JSON.parse(jsonStr);
        
        // Create AI recommendation
        const aiRecommendation: InsertAiRecommendation = {
          userId,
          recommendationType: 'portfolio',
          targetId: bot.id,
          title: recommendation.title,
          description: recommendation.description,
          confidence: recommendation.confidence,
          potentialImprovement: recommendation.potentialImprovement,
          status: 'pending'
        };
        
        // Save recommendation to database
        return await storage.createAiRecommendation(aiRecommendation);
      } catch (e) {
        console.error('Failed to parse AI response as JSON:', e);
        return null;
      }
    } catch (error) {
      console.error('Error generating portfolio recommendation:', error);
      return null;
    }
  }
  
  /**
   * Generate a risk management recommendation
   * @param userId User ID
   * @param bot Bot to analyze
   */
  private async generateRiskManagementRecommendation(userId: number, bot: Bot): Promise<AiRecommendation | null> {
    try {
      const parameters = JSON.parse(bot.parameters);
      
      // Construct the prompt for Gemini
      const prompt = `
      As a risk management advisor for cryptocurrency trading, analyze the following bot configuration:
      
      Bot Name: ${bot.name}
      Strategy Type: ${bot.strategyType}
      Trading Pair: ${bot.tradingPair}
      Current Parameters: ${JSON.stringify(parameters, null, 2)}
      Performance: ${bot.pnlPercentage}% (${bot.pnlAmount > 0 ? 'profit' : 'loss'})
      
      Based on this configuration, provide a risk management recommendation to improve the bot's risk-adjusted performance.
      Focus on position sizing, stop-loss settings, take-profit levels, and overall exposure.
      
      Your recommendation should include:
      1. A title for the recommendation
      2. A detailed description with specific risk management improvements
      3. A confidence score between 0.0 and 1.0
      4. Potential improvement percentage (estimate)
      
      Format your response as follows:
      {
        "title": "Your recommendation title",
        "description": "Your detailed recommendation",
        "confidence": 0.85,
        "potentialImprovement": 2.4,
        "parameters": {
          "stopLossPercentage": 5,
          "positionSizePercent": 10,
          "maxDrawdown": 15
        }
      }
      `;
      
      const model = this.genAI.getGenerativeModel({ model: this.model });
      const response = await model.generateContent(prompt);
      const responseText = response.response.text();
      
      // Extract JSON from response
      const jsonStartIndex = responseText.indexOf('{');
      const jsonEndIndex = responseText.lastIndexOf('}') + 1;
      const jsonStr = responseText.substring(jsonStartIndex, jsonEndIndex);
      
      try {
        const recommendation = JSON.parse(jsonStr);
        
        // Create AI recommendation
        const aiRecommendation: InsertAiRecommendation = {
          userId,
          recommendationType: 'risk',
          targetId: bot.id,
          title: recommendation.title,
          description: recommendation.description,
          parameters: JSON.stringify(recommendation.parameters || {}),
          confidence: recommendation.confidence,
          potentialImprovement: recommendation.potentialImprovement,
          status: 'pending'
        };
        
        // Save recommendation to database
        return await storage.createAiRecommendation(aiRecommendation);
      } catch (e) {
        console.error('Failed to parse AI response as JSON:', e);
        return null;
      }
    } catch (error) {
      console.error('Error generating risk management recommendation:', error);
      return null;
    }
  }
  
  /**
   * Generate a strategy recommendation
   * @param userId User ID
   * @param bot Bot to analyze
   */
  private async generateStrategyRecommendation(userId: number, bot: Bot): Promise<AiRecommendation | null> {
    try {
      // Get market data
      const marketData = await this.getMarketDataSummary(bot.tradingPair);
      
      // Construct the prompt for Gemini
      const prompt = `
      As a crypto trading strategy advisor, analyze the following bot and market information:
      
      Bot Name: ${bot.name}
      Current Strategy Type: ${bot.strategyType}
      Trading Pair: ${bot.tradingPair}
      Performance: ${bot.pnlPercentage}% (${bot.pnlAmount > 0 ? 'profit' : 'loss'})
      Completed Trades: ${bot.completedTrades}
      Running Days: ${bot.runningDays}
      
      Market Data Summary: ${marketData}
      
      Based on this information, provide a recommendation for an alternative or improved strategy type.
      Consider whether the current market conditions favor grid trading, DCA, trend-following strategies, or other approaches.
      
      Your recommendation should include:
      1. A title for the recommendation
      2. A detailed description with specific strategy suggestions
      3. A confidence score between 0.0 and 1.0
      4. Potential improvement percentage (estimate)
      
      Format your response as follows:
      {
        "title": "Your recommendation title",
        "description": "Your detailed recommendation",
        "confidence": 0.85,
        "potentialImprovement": 2.4,
        "parameters": {
          "recommendedStrategy": "Strategy name",
          "marketCondition": "Trending/Ranging/Volatile"
        }
      }
      `;
      
      const model = this.genAI.getGenerativeModel({ model: this.model });
      const response = await model.generateContent(prompt);
      const responseText = response.response.text();
      
      // Extract JSON from response
      const jsonStartIndex = responseText.indexOf('{');
      const jsonEndIndex = responseText.lastIndexOf('}') + 1;
      const jsonStr = responseText.substring(jsonStartIndex, jsonEndIndex);
      
      try {
        const recommendation = JSON.parse(jsonStr);
        
        // Create AI recommendation
        const aiRecommendation: InsertAiRecommendation = {
          userId,
          recommendationType: 'strategy',
          targetId: bot.id,
          title: recommendation.title,
          description: recommendation.description,
          parameters: JSON.stringify(recommendation.parameters || {}),
          confidence: recommendation.confidence,
          potentialImprovement: recommendation.potentialImprovement,
          status: 'pending'
        };
        
        // Save recommendation to database
        return await storage.createAiRecommendation(aiRecommendation);
      } catch (e) {
        console.error('Failed to parse AI response as JSON:', e);
        return null;
      }
    } catch (error) {
      console.error('Error generating strategy recommendation:', error);
      return null;
    }
  }
  
  /**
   * Apply strategy optimization to a bot
   * @param optimizationId ID of the optimization to apply
   */
  async applyOptimization(optimizationId: number): Promise<boolean> {
    try {
      const optimization = await storage.getOptimizationResult(optimizationId);
      if (!optimization) {
        throw new Error(`Optimization with ID ${optimizationId} not found`);
      }
      
      const bot = await storage.getBot(optimization.botId);
      if (!bot) {
        throw new Error(`Bot with ID ${optimization.botId} not found`);
      }
      
      // Update bot parameters with optimized parameters
      const optimizedParameters = optimization.optimizedParameters;
      await storage.updateBot(bot.id, {
        parameters: JSON.stringify(optimizedParameters),
        aiOptimized: true,
        lastOptimizedAt: new Date()
      });
      // Mark optimization as applied
      await storage.updateOptimizationResult(optimizationId, {
        applied: true
      });
      
      return true;
    } catch (error) {
      console.error('Error applying optimization:', error);
      return false;
    }
  }
  
  /**
   * Get market data summary for a trading pair
   * @param symbol Trading pair symbol
   */
  private async getMarketDataSummary(symbol: string): Promise<string> {
    try {
      // Get trading pair info
      const pair = await storage.getTradingPairBySymbol(symbol);
      if (!pair || !pair.exchangeId) {
        return 'No market data available';
      }
      
      // Get market data from exchange
      const marketData = await exchangeService.getMarketData(
        pair.exchangeId.toString(), 
        symbol, 
        '1d', 
        30
      );
      
      if (!marketData || !marketData.length) {
        return 'No market data available';
      }
      
      // Calculate basic market statistics
      const prices = marketData.map((candle: any) => candle[4]); // Close prices
      const volumes = marketData.map((candle: any) => candle[5]); // Volumes
      
      const currentPrice = prices[prices.length - 1];
      const priceChange = ((currentPrice - prices[0]) / prices[0]) * 100;
      const averageVolume = volumes.reduce((sum: number, vol: number) => sum + vol, 0) / volumes.length;
      
      // Calculate volatility (standard deviation of price changes)
      const priceChanges = [];
      for (let i = 1; i < prices.length; i++) {
        priceChanges.push((prices[i] - prices[i-1]) / prices[i-1] * 100);
      }
      const avgChange = priceChanges.reduce((sum, change) => sum + change, 0) / priceChanges.length;
      const volatility = Math.sqrt(priceChanges.reduce((sum, change) => sum + Math.pow(change - avgChange, 2), 0) / priceChanges.length);
      
      return `
      Symbol: ${symbol}
      Current Price: ${currentPrice}
      30-Day Price Change: ${priceChange.toFixed(2)}%
      30-Day Volatility: ${volatility.toFixed(2)}%
      Average Daily Volume: ${averageVolume.toFixed(2)}
      Market Condition: ${this.determineMarketCondition(volatility, priceChange)}
      `;
    } catch (error) {
      console.error('Error getting market data summary:', error);
      return 'Error retrieving market data';
    }
  }
  
  /**
   * Determine market condition based on volatility and price change
   * @param volatility Price volatility
   * @param priceChange Percentage price change
   */
  private determineMarketCondition(volatility: number, priceChange: number): string {
    if (volatility > 5) {
      return 'Highly Volatile';
    } else if (Math.abs(priceChange) > 10) {
      return priceChange > 0 ? 'Strong Uptrend' : 'Strong Downtrend';
    } else if (Math.abs(priceChange) > 5) {
      return priceChange > 0 ? 'Moderate Uptrend' : 'Moderate Downtrend';
    } else {
      return 'Ranging/Sideways';
    }
  }
  
  /**
   * Convert backtest result to database format
   * @param botId Bot ID
   * @param backtest Backtest result from service
   * @param parameters Strategy parameters
   * @param period Backtest period
   */
  private convertBacktestToDbFormat(botId: number, backtest: any, parameters: any, period: string): any {
    // Parse period to determine start and end dates
    const endDate = new Date();
    let startDate = new Date();
    
    const match = period.match(/(\d+)([dhm])/);
    if (match) {
      const value = parseInt(match[1]);
      const unit = match[2];
      
      switch (unit) {
        case 'd':
          startDate.setDate(startDate.getDate() - value);
          break;
        case 'h':
          startDate.setHours(startDate.getHours() - value);
          break;
        case 'm':
          startDate.setMinutes(startDate.getMinutes() - value);
          break;
      }
    } else {
      // Default to 30 days
      startDate.setDate(startDate.getDate() - 30);
    }
    
    return {
      botId,
      tradingPair: backtest.tradingPair || parameters.tradingPair || 'Unknown',
      timeframe: period,
      startDate,
      endDate,
      initialCapital: parameters.investment || 1000,
      finalCapital: (parameters.investment || 1000) * (1 + backtest.profitPercentage / 100),
      totalProfit: backtest.profit,
      profitPercentage: backtest.profitPercentage,
      winRate: backtest.metrics.winRate,
      totalTrades: backtest.metrics.totalTrades,
      winningTrades: backtest.metrics.winningTrades,
      losingTrades: backtest.metrics.losingTrades,
      maxDrawdown: backtest.metrics.maxDrawdown,
      sharpeRatio: backtest.metrics.sharpeRatio,
      profitFactor: backtest.metrics.profitFactor,
      averageProfit: backtest.metrics.averageProfit,
      averageLoss: backtest.metrics.averageLoss,
      maxConsecutiveLosses: backtest.metrics.maxConsecutiveLosses,
      trades: JSON.stringify(backtest.trades),
      equityCurve: JSON.stringify(backtest.equity),
      parameters: JSON.stringify(parameters),
    };
  }
  
  /**
   * Generate a description of optimization changes
   * @param originalParams Original parameters
   * @param optimizedParams Optimized parameters
   * @param improvement Performance improvement
   */
  private generateOptimizationDescription(originalParams: any, optimizedParams: any, improvement: number): string {
    let changes = [];
    
    // Compare parameters and identify changes
    for (const key in optimizedParams) {
      if (key in originalParams && originalParams[key] !== optimizedParams[key]) {
        const originalValue = originalParams[key];
        const optimizedValue = optimizedParams[key];
        
        // Skip complex objects
        if (typeof originalValue !== 'object' && typeof optimizedValue !== 'object') {
          changes.push(`${key}: ${originalValue} → ${optimizedValue}`);
        }
      }
    }
    
    const changeDescription = changes.length > 0 
      ? `Key changes: ${changes.join(', ')}` 
      : 'Minor parameter adjustments';
    
    return `AI optimization with ${improvement.toFixed(2)}% performance improvement. ${changeDescription}`;
  }
  
  /**
   * Safeguard parameters to prevent extreme changes
   * @param originalParams Original parameters
   * @param optimizedParams Optimized parameters from AI
   */
  private safeguardParameters(originalParams: any, optimizedParams: any): any {
    const safeguarded = { ...optimizedParams };
    
    // Set limits for how much parameters can change
    const MAX_CHANGE_PERCENT = 30; // 30% max change
    
    for (const key in originalParams) {
      // Only apply limits to numeric parameters
      if (typeof originalParams[key] === 'number' && typeof optimizedParams[key] === 'number') {
        const originalValue = originalParams[key];
        const optimizedValue = optimizedParams[key];
        
        // Calculate the percentage change
        const changePercent = Math.abs((optimizedValue - originalValue) / originalValue * 100);
        
        // If the change exceeds our limit, adjust it
        if (changePercent > MAX_CHANGE_PERCENT) {
          // Calculate the max allowed change
          const maxChange = originalValue * (MAX_CHANGE_PERCENT / 100);
          
          // Determine direction of change (increase or decrease)
          const direction = optimizedValue > originalValue ? 1 : -1;
          
          // Apply the limited change
          safeguarded[key] = originalValue + (maxChange * direction);
        }
      }
    }
    
    return safeguarded;
  }
}

export const aiService = new AiService();