import type { Express, Request } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { exchangeService } from "./exchangeService";
import { strategyService } from "./strategyService";
import { backtestService } from "./backtestService";
import { aiService } from "./aiService";
import { aiDiagnosticsService, AiProvider } from "./aiDiagnosticsService";
import { setupAuth, isAuthenticated } from "./auth";
import { initWebSocketService } from "./websocketService";
import { z } from "zod";
import { db } from "./db";
import { eq } from "drizzle-orm";
import { 
  insertExchangeSchema, 
  insertBotSchema, 
  insertPortfolioSchema,
  insertPortfolioAllocationSchema,
  insertWalletSchema,
  insertSpeculationBotSchema,
  speculationBots,
  speculationTrades,
  User
} from "@shared/schema";
import {
  createSpeculationBot,
  getUserSpeculationBots,
  getSpeculationBot,
  updateBotStatus,
  updateSpeculationBot,
  deleteSpeculationBot,
  getBotTrades,
  getUserTrades,
  clearAllUserTrades
} from "./speculationService";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication with passport
  setupAuth(app);

  // Create HTTP server
  const httpServer = createServer(app);
  
  // Initialize WebSocket service with the HTTP server
  initWebSocketService(httpServer);
  
  // Markets feature endpoints
  app.get('/api/exchanges/available', async (req, res) => {
    try {
      // If user is authenticated, return only their connected exchanges
      if (req.isAuthenticated() && req.user) {
        const userId = (req.user as User).id;
        const userExchanges = await storage.getExchangesByUserId(userId);
        // Extract only connected exchanges that have displayNames
        const exchangeNames = userExchanges
          .filter(ex => ex.status === 'connected') // Only include connected exchanges
          .map(ex => ({
            id: ex.id,
            name: ex.name,
            displayName: ex.displayName || ex.name
          }));
        res.json(exchangeNames);
      } else {
        // For demo/unauthenticated users, return default exchanges
        const availableExchanges = await exchangeService.getAvailableExchanges();
        const formattedExchanges = availableExchanges.slice(0, 3).map(name => ({
          id: 0,
          name: name,
          displayName: exchangeService.formatExchangeName(name)
        }));
        res.json(formattedExchanges);
      }
    } catch (error: any) {
      console.error('Error fetching available exchanges:', error);
      res.status(500).json({ error: 'Failed to fetch available exchanges' });
    }
  });

  app.get('/api/markets/search', async (req, res) => {
    try {
      const query = req.query.q as string;
      const specificExchange = req.query.exchange as string | undefined;
      
      if (!query || query.length < 2) {
        return res.json({ items: [] });
      }
      
      // If user is authenticated, use their ID to fetch only their connected exchanges
      const userId = req.isAuthenticated() ? (req.user as any).id : undefined;
      
      // Include userId to only search across the user's connected exchanges
      // If specificExchange is provided, only search in that exchange
      const results = await exchangeService.searchAssets(query, userId, specificExchange);
      
      if (results.length === 0 && userId) {
        // If user is authenticated but no results, they might need to connect exchanges
        res.json({ 
          items: [],
          message: specificExchange 
            ? `No assets found on ${specificExchange}. Try a different exchange or search term.`
            : "No assets found. You may need to connect exchange API keys first."
        });
      } else {
        res.json({ items: results });
      }
    } catch (error: any) {
      console.error('Error searching markets:', error);
      res.status(500).json({ error: 'Failed to search markets' });
    }
  });

  app.get('/api/markets/data', async (req, res) => {
    try {
      const { symbol, exchange, timeframe } = req.query;
      
      if (!symbol || !exchange || !timeframe) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      
      // Get current user ID if authenticated, or null for public access
      const userId = req.isAuthenticated() ? getCurrentUserId(req) : null;
      
      const marketData = await exchangeService.getMarketData(
        symbol as string, 
        exchange as string, 
        timeframe as string,
        userId
      );
      
      res.json(marketData);
    } catch (error: any) {
      console.error('Error fetching market data:', error);
      res.status(500).json({ error: 'Failed to fetch market data' });
    }
  });

  // Watchlist endpoints
  app.get('/api/watchlist', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      const watchlist = await storage.getWatchlist(userId);
      res.json({ items: watchlist });
    } catch (error: any) {
      console.error('Error fetching watchlist:', error);
      res.status(500).json({ error: 'Failed to fetch watchlist' });
    }
  });

  app.get('/api/watchlist/folder/:folderName', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      const { folderName } = req.params;
      
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      const watchlist = await storage.getWatchlistByFolder(userId, folderName);
      res.json({ items: watchlist });
    } catch (error: any) {
      console.error('Error fetching watchlist folder:', error);
      res.status(500).json({ error: 'Failed to fetch watchlist folder' });
    }
  });

  app.post('/api/watchlist/add', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      const { symbol, exchange, timeframe, folderName } = req.body;
      
      if (!symbol || !exchange) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }
      
      const watchlistItem = await storage.addToWatchlist(userId, { 
        symbol, 
        exchange, 
        timeframe: timeframe || '1h',
        folderName: folderName || 'default'
      });
      
      res.status(201).json(watchlistItem);
    } catch (error: any) {
      console.error('Error adding to watchlist:', error);
      res.status(500).json({ error: 'Failed to add to watchlist' });
    }
  });

  app.post('/api/watchlist/remove', isAuthenticated, async (req, res) => {
    try {
      const userId = req.user?.id;
      
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }
      
      const { id } = req.body;
      
      if (!id) {
        return res.status(400).json({ error: 'Missing watchlist item ID' });
      }
      
      const success = await storage.removeFromWatchlist(userId, id);
      
      if (success) {
        res.json({ success: true });
      } else {
        res.status(404).json({ error: 'Watchlist item not found or could not be removed' });
      }
    } catch (error: any) {
      console.error('Error removing from watchlist:', error);
      res.status(500).json({ error: 'Failed to remove from watchlist' });
    }
  });
  
  // Function to get current user ID from authenticated session
  const getCurrentUserId = (req: Request): number => {
    if (req.isAuthenticated() && req.user) {
      return (req.user as User).id;
    }
    return 1; // Default to demo user if not authenticated
  };
  
  /**
   * Format an exchange name from its internal id to a proper display name
   * For example: 'binanceus' becomes 'Binance US'
   */
  const formatExchangeName = (exchangeName: string): string => {
    if (!exchangeName) return "";
    
    // Common exchange name transformations
    const nameMap: Record<string, string> = {
      'binanceus': 'Binance US',
      'binance': 'Binance',
      'kraken': 'Kraken',
      'kraken1': 'Kraken',
      'kucoin': 'KuCoin',
      'kucoin1': 'KuCoin',
      'bitfinex': 'Bitfinex',
      'bitfinex1': 'Bitfinex',
      'bitfinex2': 'Bitfinex v2',
      'coinbase': 'Coinbase',
      'coinbasepro': 'Coinbase Pro',
      'coinex': 'CoinEx',
      'ftx': 'FTX',
      'ftxus': 'FTX US',
      'gateio': 'Gate.io',
      'huobi': 'Huobi',
      'huobipro': 'Huobi Pro',
      'okcoin': 'OKCoin',
      'okx': 'OKX',
      'bitflyer': 'bitFlyer',
      'bitstamp': 'Bitstamp',
      'bittrex': 'Bittrex',
      'currencycom': 'Currency.com',
      'cryptocom': 'Crypto.com',
      'gemini': 'Gemini',
      'mexc': 'MEXC',
      'bybit': 'Bybit',
      'phemex': 'Phemex',
      'poloniex': 'Poloniex',
      'upbit': 'Upbit',
      'whitebit': 'WhiteBIT',
      'woo': 'WOO X',
      'demo': 'Demo'
    };

    // Check if the exchange name is in our map
    if (nameMap[exchangeName.toLowerCase()]) {
      return nameMap[exchangeName.toLowerCase()];
    }

    // Default formatting: capitalize first letter and split by non-alphanumeric characters
    return exchangeName
      .split(/(?=[A-Z])|[^a-zA-Z0-9]/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(' ')
      .trim();
  };
  
  // AI diagnostics and recommendation routes
  app.get("/api/ai/providers", async (req, res) => {
    try {
      const providers = await aiDiagnosticsService.getAvailableProviders();
      res.json(providers);
    } catch (error: any) {
      console.error("Error getting AI providers:", error);
      res.status(500).json({ error: error.message || "Failed to get AI providers" });
    }
  });
  
  // Get models for a specific AI provider
  app.get("/api/ai/models/:provider", async (req, res) => {
    try {
      const provider = req.params.provider;
      
      // Validate provider
      if (!Object.values(AiProvider).includes(provider as AiProvider)) {
        return res.status(400).json({ error: `Invalid provider: ${provider}` });
      }
      
      const models = await aiDiagnosticsService.getModelsForProvider(provider as AiProvider);
      res.json({
        provider,
        models,
        currentModel: aiDiagnosticsService.getModelForProvider(provider as AiProvider)
      });
    } catch (error: any) {
      console.error("Error getting AI models:", error);
      res.status(500).json({ error: error.message || "Failed to get AI models" });
    }
  });
  
  // Set model for a specific AI provider
  app.post("/api/ai/models/:provider", async (req, res) => {
    try {
      const provider = req.params.provider as AiProvider;
      const { modelId } = req.body;
      
      // Validate provider
      if (!Object.values(AiProvider).includes(provider)) {
        return res.status(400).json({ error: `Invalid provider: ${provider}` });
      }
      
      // Validate modelId
      if (!modelId || typeof modelId !== 'string') {
        return res.status(400).json({ error: "Model ID is required" });
      }
      
      // Call the async setModelForProvider function
      const success = await aiDiagnosticsService.setModelForProvider(provider, modelId);
      
      if (success) {
        res.json({ 
          provider,
          currentModel: aiDiagnosticsService.getModelForProvider(provider),
          message: `Successfully set model to ${modelId} for provider ${provider}`
        });
      } else {
        res.status(400).json({ error: `Failed to set model ${modelId} for provider ${provider}` });
      }
    } catch (error: any) {
      console.error("Error setting AI model:", error);
      res.status(500).json({ error: error.message || "Failed to set AI model" });
    }
  });

  app.post("/api/backtest/diagnostics", async (req, res) => {
    try {
      const { result, backtestResultId, strategyParams, parameters, strategyType, marketCondition, provider } = req.body;
      
      // Get the strategy type from the multiple possible sources
      let actualStrategyType = strategyType;
      
      // If strategyType is not provided but parameters.strategy is, use that
      if (!actualStrategyType && parameters && parameters.strategy) {
        actualStrategyType = parameters.strategy;
      }
      
      // If that's still not available but strategyParams.strategy is, use that
      if (!actualStrategyType && strategyParams && strategyParams.strategy) {
        actualStrategyType = strategyParams.strategy;
      }
      
      // Validate AI provider if specified
      let selectedProvider = provider;
      if (selectedProvider) {
        // Validate that the provider is a valid AiProvider enum value
        if (!Object.values(AiProvider).includes(selectedProvider)) {
          return res.status(400).json({ 
            error: `Invalid AI provider: ${selectedProvider}. Valid options are: ${Object.values(AiProvider).join(', ')}` 
          });
        }
        console.log(`Analyzing backtest with strategy type: ${actualStrategyType} using provider: ${selectedProvider}`);
      } else {
        console.log(`Analyzing backtest with strategy type: ${actualStrategyType} using default provider`);
      }
      
      // If we have a backtestResultId but no result, fetch the result from storage
      let backtestResult = result;
      if (!backtestResult && backtestResultId) {
        try {
          // Fetch the backtest result from history
          const historyEntry = await storage.getBacktestHistory(backtestResultId);
          
          if (!historyEntry) {
            return res.status(404).json({ 
              error: `Backtest result with ID ${backtestResultId} not found` 
            });
          }
          
          console.log(`Retrieved backtest result ID ${backtestResultId} for analysis`);
          
          // Create a result object in the expected format for the AI analysis
          // The historyEntry contains all the fields we need for analysis
          
          // Parse trades if it's a string
          let trades = historyEntry.trades || [];
          if (typeof historyEntry.trades === 'string') {
            try {
              trades = JSON.parse(historyEntry.trades);
            } catch (e) {
              console.error('Failed to parse trades as JSON:', e);
              trades = [];
            }
          }
          
          // Parse equity curve if it's a string
          let equity = historyEntry.equityCurve || [];
          if (typeof historyEntry.equityCurve === 'string') {
            try {
              equity = JSON.parse(historyEntry.equityCurve);
            } catch (e) {
              console.error('Failed to parse equity curve as JSON:', e);
              equity = [];
            }
          }
          
          // Parse metrics if it's a string
          let metrics = historyEntry.metrics || {};
          if (typeof historyEntry.metrics === 'string') {
            try {
              metrics = JSON.parse(historyEntry.metrics);
            } catch (e) {
              console.error('Failed to parse metrics as JSON:', e);
              metrics = {};
            }
          }
          
          backtestResult = {
            tradingPair: historyEntry.tradingPair,
            profit: historyEntry.totalProfit,
            profitPercentage: historyEntry.profitPercentage,
            trades: trades,
            metrics: metrics.totalTrades ? metrics : {
              totalTrades: historyEntry.totalTrades || 0,
              winningTrades: historyEntry.winningTrades || 0,
              losingTrades: historyEntry.losingTrades || 0,
              winRate: historyEntry.winRate || 0,
              profitFactor: historyEntry.profitFactor || 0,
              averageProfit: historyEntry.averageProfit || 0,
              averageLoss: historyEntry.averageLoss || 0,
              maxDrawdown: historyEntry.maxDrawdown || 0
            },
            equity: equity,
            timestamps: []
          };
          
          // Initialize timestamps if available in the equity curve
          if (Array.isArray(historyEntry.equityCurve) && historyEntry.equityCurve.length > 0 && 
              typeof historyEntry.equityCurve[0] === 'object' && historyEntry.equityCurve[0].timestamp) {
            backtestResult.timestamps = historyEntry.equityCurve.map(point => point.timestamp);
          }
          
          console.log(`Constructed backtest result from history entry for analysis`);
        } catch (fetchError) {
          console.error("Error fetching backtest result:", fetchError);
          return res.status(500).json({ 
            error: `Failed to fetch backtest result: ${fetchError.message}` 
          });
        }
      }
      
      if (!backtestResult) {
        return res.status(400).json({
          error: "No backtest result provided. Please provide either 'result' or 'backtestResultId'."
        });
      }
      
      // Add fallback values for missing properties to prevent errors
      if (!backtestResult.metrics) {
        backtestResult.metrics = {
          totalTrades: backtestResult.trades?.length || 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          profitFactor: 0,
          averageProfit: 0,
          averageLoss: 0,
          maxDrawdown: 0
        };
      }
      
      const diagnostics = await aiDiagnosticsService.analyzeBacktest(
        backtestResult,
        actualStrategyType,
        strategyParams || parameters, // Use whichever is available
        marketCondition,
        selectedProvider
      );
      res.json(diagnostics);
    } catch (error: any) {
      console.error("AI diagnostics error:", error);
      res.status(500).json({ error: error.message || "Failed to analyze backtest" });
    }
  });
  
  app.post("/api/backtest/apply-recommendation", async (req, res) => {
    try {
      const { recommendation, currentParameters } = req.body;
      
      console.log('Applying recommendation:', JSON.stringify({
        title: recommendation.title,
        parameters: recommendation.parameters
      }));
      console.log('Current parameters:', JSON.stringify(currentParameters));
      
      // Apply the single recommendation to the parameters
      let updatedParameters = { ...currentParameters };
      
      // If the recommendation includes parameters, apply them
      if (recommendation.parameters) {
        // Handle nested parameters (e.g., bollinger.period)
        Object.entries(recommendation.parameters).forEach(([key, value]) => {
          // Skip any parameters that contain function references or have null values
          if (typeof value === 'string' && value.includes('(') && value.includes(')')) {
            console.log(`Skipping function parameter: ${key} = ${value}`);
            return;
          }
          
          // Skip null values
          if (value === null) {
            console.log(`Skipping null parameter: ${key}`);
            return;
          }
          
          const pathParts = key.split('.');
          if (pathParts.length === 1) {
            console.log(`Setting parameter ${key} = ${value}`);
            updatedParameters[key] = value;
          } else {
            if (!updatedParameters[pathParts[0]]) {
              updatedParameters[pathParts[0]] = {};
            }
            console.log(`Setting nested parameter ${pathParts[0]}.${pathParts[1]} = ${value}`);
            updatedParameters[pathParts[0]][pathParts[1]] = value;
          }
        });
      }
      
      console.log('Updated parameters:', JSON.stringify(updatedParameters));
      
      res.json({
        success: true,
        parameters: updatedParameters,
        appliedRecommendation: recommendation
      });
    } catch (error: any) {
      console.error("Apply recommendation error:", error);
      res.status(500).json({ error: error.message || "Failed to apply recommendation" });
    }
  });
  
  app.post("/api/backtest/apply-all-recommendations", async (req, res) => {
    try {
      const { recommendations, currentParameters } = req.body;
      
      console.log(`Applying ${recommendations.length} recommendations`);
      console.log('Current parameters:', JSON.stringify(currentParameters));
      
      // Apply all recommendations to the parameters
      let updatedParameters = { ...currentParameters };
      
      // Apply each recommendation's parameters sequentially
      recommendations.forEach((recommendation, index) => {
        console.log(`Processing recommendation ${index + 1}: ${recommendation.title}`);
        
        if (recommendation.parameters) {
          console.log(`Recommendation parameters:`, JSON.stringify(recommendation.parameters));
          
          Object.entries(recommendation.parameters).forEach(([key, value]) => {
            // Skip any parameters that contain function references or have null values
            if (typeof value === 'string' && value.includes('(') && value.includes(')')) {
              console.log(`Skipping function parameter: ${key} = ${value}`);
              return;
            }
            
            // Skip null values
            if (value === null) {
              console.log(`Skipping null parameter: ${key}`);
              return;
            }
            
            const pathParts = key.split('.');
            if (pathParts.length === 1) {
              console.log(`Setting parameter ${key} = ${value}`);
              updatedParameters[key] = value;
            } else {
              if (!updatedParameters[pathParts[0]]) {
                updatedParameters[pathParts[0]] = {};
              }
              console.log(`Setting nested parameter ${pathParts[0]}.${pathParts[1]} = ${value}`);
              updatedParameters[pathParts[0]][pathParts[1]] = value;
            }
          });
        } else {
          console.log(`Recommendation has no parameters to apply`);
        }
      });
      
      console.log('Final updated parameters:', JSON.stringify(updatedParameters));
      
      res.json({
        success: true,
        parameters: updatedParameters,
        appliedRecommendations: recommendations.length
      });
    } catch (error: any) {
      console.error("Apply all recommendations error:", error);
      res.status(500).json({ error: error.message || "Failed to apply recommendations" });
    }
  });

  // Exchange routes
  app.get("/api/exchanges", async (req, res) => {
    const userId = getCurrentUserId(req);
    const exchanges = await storage.getExchangesByUserId(userId);
    
    // Add formatted display names for consistent UI presentation
    exchanges.forEach(exchange => {
      if (!exchange.displayName) {
        // Format the exchange name properly if no custom display name is set
        const formattedName = formatExchangeName(exchange.name);
        exchange.displayName = formattedName;
      }
    });
    
    res.json(exchanges);
  });
  
  app.get("/api/exchanges/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ message: "Invalid exchange ID" });
    }
    
    const exchange = await storage.getExchange(id);
    if (!exchange) {
      return res.status(404).json({ message: "Exchange not found" });
    }
    
    res.json(exchange);
  });
  
  // Get trading pairs for a specific exchange (no auth required for backtesting)
  app.get("/api/exchanges/:id/trading-pairs", async (req, res) => {
    try {
      const exchangeId = parseInt(req.params.id);
      if (isNaN(exchangeId)) {
        return res.status(400).json({ error: "Invalid exchange ID" });
      }
      
      // Get exchange from database
      const exchange = await storage.getExchange(exchangeId);
      if (!exchange) {
        return res.status(404).json({ error: "Exchange not found" });
      }
      
      // Check if we should force refresh based on query parameter
      const forceRefresh = req.query.refresh === 'true';
      
      try {
        // Import the tradingPairService to get trading pairs with automatic refresh
        const { tradingPairService } = await import("./tradingPairService");
        
        // Use the trading pair service to get trading pairs with automatic refresh
        console.log(`Getting trading pairs for exchange ${exchange.name} (ID: ${exchangeId}) with auto-refresh...`);
        const pairs = await tradingPairService.getTradingPairsForExchange(exchangeId, forceRefresh);
        
        // Add exchange information to the response
        const pairsWithExchange = pairs.map(pair => ({
          ...pair,
          exchangeName: exchange.displayName || exchange.name,
          exchangeIsDemo: exchange.isDemo || false
        }));
        
        return res.json(pairsWithExchange);
      } catch (pairError) {
        console.error(`Error getting trading pairs for exchange ${exchange.name}:`, pairError);
        return res.status(500).json({ 
          error: "Failed to fetch trading pairs for exchange",
          message: pairError instanceof Error ? pairError.message : String(pairError)
        });
      }
    } catch (error) {
      console.error("Error fetching exchange trading pairs:", error);
      return res.status(500).json({ error: "Failed to fetch trading pairs for exchange" });
    }
  });
  
  app.post("/api/exchanges", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      
      // Check if this is a demo exchange request
      const isDemo = req.body.name?.toLowerCase() === 'demo' || req.body.isDemo === true;
      
      // For demo exchanges, we don't need real API keys
      let validatedData;
      if (isDemo) {
        console.log("Setting up a demo exchange with Kucoin as the backend");
        // Override the API key values for demo
        validatedData = insertExchangeSchema.parse({
          ...req.body,
          userId,
          isDemo: true,
          apiKey: "demo-api-key",
          apiSecret: "demo-api-secret",
          name: req.body.name || "demo",
          displayName: req.body.displayName || "Demo Exchange"
        });
      } else {
        // Regular exchange with real API keys
        validatedData = insertExchangeSchema.parse({
          ...req.body,
          userId,
          isDemo: false
        });
      }
      
      // Create the exchange
      const exchange = await storage.createExchange(validatedData);
      
      // Connect to the exchange API (this will handle demo exchanges specially)
      await exchangeService.connect(exchange);
      
      try {
        // Import the tradingPairService to get trading pairs with automatic refresh
        const { tradingPairService } = await import("./tradingPairService");
        
        // Fetch and store trading pairs using the trading pair service (with force refresh = true)
        await tradingPairService.getTradingPairsForExchange(exchange.id, true);
        console.log(`Successfully fetched initial trading pairs for new exchange ${exchange.name}`);
      } catch (pairError) {
        console.error(`Warning: Failed to fetch initial trading pairs for new exchange ${exchange.name}:`, pairError);
        // Continue anyway since exchange was created successfully
      }
      
      res.status(201).json(exchange);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.format() });
      }
      
      console.error("Error creating exchange:", error);
      res.status(500).json({ message: "Failed to create exchange" });
    }
  });

  // Update an exchange
  app.put("/api/exchanges/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid exchange ID" });
      }
      
      // Check if exchange exists and belongs to the user
      const exchange = await storage.getExchange(id);
      if (!exchange) {
        return res.status(404).json({ message: "Exchange not found" });
      }
      
      if (exchange.userId !== userId) {
        return res.status(403).json({ message: "Not authorized to update this exchange" });
      }
      
      // Validate update data
      const updateSchema = z.object({
        displayName: z.string().optional(),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        canWithdraw: z.boolean().optional(),
        isDemo: z.boolean().optional()
      });
      
      const updateData = updateSchema.parse(req.body);
      
      // If this is a demo exchange and API credentials are being updated,
      // override them with demo values
      if (exchange.isDemo || updateData.isDemo) {
        updateData.apiKey = "demo-api-key";
        updateData.apiSecret = "demo-api-secret";
        updateData.isDemo = true;
      }
      
      // Update exchange in database
      await storage.updateExchange(id, updateData);
      
      // If API credentials were updated, test the connection
      if (updateData.apiKey || updateData.apiSecret) {
        try {
          await exchangeService.connect(exchange);
          
          // Update status to connected if successful
          await storage.updateExchangeStatus(id, true);
          
          // If connection was successful, refresh trading pairs
          try {
            // Import the tradingPairService to refresh trading pairs
            const { tradingPairService } = await import("./tradingPairService");
            
            // Force refresh trading pairs for this exchange after credentials update
            console.log(`Refreshing trading pairs for exchange ${exchange.name} after updating credentials...`);
            await tradingPairService.getTradingPairsForExchange(id, true);
          } catch (pairError) {
            console.error(`Warning: Failed to refresh trading pairs for exchange ${exchange.name} after credential update:`, pairError);
            // Continue anyway since the connection test was successful
          }
        } catch (error) {
          console.error(`Failed to connect to updated exchange: ${error.message}`);
          // Update status to indicate connection failed
          await storage.updateExchangeStatus(id, false);
        }
      }
      
      res.json({ message: "Exchange updated successfully" });
      
    } catch (error) {
      console.error('Error updating exchange:', error);
      
      if (error.name === 'ZodError') {
        return res.status(400).json({ 
          message: "Invalid data format", 
          errors: error.errors 
        });
      }
      
      res.status(500).json({ 
        message: error.message || 'Failed to update exchange' 
      });
    }
  });

  app.post("/api/exchanges/:id/test", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid exchange ID" });
      }
      
      // Check if exchange exists and belongs to the user
      const exchange = await storage.getExchange(id);
      if (!exchange) {
        return res.status(404).json({ message: "Exchange not found" });
      }
      
      if (exchange.userId !== userId) {
        return res.status(403).json({ message: "Not authorized to test this exchange" });
      }
      
      // Test the connection by attempting to connect to the exchange
      console.log(`Testing connection to exchange ${exchange.name} (ID: ${exchange.id})`);
      try {
        await exchangeService.connect(exchange);
        
        // Fetch the latest exchange status after the connection attempt
        const updatedExchange = await storage.getExchange(exchange.id);
        const isConnected = updatedExchange?.status === 'connected';
        
        // If connection was successful, refresh trading pairs
        if (isConnected) {
          try {
            // Import the tradingPairService to refresh trading pairs
            const { tradingPairService } = await import("./tradingPairService");
            
            // Force refresh trading pairs for this exchange
            console.log(`Refreshing trading pairs for exchange ${exchange.name} after successful connection...`);
            await tradingPairService.getTradingPairsForExchange(exchange.id, true);
          } catch (pairError) {
            console.error(`Warning: Failed to refresh trading pairs for exchange ${exchange.name}:`, pairError);
            // Continue anyway since the connection test was successful
          }
        }
        
        res.status(200).json({ 
          success: isConnected, 
          message: isConnected ? "Connection successful" : "Connection failed",
          exchangeId: exchange.id,
          exchangeName: exchange.name,
          status: updatedExchange?.status
        });
      } catch (connectionError) {
        // Even though this will be caught by the outer catch block,
        // we want to include more specific error details here
        res.status(200).json({ 
          success: false, 
          message: "Connection failed",
          error: connectionError instanceof Error ? connectionError.message : String(connectionError),
          exchangeId: exchange.id,
          exchangeName: exchange.name,
          status: "disconnected"
        });
      }
    } catch (error) {
      console.error(`Error testing exchange connection (ID: ${req.params.id}):`, error);
      res.status(500).json({ 
        success: false, 
        message: "Failed to connect to exchange", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  app.delete("/api/exchanges/:id", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const id = parseInt(req.params.id);
      
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid exchange ID" });
      }
      
      // Check if exchange exists and belongs to the user
      const exchange = await storage.getExchange(id);
      if (!exchange) {
        return res.status(404).json({ message: "Exchange not found" });
      }
      
      if (exchange.userId !== userId) {
        return res.status(403).json({ message: "Not authorized to delete this exchange" });
      }
      
      // Delete the exchange
      const success = await storage.deleteExchange(id);
      
      if (success) {
        res.status(200).json({ message: "Exchange deleted successfully" });
      } else {
        res.status(500).json({ message: "Failed to delete exchange" });
      }
    } catch (error) {
      console.error("Error deleting exchange:", error);
      res.status(500).json({ message: "Failed to delete exchange" });
    }
  });
  
  // Trading pairs routes
  app.get("/api/trading-pairs", async (req, res) => {
    try {
      // Get pairs for the user's connected exchanges
      const userId = getCurrentUserId(req);
      const exchanges = await storage.getExchangesByUserId(userId);
      
      // Filter to only include connected exchanges
      const connectedExchanges = exchanges.filter(exchange => exchange.status === 'connected');
      
      if (connectedExchanges.length === 0) {
        return res.json([]);
      }
      
      console.log(`Fetching trading pairs for ${connectedExchanges.length} connected exchanges...`);
      
      // Import the tradingPairService to get trading pairs with automatic refresh
      const { tradingPairService } = await import("./tradingPairService");
      
      // Get pairs for all connected exchanges
      const allPairs = [];
      
      // Check if we should force refresh based on query parameter
      const forceRefresh = req.query.refresh === 'true';
      
      for (const exchange of connectedExchanges) {
        try {
          // Use trading pair service which handles refresh logic based on lastRefreshedAt
          console.log(`Getting trading pairs for ${exchange.name} with auto-refresh...`);
          
          // Get trading pairs with automatic refresh if needed
          const pairs = await tradingPairService.getTradingPairsForExchange(exchange.id, forceRefresh);
          
          // Add exchange info to each pair
          const pairsWithExchange = pairs.map(pair => ({
            ...pair,
            exchangeName: exchange.displayName || exchange.name,
            exchangeIsDemo: exchange.isDemo || false
          }));
          
          allPairs.push(...pairsWithExchange);
          console.log(`Retrieved ${pairs.length} trading pairs for ${exchange.name}`);
        } catch (error) {
          console.error(`Error getting trading pairs for ${exchange.name}:`, error);
        }
      }
      
      res.json(allPairs);
    } catch (error) {
      console.error("Error fetching trading pairs:", error);
      res.status(500).json({ message: "Failed to fetch trading pairs" });
    }
  });
  
  // Bot routes
  app.get("/api/bots", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const bots = await storage.getBotsByUserId(userId);
      res.json(bots);
    } catch (error) {
      console.error("Error fetching bots:", error);
      res.status(500).json({ message: "Failed to fetch bots" });
    }
  });
  
  app.get("/api/bots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      
      res.json(bot);
    } catch (error) {
      console.error("Error fetching bot:", error);
      res.status(500).json({ message: "Failed to fetch bot" });
    }
  });
  
  app.post("/api/bots", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      
      // Validate and transform request data
      const botData = {
        ...req.body,
        userId,
        parameters: JSON.stringify(req.body.parameters || {}),
        botType: req.body.botType || 'live' // Set default botType to 'live' if not provided
      };
      
      const validatedData = insertBotSchema.parse(botData);
      
      // Create the bot
      const bot = await storage.createBot(validatedData);
      res.status(201).json(bot);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.format() });
      }
      
      console.error("Error creating bot:", error);
      res.status(500).json({ message: "Failed to create bot" });
    }
  });
  
  app.patch("/api/bots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      
      // Prepare updates, converting parameters to JSON string if present
      const updates = {
        ...req.body
      };
      
      if (req.body.parameters) {
        updates.parameters = JSON.stringify(req.body.parameters);
      }
      
      // Ensure botType is valid if provided
      if (req.body.botType && !['live', 'paper'].includes(req.body.botType)) {
        updates.botType = 'live'; // Default to live if invalid value is provided
      }
      
      // Update the bot
      const updatedBot = await storage.updateBot(id, updates);
      res.json(updatedBot);
    } catch (error) {
      console.error("Error updating bot:", error);
      res.status(500).json({ message: "Failed to update bot" });
    }
  });
  
  app.patch("/api/bots/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const { status } = req.body;
      if (!status || !["active", "paused", "stopped"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      
      // Update bot status
      const updatedBot = await storage.updateBotStatus(id, status);
      
      // Start or stop the bot's trading operations
      if (status === "active") {
        await strategyService.startBot(id);
      } else if (status === "stopped" || status === "paused") {
        await strategyService.stopBot(id);
      }
      
      res.json(updatedBot);
    } catch (error) {
      console.error("Error updating bot status:", error);
      res.status(500).json({ message: "Failed to update bot status" });
    }
  });
  
  app.post("/api/bots/:id/deploy", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      
      // Deploy the bot
      await strategyService.deployBot(id);
      
      // Update bot status to active
      const updatedBot = await storage.updateBotStatus(id, "active");
      
      res.json(updatedBot);
    } catch (error) {
      console.error("Error deploying bot:", error);
      res.status(500).json({ message: "Failed to deploy bot" });
    }
  });
  
  // Delete a bot
  app.delete("/api/bots/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const userId = getCurrentUserId(req);
      
      // Get the bot and verify ownership
      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      
      if (bot.userId !== userId) {
        return res.status(403).json({ message: "Unauthorized to delete this bot" });
      }
      
      // Check if bot is running and stop it first if needed
      if (bot.status === 'active' || bot.status === 'paused') {
        await strategyService.stopBot(id);
      }
      
      // Delete the bot's trades first
      await storage.deleteBotTrades(id);
      
      // Then delete the bot
      await storage.deleteBot(id);
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error deleting bot:", error);
      res.status(500).json({ message: "Failed to delete bot" });
    }
  });
  
  // Backtest routes
  app.post("/api/backtest", async (req, res) => {
    try {
      const { pair, strategy, period, interval, parameters, botId, exchangeId, investment, initialInvestment, startDate, endDate } = req.body;
      
      if (!pair || !parameters) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Check if exchangeId is provided
      if (!exchangeId) {
        return res.status(400).json({ message: "Exchange ID is required" });
      }
      
      // Make sure we have a strategy parameter and map from client-side to server-side format
      // Convert from client-side strategy format to server-side format
      const strategyMap: Record<string, string> = {
        "BOLLINGER_BANDS": "bollinger_bands",
        "MACD": "macd",
        "RSI": "rsi",
        "GRID_TRADING": "grid",
        "DOLLAR_COST_AVERAGING": "dca",
        "MOVING_AVERAGE_CROSSOVER": "ma_crossover",
        "SMA": "sma",
        "EMA": "ema",
        "SIGNAL": "signal"
      };
      
      // First check if we have a direct strategy parameter, then check inside parameters
      let strategyParam = strategy || parameters.strategy;
      
      // Map from client format (MACD) to server format (macd) if needed
      let normalizedStrategy = strategyMap[strategyParam] || strategyParam || "bollinger_bands";
      
      console.log(`Using strategy: ${normalizedStrategy} (original: ${strategyParam})`);
      
      // Get investment amount from multiple possible sources
      const investmentAmount = investment || initialInvestment || parameters.investment || parameters.initialInvestment || 1000;
      console.log(`Using investment amount of: ${investmentAmount} (sources checked: direct investment, initialInvestment, or from parameters)`);
      
      // Make sure investment is included in the parameters
      const params = {
        ...parameters,
        strategy: normalizedStrategy,
        investment: parseFloat(String(investmentAmount))
      };
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range: from ${startDate} to ${endDate}`);
      }
      
      // Log the final parameters being sent to the backtest service
      console.log(`Running backtest for ${pair} with strategy ${params.strategy} over period ${period || '30d'} with interval ${interval || 'derived from period'} on exchange ID: ${exchangeId}`);
      console.log('Backtest parameters:', JSON.stringify(params));
      
      let backtest = await backtestService.runBacktest(pair, params, period, exchangeId, interval, startDate, endDate);
      
      // Ensure we're always returning valid numeric values (not NaN)
      if (backtest) {
        console.log("Sanitizing backtest results before sending to client...");
        
        // Create a fully sanitized response
        const sanitizedResults = {
          tradingPair: backtest.tradingPair || '',
          profit: isNaN(backtest.profit) ? 0 : backtest.profit,
          profitPercentage: isNaN(backtest.profitPercentage) ? 0 : backtest.profitPercentage,
          trades: Array.isArray(backtest.trades) ? backtest.trades.map(trade => ({
            id: trade.id || 0,
            timestamp: trade.timestamp || Date.now(),
            entryPrice: isNaN(trade.entryPrice) ? 0 : trade.entryPrice,
            exitPrice: isNaN(trade.exitPrice) ? 0 : trade.exitPrice,
            amount: isNaN(trade.amount) ? 0 : trade.amount,
            profit: isNaN(trade.profit) ? 0 : trade.profit,
            profitPercentage: isNaN(trade.profitPercentage) ? 0 : trade.profitPercentage,
            side: trade.side || 'buy',
            duration: isNaN(trade.duration) ? 0 : trade.duration
          })) : [],
          metrics: {
            totalTrades: isNaN(backtest.metrics?.totalTrades) ? 0 : backtest.metrics?.totalTrades || 0,
            winningTrades: isNaN(backtest.metrics?.winningTrades) ? 0 : backtest.metrics?.winningTrades || 0,
            losingTrades: isNaN(backtest.metrics?.losingTrades) ? 0 : backtest.metrics?.losingTrades || 0,
            winRate: isNaN(backtest.metrics?.winRate) ? 0 : backtest.metrics?.winRate || 0,
            profitFactor: isNaN(backtest.metrics?.profitFactor) ? 0 : backtest.metrics?.profitFactor || 0,
            averageProfit: isNaN(backtest.metrics?.averageProfit) ? 0 : backtest.metrics?.averageProfit || 0,
            averageLoss: isNaN(backtest.metrics?.averageLoss) ? 0 : backtest.metrics?.averageLoss || 0,
            largestProfit: isNaN(backtest.metrics?.largestProfit) ? 0 : backtest.metrics?.largestProfit || 0,
            largestLoss: isNaN(backtest.metrics?.largestLoss) ? 0 : backtest.metrics?.largestLoss || 0,
            maxDrawdown: isNaN(backtest.metrics?.maxDrawdown) ? 0 : backtest.metrics?.maxDrawdown || 0,
            sharpeRatio: isNaN(backtest.metrics?.sharpeRatio) ? 0 : backtest.metrics?.sharpeRatio || 0,
            maxConsecutiveWins: isNaN(backtest.metrics?.maxConsecutiveWins) ? 0 : backtest.metrics?.maxConsecutiveWins || 0,
            maxConsecutiveLosses: isNaN(backtest.metrics?.maxConsecutiveLosses) ? 0 : backtest.metrics?.maxConsecutiveLosses || 0
          },
          equity: Array.isArray(backtest.equity) && backtest.equity.length > 0 
            ? backtest.equity.map(value => isNaN(value) ? parameters.investment || 1000 : value)
            : [parameters.investment || 1000],
          timestamps: Array.isArray(backtest.timestamps) && backtest.timestamps.length > 0
            ? backtest.timestamps.map(ts => isNaN(ts) ? Date.now() : ts)
            : [Date.now()]
        };
        
        // Replace with sanitized results
        backtest = sanitizedResults;
        console.log("Sanitization complete");
        
        // Auto-save backtest to history if user is authenticated
        if (req.isAuthenticated()) {
          try {
            const now = new Date();
            // Use provided startDate for custom date ranges, or calculate based on period
            const backtestStartDate = period === 'custom' && startDate 
              ? new Date(startDate)
              : new Date(now.getTime() - (period === '1d' ? 24 * 60 * 60 * 1000 : 
                                        period === '7d' ? 7 * 24 * 60 * 60 * 1000 : 
                                        period === '30d' ? 30 * 24 * 60 * 60 * 1000 : 
                                        90 * 24 * 60 * 60 * 1000));
            
            // Format trade data with detailed information for each trade
            const detailedTrades = backtest.trades.map(trade => {
              const entryAmount = trade.amount * trade.entryPrice;
              const exitAmount = trade.amount * trade.exitPrice;
              
              return {
                timestamp: trade.timestamp,
                entryPrice: trade.entryPrice,
                exitPrice: trade.exitPrice,
                amount: trade.amount, 
                entryValue: entryAmount,
                exitValue: exitAmount,
                profit: trade.profit,
                profitPercentage: trade.profitPercentage,
                side: trade.side,
                duration: trade.duration,
                durationFormatted: `${Math.floor(trade.duration / (24 * 3600 * 1000))}d ${Math.floor((trade.duration % (24 * 3600 * 1000)) / (3600 * 1000))}h ${Math.floor((trade.duration % (3600 * 1000)) / (60 * 1000))}m`
              };
            });
            
            // Create equity curve data points
            const equityCurve = backtest.equity.map((equity, index) => {
              return {
                timestamp: backtest.timestamps[index] || Date.now(),
                value: equity
              };
            });
            
            // Get exchange information first
            const exchange = await storage.getExchangeById(exchangeId);
            
            // Use the exchange name from exchange information, or "Unknown" as fallback
            const exchangeName = exchange ? exchange.name : "Unknown";
            
            await storage.createBacktestHistory({
              userId: req.user.id,
              strategyType: normalizedStrategy,
              tradingPair: pair,
              timeframe: interval || period,
              exchange: exchangeName, // Set the exchange name
              exchangeId: exchangeId,
              startDate: backtestStartDate,
              endDate: endDate ? new Date(endDate) : now,
              initialCapital: parseFloat(String(investmentAmount)),
              finalCapital: parseFloat(String(investmentAmount)) + backtest.profit,
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
              trades: detailedTrades,
              equityCurve: equityCurve,
              parameters: params,
              metrics: backtest.metrics || {} // Add metrics field with fallback
            });
            
            console.log("Backtest auto-saved to history");
          } catch (saveError) {
            console.error("Error auto-saving backtest to history:", saveError);
            // Continue sending response even if save fails
          }
        }
      }
      
      res.json(backtest);
    } catch (error) {
      console.error("Error running backtest:", error);
      res.status(500).json({ 
        message: "Failed to run backtest", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // AI Diagnostics for backtest
  app.post("/api/backtest/diagnose", async (req, res) => {
    try {
      const { backtestResult, strategy, parameters, marketCondition, provider } = req.body;
      
      if (!backtestResult || !strategy) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Allow specifying the AI provider from the request
      let selectedProvider = provider;
      if (selectedProvider) {
        // Validate that the provider is a valid AiProvider enum value
        if (!Object.values(AiProvider).includes(selectedProvider)) {
          return res.status(400).json({ 
            error: `Invalid AI provider: ${selectedProvider}. Valid options are: ${Object.values(AiProvider).join(', ')}` 
          });
        }
      }
      
      // Analyze backtest with AI
      console.log(`Running AI diagnostics for ${strategy} strategy backtest using provider: ${selectedProvider || 'default'}`);
      const diagnostics = await aiDiagnosticsService.analyzeBacktest(
        backtestResult,
        strategy,
        parameters,
        marketCondition || "unknown",
        selectedProvider
      );
      
      res.json(diagnostics);
    } catch (error) {
      console.error("Error running AI diagnostics:", error);
      res.status(500).json({ 
        message: "Failed to analyze backtest with AI", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // AI Provider settings endpoints
  app.get("/api/ai/providers", async (req, res) => {
    try {
      const providers = await aiDiagnosticsService.getAvailableProviders();
      res.json(providers);
    } catch (error: any) {
      console.error('Error getting AI providers:', error);
      res.status(500).json({ error: error.message || 'Failed to get AI providers' });
    }
  });
  
  app.get("/api/ai/models/:provider", async (req, res) => {
    try {
      const provider = req.params.provider as AiProvider;
      
      // Validate provider
      if (!Object.values(AiProvider).includes(provider)) {
        return res.status(400).json({ 
          error: `Invalid AI provider: ${provider}. Valid options are: ${Object.values(AiProvider).join(', ')}` 
        });
      }
      
      const models = await aiDiagnosticsService.getModelsForProvider(provider);
      const currentModel = aiDiagnosticsService.getModelForProvider(provider);
      
      res.json({
        models,
        currentModel
      });
    } catch (error: any) {
      console.error('Error getting AI models:', error);
      res.status(500).json({ error: error.message || 'Failed to get AI models' });
    }
  });
  
  app.post("/api/ai/setModel", async (req, res) => {
    try {
      const { provider, modelId } = req.body;
      
      // Validate provider
      if (!Object.values(AiProvider).includes(provider)) {
        return res.status(400).json({ 
          error: `Invalid AI provider: ${provider}. Valid options are: ${Object.values(AiProvider).join(', ')}` 
        });
      }
      
      if (!modelId) {
        return res.status(400).json({ error: 'Model ID is required' });
      }
      
      const success = await aiDiagnosticsService.setModelForProvider(provider, modelId);
      
      if (!success) {
        return res.status(400).json({ error: `Failed to set model: ${modelId} for provider: ${provider}` });
      }
      
      res.json({
        provider,
        modelId,
        success
      });
    } catch (error: any) {
      console.error('Error setting AI model:', error);
      res.status(500).json({ error: error.message || 'Failed to set AI model' });
    }
  });
  
  // Enhanced backtest routes
  app.post("/api/backtest/enhanced", async (req, res) => {
    try {
      const { 
        pair, 
        strategy, 
        period,
        interval, 
        parameters, 
        botId, 
        aiDiagnosticsEnabled = true,
        aiProvider,
        investment,
        initialInvestment,
        startDate,
        endDate
      } = req.body;
      
      if (!pair || !parameters) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Make sure we have a strategy parameter and map from client-side to server-side format
      // Convert from client-side strategy format to server-side format
      const strategyMap: Record<string, string> = {
        "BOLLINGER_BANDS": "bollinger_bands",
        "MACD": "macd",
        "RSI": "rsi",
        "GRID_TRADING": "grid",
        "DOLLAR_COST_AVERAGING": "dca",
        "MOVING_AVERAGE_CROSSOVER": "ma_crossover",
        "SMA": "sma",
        "EMA": "ema",
        "SIGNAL": "signal"
      };
      
      // First check if we have a direct strategy parameter, then check inside parameters
      let strategyParam = strategy || parameters.strategy;
      
      // Map from client format (MACD) to server format (macd) if needed
      let normalizedStrategy = strategyMap[strategyParam] || strategyParam || "bollinger_bands";
      
      console.log(`Using strategy for enhanced backtest: ${normalizedStrategy} (original: ${strategyParam})`);
      
      // Get investment amount from multiple possible sources
      const investmentAmount = investment || initialInvestment || parameters.investment || parameters.initialInvestment || 1000;
      console.log(`Using investment amount for enhanced backtest: ${investmentAmount} (sources checked: direct investment, initialInvestment, or from parameters)`);
      
      const params = {
        ...parameters,
        strategy: normalizedStrategy,
        investment: parseFloat(String(investmentAmount))
      };
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Validate AI provider if specified
      if (aiProvider && !Object.values(AiProvider).includes(aiProvider)) {
        return res.status(400).json({ 
          error: `Invalid AI provider: ${aiProvider}. Valid options are: ${Object.values(AiProvider).join(', ')}` 
        });
      }
      
      // Run enhanced backtest
      console.log(`Running enhanced backtest for ${pair} with strategy ${params.strategy} over period ${period || '30d'} with interval ${interval || 'derived from period'}`);
      
      if (aiDiagnosticsEnabled) {
        console.log(`AI diagnostics enabled, using provider: ${aiProvider || 'default'}`);
      } else {
        console.log(`AI diagnostics disabled`);
      }
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for enhanced backtest: from ${startDate} to ${endDate}`);
      }
      
      let enhancedBacktest = await enhancedBacktestService.runBacktest(
        pair, 
        params, 
        period, 
        botId, 
        aiDiagnosticsEnabled,
        aiProvider,
        interval,
        startDate,
        endDate
      );
      
      // Ensure we're always returning valid numeric values (not NaN)
      if (enhancedBacktest) {
        console.log("Sanitizing enhanced backtest results before sending to client...");
        
        // Create a fully sanitized response
        const sanitizedResults = {
          tradingPair: enhancedBacktest.tradingPair || '',
          profit: isNaN(enhancedBacktest.profit) ? 0 : enhancedBacktest.profit,
          profitPercentage: isNaN(enhancedBacktest.profitPercentage) ? 0 : enhancedBacktest.profitPercentage,
          trades: Array.isArray(enhancedBacktest.trades) ? enhancedBacktest.trades.map(trade => ({
            id: trade.id || 0,
            timestamp: trade.timestamp || Date.now(),
            entryPrice: isNaN(trade.entryPrice) ? 0 : trade.entryPrice,
            exitPrice: isNaN(trade.exitPrice) ? 0 : trade.exitPrice,
            amount: isNaN(trade.amount) ? 0 : trade.amount,
            profit: isNaN(trade.profit) ? 0 : trade.profit,
            profitPercentage: isNaN(trade.profitPercentage) ? 0 : trade.profitPercentage,
            side: trade.side || 'buy',
            duration: isNaN(trade.duration) ? 0 : trade.duration
          })) : [],
          metrics: {
            totalTrades: isNaN(enhancedBacktest.metrics?.totalTrades) ? 0 : enhancedBacktest.metrics?.totalTrades || 0,
            winningTrades: isNaN(enhancedBacktest.metrics?.winningTrades) ? 0 : enhancedBacktest.metrics?.winningTrades || 0,
            losingTrades: isNaN(enhancedBacktest.metrics?.losingTrades) ? 0 : enhancedBacktest.metrics?.losingTrades || 0,
            winRate: isNaN(enhancedBacktest.metrics?.winRate) ? 0 : enhancedBacktest.metrics?.winRate || 0,
            profitFactor: isNaN(enhancedBacktest.metrics?.profitFactor) ? 0 : enhancedBacktest.metrics?.profitFactor || 0,
            averageProfit: isNaN(enhancedBacktest.metrics?.averageProfit) ? 0 : enhancedBacktest.metrics?.averageProfit || 0,
            averageLoss: isNaN(enhancedBacktest.metrics?.averageLoss) ? 0 : enhancedBacktest.metrics?.averageLoss || 0,
            largestProfit: isNaN(enhancedBacktest.metrics?.largestProfit) ? 0 : enhancedBacktest.metrics?.largestProfit || 0,
            largestLoss: isNaN(enhancedBacktest.metrics?.largestLoss) ? 0 : enhancedBacktest.metrics?.largestLoss || 0,
            maxDrawdown: isNaN(enhancedBacktest.metrics?.maxDrawdown) ? 0 : enhancedBacktest.metrics?.maxDrawdown || 0,
            sharpeRatio: isNaN(enhancedBacktest.metrics?.sharpeRatio) ? 0 : enhancedBacktest.metrics?.sharpeRatio || 0,
            maxConsecutiveWins: isNaN(enhancedBacktest.metrics?.maxConsecutiveWins) ? 0 : enhancedBacktest.metrics?.maxConsecutiveWins || 0,
            maxConsecutiveLosses: isNaN(enhancedBacktest.metrics?.maxConsecutiveLosses) ? 0 : enhancedBacktest.metrics?.maxConsecutiveLosses || 0
          },
          equity: Array.isArray(enhancedBacktest.equity) && enhancedBacktest.equity.length > 0 
            ? enhancedBacktest.equity.map(value => isNaN(value) ? parameters.investment || 1000 : value)
            : [parameters.investment || 1000],
          timestamps: Array.isArray(enhancedBacktest.timestamps) && enhancedBacktest.timestamps.length > 0
            ? enhancedBacktest.timestamps.map(ts => isNaN(ts) ? Date.now() : ts)
            : [Date.now()]
        };
        
        // Add enhanced properties if they exist
        if ('monteCarlo' in enhancedBacktest) {
          sanitizedResults['monteCarlo'] = enhancedBacktest['monteCarlo'];
        }
        
        if ('marketAnalysis' in enhancedBacktest) {
          sanitizedResults['marketAnalysis'] = enhancedBacktest['marketAnalysis'];
        }
        
        // Replace with sanitized results
        enhancedBacktest = sanitizedResults;
        console.log("Enhanced backtest sanitization complete");
        
        // Auto-save enhanced backtest to history if user is authenticated
        if (req.isAuthenticated()) {
          try {
            const now = new Date();
            // Use provided startDate for custom date ranges, or calculate based on period
            const backtestStartDate = period === 'custom' && startDate 
              ? new Date(startDate)
              : new Date(now.getTime() - (period === '1d' ? 24 * 60 * 60 * 1000 : 
                                        period === '7d' ? 7 * 24 * 60 * 60 * 1000 : 
                                        period === '30d' ? 30 * 24 * 60 * 60 * 1000 : 
                                        90 * 24 * 60 * 60 * 1000));
            
            // Format trade data with detailed information for each trade
            const detailedTrades = enhancedBacktest.trades.map(trade => {
              const entryAmount = trade.amount * trade.entryPrice;
              const exitAmount = trade.amount * trade.exitPrice;
              
              return {
                timestamp: trade.timestamp,
                entryPrice: trade.entryPrice,
                exitPrice: trade.exitPrice,
                amount: trade.amount, 
                entryValue: entryAmount,
                exitValue: exitAmount,
                profit: trade.profit,
                profitPercentage: trade.profitPercentage,
                side: trade.side,
                duration: trade.duration,
                durationFormatted: `${Math.floor(trade.duration / (24 * 3600 * 1000))}d ${Math.floor((trade.duration % (24 * 3600 * 1000)) / (3600 * 1000))}h ${Math.floor((trade.duration % (3600 * 1000)) / (60 * 1000))}m`
              };
            });
            
            // Create equity curve data points
            const equityCurve = enhancedBacktest.equity.map((equity, index) => {
              return {
                timestamp: enhancedBacktest.timestamps[index] || Date.now(),
                value: equity
              };
            });
            
            // Use default exchange if not specified (Binance US, ID 13)
            const defaultExchangeId = 13;
            
            // Get exchange information
            const exchange = await storage.getExchangeById(defaultExchangeId);
            
            // Use the exchange name from exchange information, or "binanceus" as fallback
            const exchangeName = exchange ? exchange.name : "binanceus";
            
            await storage.createBacktestHistory({
              userId: req.user.id,
              strategyType: normalizedStrategy,
              tradingPair: pair,
              timeframe: interval || period,
              exchange: exchangeName, // Set the exchange name
              exchangeId: defaultExchangeId, // Use Binance US as default
              startDate: backtestStartDate,
              endDate: endDate ? new Date(endDate) : now,
              initialCapital: parseFloat(String(investmentAmount)),
              finalCapital: parseFloat(String(investmentAmount)) + enhancedBacktest.profit,
              totalProfit: enhancedBacktest.profit,
              profitPercentage: enhancedBacktest.profitPercentage,
              winRate: enhancedBacktest.metrics.winRate,
              totalTrades: enhancedBacktest.metrics.totalTrades,
              winningTrades: enhancedBacktest.metrics.winningTrades,
              losingTrades: enhancedBacktest.metrics.losingTrades,
              maxDrawdown: enhancedBacktest.metrics.maxDrawdown,
              sharpeRatio: enhancedBacktest.metrics.sharpeRatio,
              profitFactor: enhancedBacktest.metrics.profitFactor,
              averageProfit: enhancedBacktest.metrics.averageProfit,
              averageLoss: enhancedBacktest.metrics.averageLoss,
              maxConsecutiveLosses: enhancedBacktest.metrics.maxConsecutiveLosses,
              trades: detailedTrades,
              equityCurve: equityCurve,
              parameters: params,
              metrics: enhancedBacktest.metrics || {} // Add metrics field with fallback
            });
            
            console.log("Enhanced backtest auto-saved to history");
          } catch (saveError) {
            console.error("Error auto-saving enhanced backtest to history:", saveError);
            // Continue sending response even if save fails
          }
        }
      }
      
      res.json(enhancedBacktest);
    } catch (error) {
      console.error("Error running enhanced backtest:", error);
      res.status(500).json({ 
        message: "Failed to run enhanced backtest", 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });
  
  // Parameter sweep backtest
  app.post("/api/backtest/parameter-sweep", async (req, res) => {
    try {
      const { pair, baseParameters, parameterRanges, period, investment, initialInvestment, startDate, endDate } = req.body;
      
      if (!pair || !baseParameters || !parameterRanges) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Get investment amount from multiple possible sources
      const investmentAmount = investment || initialInvestment || baseParameters.investment || baseParameters.initialInvestment || 1000;
      console.log(`Using investment amount for parameter sweep: ${investmentAmount} (sources checked: direct investment, initialInvestment, or from parameters)`);
      
      // Make sure investment is included in the base parameters
      const updatedBaseParameters = {
        ...baseParameters,
        investment: parseFloat(String(investmentAmount))
      };
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for parameter sweep: from ${startDate} to ${endDate}`);
      }

      // Run parameter sweep
      const results = await enhancedBacktestService.runParameterSweep(
        pair, 
        updatedBaseParameters, 
        parameterRanges, 
        period,
        startDate,
        endDate
      );
      
      // Add source identifier to prevent AI analysis
      const resultsWithSource = {
        ...results,
        source: 'parameter-sweep',
        topResults: results.topResults?.map(result => ({
          ...result,
          source: 'parameter-sweep'
        })) || []
      };
      
      res.json(resultsWithSource);
    } catch (error) {
      console.error("Error running parameter sweep:", error);
      res.status(500).json({ 
        message: "Failed to run parameter sweep",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  // Multi-timeframe backtest
  app.post("/api/backtest/multi-timeframe", async (req, res) => {
    try {
      const { pair, parameters, timeframes, investment, initialInvestment, period, startDate, endDate } = req.body;
      
      if (!pair || !parameters) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Get investment amount from multiple possible sources
      const investmentAmount = investment || initialInvestment || parameters.investment || parameters.initialInvestment || 1000;
      console.log(`Using investment amount for multi-timeframe analysis: ${investmentAmount} (sources checked: direct investment, initialInvestment, or from parameters)`);
      
      // Make sure investment is included in the parameters
      const updatedParameters = {
        ...parameters,
        investment: parseFloat(String(investmentAmount))
      };
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for multi-timeframe analysis: from ${startDate} to ${endDate}`);
      }

      // Run multi-timeframe analysis
      const results = await enhancedBacktestService.runMultiTimeframeBacktest(
        pair,
        updatedParameters,
        timeframes,
        period,
        startDate,
        endDate
      );
      
      res.json(results);
    } catch (error) {
      console.error("Error running multi-timeframe backtest:", error);
      res.status(500).json({ message: "Failed to run multi-timeframe backtest" });
    }
  });
  
  // Strategy comparison
  app.post("/api/backtest/compare-strategies", async (req, res) => {
    try {
      const { pair, strategiesConfig, period, startDate, endDate } = req.body;
      
      if (!pair || !strategiesConfig) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for strategy comparison: from ${startDate} to ${endDate}`);
      }
      
      // Run strategy comparison
      const results = await enhancedBacktestService.compareStrategies(
        pair,
        strategiesConfig,
        period,
        startDate,
        endDate
      );
      
      res.json(results);
    } catch (error) {
      console.error("Error comparing strategies:", error);
      res.status(500).json({ message: "Failed to compare strategies" });
    }
  });
  
  // Market condition analysis
  app.post("/api/backtest/market-conditions", async (req, res) => {
    try {
      const { pair, parameters, period, startDate, endDate } = req.body;
      
      if (!pair || !parameters) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for market condition analysis: from ${startDate} to ${endDate}`);
      }
      
      // Run market condition analysis
      const results = await enhancedBacktestService.analyzeMarketConditionImpact(
        pair,
        parameters,
        period,
        startDate,
        endDate
      );
      
      res.json(results);
    } catch (error) {
      console.error("Error analyzing market conditions:", error);
      res.status(500).json({ message: "Failed to analyze market conditions" });
    }
  });
  
  // Walk-forward analysis
  app.post("/api/backtest/walk-forward", async (req, res) => {
    try {
      const { pair, parameters, totalPeriod, folds, startDate, endDate } = req.body;
      
      if (!pair || !parameters) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Log custom date range if provided
      if (totalPeriod === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for walk-forward analysis: from ${startDate} to ${endDate}`);
      }
      
      try {
        // Run walk-forward analysis
        const results = await enhancedBacktestService.runWalkForwardAnalysis(
          pair,
          parameters,
          totalPeriod,
          folds,
          startDate,
          endDate
        );
        
        res.json(results);
      } catch (analysisError) {
        console.error("Error running walk-forward analysis:", analysisError);
        
        // Check if this is a known error about insufficient trades
        if (analysisError.message && analysisError.message.includes("Not enough trades")) {
          // Return a 400 status code with a helpful message
          return res.status(400).json({ 
            message: analysisError.message,
            errorType: "INSUFFICIENT_TRADES",
            requiredTrades: 10,
            actualTrades: analysisError.message.match(/got (\d+)/)?.[1] || 0
          });
        }
        
        // For other errors, rethrow
        throw analysisError;
      }
    } catch (error) {
      console.error("Error running walk-forward analysis:", error);
      res.status(500).json({ 
        message: "Failed to run walk-forward analysis", 
        error: error.message 
      });
    }
  });
  
  // Monte Carlo simulation
  app.post("/api/backtest/monte-carlo", async (req, res) => {
    try {
      const { pair, parameters, period, simulations, investment, initialInvestment, startDate, endDate } = req.body;
      
      if (!pair || !parameters) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Get investment amount from multiple possible sources
      const investmentAmount = investment || initialInvestment || parameters.investment || parameters.initialInvestment || 1000;
      console.log(`Using investment amount for Monte Carlo simulation: ${investmentAmount} (sources checked: direct investment, initialInvestment, or from parameters)`);
      
      // Make sure investment is included in the parameters
      const updatedParameters = {
        ...parameters,
        investment: parseFloat(String(investmentAmount))
      };
      
      // Import the enhancedBacktestService
      const { enhancedBacktestService } = await import("./enhancedBacktestService");
      
      // Log custom date range if provided
      if (period === 'custom' && startDate && endDate) {
        console.log(`Using custom date range for Monte Carlo simulation: from ${startDate} to ${endDate}`);
      }

      // Run Monte Carlo simulation
      const results = await enhancedBacktestService.runMonteCarloSimulation(
        pair,
        updatedParameters,
        period,
        simulations,
        startDate,
        endDate
      );
      
      res.json(results);
    } catch (error) {
      console.error("Error running Monte Carlo simulation:", error);
      res.status(500).json({ message: "Failed to run Monte Carlo simulation" });
    }
  });
  
  // Backtest History routes - for standalone backtests
  app.post("/api/backtest/history", async (req, res) => {
    try {
      if (!req.isAuthenticated()) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      
      const { 
        strategyType, 
        tradingPair, 
        timeframe, 
        exchangeId, 
        startDate, 
        endDate,
        initialCapital, 
        finalCapital, 
        totalProfit, 
        profitPercentage, 
        winRate, 
        totalTrades,
        winningTrades, 
        losingTrades, 
        maxDrawdown, 
        sharpeRatio, 
        profitFactor,
        parameters 
      } = req.body;
      
      // Validate required fields
      if (!strategyType || !tradingPair || !timeframe || !initialCapital) {
        return res.status(400).json({ message: "Missing required parameters" });
      }
      
      // Get exchange information if exchangeId is provided
      let exchangeName = "Unknown";
      if (exchangeId) {
        const exchange = await storage.getExchangeById(exchangeId);
        if (exchange) {
          exchangeName = exchange.name;
        }
      } else {
        // Default to Binance US if no exchange is specified
        const defaultExchange = await storage.getExchangeById(13);
        if (defaultExchange) {
          exchangeName = defaultExchange.name;
        }
      }
      
      // Extract and parse trades from request body
      const { trades = [], equityCurve = [] } = req.body;
      
      // Save the backtest history
      const backtestHistoryData = await storage.createBacktestHistory({
        userId: req.user.id,
        strategyType,
        tradingPair,
        timeframe,
        exchange: exchangeName, // Set the exchange name
        exchangeId: exchangeId || 13, // Use Binance US (ID 13) as default if not specified
        startDate: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Default to 30 days ago
        endDate: endDate ? new Date(endDate) : new Date(), // Default to today
        initialCapital: parseFloat(String(initialCapital)),
        finalCapital: parseFloat(String(finalCapital || initialCapital)),
        totalProfit: parseFloat(String(totalProfit || 0)),
        profitPercentage: parseFloat(String(profitPercentage || 0)),
        winRate: parseFloat(String(winRate || 0)),
        totalTrades: parseInt(String(totalTrades || 0)),
        winningTrades: parseInt(String(winningTrades || 0)),
        losingTrades: parseInt(String(losingTrades || 0)),
        maxDrawdown: parseFloat(String(maxDrawdown || 0)),
        sharpeRatio: parseFloat(String(sharpeRatio || 0)),
        profitFactor: parseFloat(String(profitFactor || 0)),
        // Add trades and equityCurve data - using empty arrays as fallback to avoid null values
        trades: trades || [],
        equityCurve: equityCurve || [],
        parameters: parameters || {},
        metrics: {
          winRate: parseFloat(String(winRate || 0)),
          totalTrades: parseInt(String(totalTrades || 0)),
          winningTrades: parseInt(String(winningTrades || 0)),
          losingTrades: parseInt(String(losingTrades || 0)),
          maxDrawdown: parseFloat(String(maxDrawdown || 0)),
          sharpeRatio: parseFloat(String(sharpeRatio || 0)),
          profitFactor: parseFloat(String(profitFactor || 0))
        } // Add metrics with values from individual fields
      });
      
      res.status(201).json(backtestHistoryData);
    } catch (error) {
      console.error("Error saving backtest history:", error);
      res.status(500).json({ 
        message: "Failed to save backtest history", 
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
  
  app.get("/api/backtest/history", async (req, res) => {
    // Check if the user is authenticated
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    try {
      // Get limit from query params, default to 10
      const limit = req.query.limit ? parseInt(String(req.query.limit)) : 10;
      
      // Get backtest history for the authenticated user
      const history = await storage.getBacktestHistoryByUserId(req.user.id, limit);
      
      // Add exchange names to the response
      const historyWithExchangeNames = await Promise.all(history.map(async (item) => {
        if (item.exchangeId) {
          try {
            const exchange = await storage.getExchangeById(item.exchangeId);
            return {
              ...item,
              exchangeName: exchange ? exchange.name : 'Unknown Exchange'
            };
          } catch (err) {
            console.warn(`Could not find exchange for id ${item.exchangeId}:`, err);
            return {
              ...item,
              exchangeName: 'Unknown Exchange'
            };
          }
        } else {
          return {
            ...item,
            exchangeName: 'No Exchange'
          };
        }
      }));
      
      res.json(historyWithExchangeNames);
    } catch (error) {
      console.error("Error retrieving backtest history:", error);
      res.status(500).json({ message: "Failed to retrieve backtest history" });
    }
  });
  
  // Default Strategy routes
  
  // Get all active default strategies
  app.get("/api/strategies/default", async (req, res) => {
    try {
      const strategies = await storage.getAllDefaultStrategies();
      res.json(strategies);
    } catch (error) {
      console.error("Error fetching default strategies:", error);
      res.status(500).json({ message: "Failed to fetch default strategies" });
    }
  });
  
  // Get default strategies by ID
  app.get("/api/strategies/default/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid strategy ID" });
      }
      
      const strategy = await storage.getDefaultStrategy(id);
      if (!strategy) {
        return res.status(404).json({ message: "Strategy not found" });
      }
      
      res.json(strategy);
    } catch (error) {
      console.error(`Error fetching default strategy with ID ${req.params.id}:`, error);
      res.status(500).json({ message: "Failed to fetch default strategy" });
    }
  });
  
  // Get default strategies by strategy type
  app.get("/api/strategies/default/type/:strategyType", async (req, res) => {
    try {
      const strategyType = req.params.strategyType;
      const strategies = await storage.getDefaultStrategiesByType(strategyType);
      res.json(strategies);
    } catch (error) {
      console.error(`Error fetching default strategies for type ${req.params.strategyType}:`, error);
      res.status(500).json({ message: "Failed to fetch default strategies by type" });
    }
  });
  
  // Get default strategies by category
  app.get("/api/strategies/default/category/:category", async (req, res) => {
    try {
      const category = req.params.category;
      const strategies = await storage.getDefaultStrategiesByCategory(category);
      res.json(strategies);
    } catch (error) {
      console.error(`Error fetching default strategies for category ${req.params.category}:`, error);
      res.status(500).json({ message: "Failed to fetch default strategies by category" });
    }
  });
  
  app.delete("/api/backtest/history/:id", async (req, res) => {
    // Check if the user is authenticated
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    
    try {
      
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid ID format" });
      }
      
      // Get the history entry to verify ownership
      const historyEntry = await storage.getBacktestHistory(id);
      if (!historyEntry) {
        return res.status(404).json({ message: "Backtest history not found" });
      }
      
      // Verify ownership
      if (historyEntry.userId !== req.user.id) {
        return res.status(403).json({ message: "Not authorized to delete this backtest history" });
      }
      
      // Delete the history entry
      const success = await storage.deleteBacktestHistory(id);
      if (!success) {
        return res.status(500).json({ message: "Failed to delete backtest history" });
      }
      
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error deleting backtest history:", error);
      res.status(500).json({ message: "Failed to delete backtest history" });
    }
  });
  
  // Analytics routes
  app.get("/api/analytics", async (req, res) => {
    try {
      // Just return mock analytics data for now to avoid errors
      // A proper implementation would calculate real metrics from the database
      const analyticsData = {
        profitLoss: 0,
        profitLossPercentage: 0,
        winRate: 0,
        totalTrades: 0,
        tradeDistribution: {},
        botPerformance: {}
      };
      
      return res.json(analyticsData);
    } catch (error) {
      console.error("Error fetching analytics:", error);
      return res.status(500).json({ message: "Failed to fetch analytics" });
    }
  });

  // AI Optimization routes
  app.post("/api/bots/:id/optimize", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const bot = await storage.getBot(id);
      if (!bot) {
        return res.status(404).json({ message: "Bot not found" });
      }
      
      // Run AI optimization
      const result = await aiService.optimizeStrategy(id);
      if (!result) {
        return res.status(500).json({ message: "Failed to optimize strategy" });
      }
      
      res.json(result);
    } catch (error) {
      console.error("Error optimizing strategy:", error);
      res.status(500).json({ message: "Failed to optimize strategy" });
    }
  });
  
  // Get optimizations for a bot
  app.get("/api/bots/:id/optimizations", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const optimizations = await storage.getOptimizationResultsByBotId(id);
      res.json(optimizations);
    } catch (error) {
      console.error("Error fetching optimizations:", error);
      res.status(500).json({ message: "Failed to fetch optimizations" });
    }
  });
  
  // Apply an optimization to a bot
  app.post("/api/optimizations/:id/apply", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid optimization ID" });
      }
      
      const success = await aiService.applyOptimization(id);
      if (!success) {
        return res.status(500).json({ message: "Failed to apply optimization" });
      }
      
      res.json({ success: true, message: "Optimization applied successfully" });
    } catch (error) {
      console.error("Error applying optimization:", error);
      res.status(500).json({ message: "Failed to apply optimization" });
    }
  });
  
  // AI Recommendations for a user
  app.post("/api/users/:id/recommendations", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const user = await storage.getUser(id);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const recommendations = await aiService.generateRecommendations(id);
      res.json(recommendations);
    } catch (error) {
      console.error("Error generating recommendations:", error);
      res.status(500).json({ message: "Failed to generate recommendations" });
    }
  });
  
  // Get recommendations for a user
  app.get("/api/users/:id/recommendations", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }
      
      const recommendations = await storage.getAiRecommendationsByUserId(id);
      res.json(recommendations);
    } catch (error) {
      console.error("Error fetching recommendations:", error);
      res.status(500).json({ message: "Failed to fetch recommendations" });
    }
  });
  
  // Update recommendation status
  app.patch("/api/recommendations/:id/status", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid recommendation ID" });
      }
      
      const { status } = req.body;
      if (!status || !["pending", "applied", "rejected"].includes(status)) {
        return res.status(400).json({ message: "Invalid status" });
      }
      
      const updatedRecommendation = await storage.updateAiRecommendationStatus(id, status);
      if (!updatedRecommendation) {
        return res.status(404).json({ message: "Recommendation not found" });
      }
      
      res.json(updatedRecommendation);
    } catch (error) {
      console.error("Error updating recommendation status:", error);
      res.status(500).json({ message: "Failed to update recommendation status" });
    }
  });
  
  // Portfolio routes
  app.get("/api/portfolios", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      const portfolios = await storage.getPortfoliosByUserId(userId);
      res.json(portfolios);
    } catch (error) {
      console.error("Error fetching portfolios:", error);
      res.status(500).json({ message: "Failed to fetch portfolios" });
    }
  });
  
  app.get("/api/portfolios/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid portfolio ID" });
      }
      
      const portfolio = await storage.getPortfolio(id);
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }
      
      res.json(portfolio);
    } catch (error) {
      console.error("Error fetching portfolio:", error);
      res.status(500).json({ message: "Failed to fetch portfolio" });
    }
  });
  
  app.post("/api/portfolios", async (req, res) => {
    try {
      const userId = getCurrentUserId(req);
      
      // Validate request body
      const validatedData = insertPortfolioSchema.parse({
        ...req.body,
        userId
      });
      
      // Create the portfolio
      const portfolio = await storage.createPortfolio(validatedData);
      res.status(201).json(portfolio);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.format() });
      }
      
      console.error("Error creating portfolio:", error);
      res.status(500).json({ message: "Failed to create portfolio" });
    }
  });
  
  app.patch("/api/portfolios/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid portfolio ID" });
      }
      
      const portfolio = await storage.getPortfolio(id);
      if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
      }
      
      // Update the portfolio
      const updatedPortfolio = await storage.updatePortfolio(id, req.body);
      res.json(updatedPortfolio);
    } catch (error) {
      console.error("Error updating portfolio:", error);
      res.status(500).json({ message: "Failed to update portfolio" });
    }
  });
  
  // Portfolio allocation routes
  app.get("/api/portfolios/:id/allocations", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid portfolio ID" });
      }
      
      const allocations = await storage.getPortfolioAllocationsByPortfolioId(id);
      res.json(allocations);
    } catch (error) {
      console.error("Error fetching portfolio allocations:", error);
      res.status(500).json({ message: "Failed to fetch portfolio allocations" });
    }
  });
  
  app.post("/api/portfolio-allocations", async (req, res) => {
    try {
      // Validate request body
      const validatedData = insertPortfolioAllocationSchema.parse(req.body);
      
      // Create the allocation
      const allocation = await storage.createPortfolioAllocation(validatedData);
      res.status(201).json(allocation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request data", errors: error.format() });
      }
      
      console.error("Error creating portfolio allocation:", error);
      res.status(500).json({ message: "Failed to create portfolio allocation" });
    }
  });
  
  app.patch("/api/portfolio-allocations/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid allocation ID" });
      }
      
      const allocation = await storage.getPortfolioAllocation(id);
      if (!allocation) {
        return res.status(404).json({ message: "Portfolio allocation not found" });
      }
      
      // Update the allocation
      const updatedAllocation = await storage.updatePortfolioAllocation(id, req.body);
      res.json(updatedAllocation);
    } catch (error) {
      console.error("Error updating portfolio allocation:", error);
      res.status(500).json({ message: "Failed to update portfolio allocation" });
    }
  });
  
  // Backtest results routes
  app.get("/api/bots/:id/backtest-results", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid bot ID" });
      }
      
      const results = await storage.getBacktestResultsByBotId(id);
      res.json(results);
    } catch (error) {
      console.error("Error fetching backtest results:", error);
      res.status(500).json({ message: "Failed to fetch backtest results" });
    }
  });

  // Test endpoint for fetching current price
  app.get('/api/price-test/:symbol', async (req, res) => {
    try {
      const symbol = req.params.symbol;
      console.log(`Testing price fetching for ${symbol}`);
      
      // Try to get price
      const price = await exchangeService.getCurrentPrice(symbol);
      
      // Send response
      res.json({
        symbol,
        price,
        timestamp: new Date().toISOString(),
        source: price ? 'Real-time' : 'Not available'
      });
    } catch (error) {
      console.error('Error in price test endpoint:', error);
      res.status(500).json({ 
        error: 'Failed to fetch price', 
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Wallet routes
  app.get("/api/wallets", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const wallets = await storage.getWalletsByUserId(userId);
      res.json(wallets);
    } catch (error) {
      console.error("Error fetching wallets:", error);
      res.status(500).json({ error: "Failed to fetch wallets" });
    }
  });

  app.post("/api/wallets", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const validatedData = insertWalletSchema.parse({
        ...req.body,
        userId,
      });
      
      const wallet = await storage.createWallet(validatedData);
      res.status(201).json(wallet);
    } catch (error) {
      console.error("Error creating wallet:", error);
      res.status(500).json({ error: "Failed to create wallet" });
    }
  });

  app.get("/api/wallets/:id", isAuthenticated, async (req, res) => {
    try {
      const walletId = parseInt(req.params.id);
      const userId = req.user!.id;
      
      if (isNaN(walletId)) {
        return res.status(400).json({ error: "Invalid wallet ID" });
      }
      
      const wallet = await storage.getWallet(walletId);
      
      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }
      
      // Check that the wallet belongs to the user
      if (wallet.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      res.json(wallet);
    } catch (error) {
      console.error("Error fetching wallet:", error);
      res.status(500).json({ error: "Failed to fetch wallet" });
    }
  });

  app.put("/api/wallets/:id", isAuthenticated, async (req, res) => {
    try {
      const walletId = parseInt(req.params.id);
      const userId = req.user!.id;
      
      if (isNaN(walletId)) {
        return res.status(400).json({ error: "Invalid wallet ID" });
      }
      
      const wallet = await storage.getWallet(walletId);
      
      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }
      
      // Check that the wallet belongs to the user
      if (wallet.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      const updatedWallet = await storage.updateWallet(walletId, req.body);
      res.json(updatedWallet);
    } catch (error) {
      console.error("Error updating wallet:", error);
      res.status(500).json({ error: "Failed to update wallet" });
    }
  });

  app.delete("/api/wallets/:id", isAuthenticated, async (req, res) => {
    try {
      const walletId = parseInt(req.params.id);
      const userId = req.user!.id;
      
      if (isNaN(walletId)) {
        return res.status(400).json({ error: "Invalid wallet ID" });
      }
      
      const wallet = await storage.getWallet(walletId);
      
      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }
      
      // Check that the wallet belongs to the user
      if (wallet.userId !== userId) {
        return res.status(403).json({ error: "Access denied" });
      }
      
      await storage.deleteWallet(walletId);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting wallet:", error);
      res.status(500).json({ error: "Failed to delete wallet" });
    }
  });

  // Speculation Station API endpoints
  // Get all speculation bots for current user
  app.get("/api/speculation/bots", isAuthenticated, async (req, res) => {
    try {
      const bots = await getUserSpeculationBots(req.user!.id);
      
      // Format date fields for client side
      const formattedBots = bots.map(bot => {
        // Calculate running duration in days, hours, minutes
        const createdAt = new Date(bot.createdAt);
        const now = new Date();
        const diffMs = now.getTime() - createdAt.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        
        let runDuration = "";
        if (diffDays > 0) {
          runDuration += `${diffDays}d `;
        }
        if (diffHours > 0 || diffDays > 0) {
          runDuration += `${diffHours}h `;
        }
        runDuration += `${diffMinutes}m`;
        
        return {
          ...bot,
          createdAt: bot.createdAt.toISOString(),
          updatedAt: bot.updatedAt.toISOString(),
          lastTradeAt: bot.lastTradeAt ? bot.lastTradeAt.toISOString() : null,
          runDuration,
          initialBalance: parseFloat(bot.initialBalance.toString()),
          currentBalance: parseFloat(bot.currentBalance.toString()),
          profitLoss: parseFloat(bot.profitLoss.toString()),
          profitLossPercentage: parseFloat(bot.profitLossPercentage.toString())
        };
      });
      
      res.json(formattedBots);
    } catch (error) {
      console.error("Error retrieving speculation bots:", error);
      res.status(500).json({ error: "Failed to retrieve speculation bots" });
    }
  });

  // Create a new speculation bot
  app.post("/api/speculation/bots", isAuthenticated, async (req, res) => {
    try {
      // Log the raw request body for debugging
      console.log("Creating speculation bot with raw data:", JSON.stringify(req.body));
      
      // Extract and log the required fields
      const { name, strategy, asset, initialBalance, timeframe, parameters, exchangeId } = req.body;
      console.log("Required fields:", { name, strategy, asset, initialBalance, timeframe, parameters, exchangeId });
      
      // Validate the request data and ensure initialBalance and currentBalance are strings
      // Convert any numeric values to strings to match the schema requirements
      const validationData = {
        ...req.body,
        userId: req.user!.id,
        initialBalance: typeof req.body.initialBalance === 'number' 
          ? String(req.body.initialBalance) 
          : req.body.initialBalance,
        currentBalance: typeof req.body.initialBalance === 'number' 
          ? String(req.body.initialBalance) 
          : req.body.initialBalance
      };
      console.log("Validation data:", JSON.stringify(validationData));
      
      const validationResult = insertSpeculationBotSchema.safeParse(validationData);
      
      if (!validationResult.success) {
        console.error("Validation failed:", JSON.stringify(validationResult.error.errors));
        return res.status(400).json({ 
          error: "Invalid bot data", 
          details: validationResult.error.errors 
        });
      }
      
      // Create the bot
      const bot = await createSpeculationBot(validationResult.data);
      
      res.status(201).json({
        ...bot,
        createdAt: bot.createdAt.toISOString(),
        updatedAt: bot.updatedAt.toISOString(),
        initialBalance: parseFloat(bot.initialBalance.toString()),
        currentBalance: parseFloat(bot.currentBalance.toString()),
        profitLoss: parseFloat(bot.profitLoss.toString()),
        profitLossPercentage: parseFloat(bot.profitLossPercentage.toString())
      });
    } catch (error) {
      console.error("Error creating speculation bot:", error);
      res.status(500).json({ error: "Failed to create speculation bot" });
    }
  });

  // Update a speculation bot
  app.patch("/api/speculation/bots/:id", isAuthenticated, async (req, res) => {
    try {
      const botId = parseInt(req.params.id);
      if (isNaN(botId)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }
      
      const userId = req.user!.id;
      const bot = await updateSpeculationBot(botId, userId, req.body);
      res.json(bot);
    } catch (error: any) {
      console.error("Error updating speculation bot:", error);
      res.status(500).json({ error: error.message || "Failed to update speculation bot" });
    }
  });
  
  // Get a specific speculation bot
  app.get("/api/speculation/bots/:id", isAuthenticated, async (req, res) => {
    try {
      const botId = parseInt(req.params.id);
      if (isNaN(botId)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }
      
      const bot = await getSpeculationBot(botId);
      if (!bot || bot.userId !== req.user!.id) {
        return res.status(404).json({ error: "Speculation bot not found" });
      }
      
      res.json({
        ...bot,
        createdAt: bot.createdAt.toISOString(),
        updatedAt: bot.updatedAt.toISOString(),
        lastTradeAt: bot.lastTradeAt ? bot.lastTradeAt.toISOString() : null,
        initialBalance: parseFloat(bot.initialBalance.toString()),
        currentBalance: parseFloat(bot.currentBalance.toString()),
        profitLoss: parseFloat(bot.profitLoss.toString()),
        profitLossPercentage: parseFloat(bot.profitLossPercentage.toString())
      });
    } catch (error) {
      console.error("Error retrieving speculation bot:", error);
      res.status(500).json({ error: "Failed to retrieve speculation bot" });
    }
  });

  // Start, pause or stop a speculation bot
  app.post("/api/speculation/bots/:id/:action", isAuthenticated, async (req, res) => {
    try {
      const botId = parseInt(req.params.id);
      if (isNaN(botId)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }
      
      const action = req.params.action;
      if (!["start", "pause", "stop"].includes(action)) {
        return res.status(400).json({ error: "Invalid action. Must be 'start', 'pause', or 'stop'." });
      }
      
      // Map action to status
      const statusMap: Record<string, "active" | "paused" | "stopped"> = {
        start: "active",
        pause: "paused",
        stop: "stopped"
      };
      
      const updatedBot = await updateBotStatus(botId, req.user!.id, statusMap[action]);
      
      res.json({
        ...updatedBot,
        createdAt: updatedBot.createdAt.toISOString(),
        updatedAt: updatedBot.updatedAt.toISOString(),
        lastTradeAt: updatedBot.lastTradeAt ? updatedBot.lastTradeAt.toISOString() : null,
        initialBalance: parseFloat(updatedBot.initialBalance.toString()),
        currentBalance: parseFloat(updatedBot.currentBalance.toString()),
        profitLoss: parseFloat(updatedBot.profitLoss.toString()),
        profitLossPercentage: parseFloat(updatedBot.profitLossPercentage.toString())
      });
    } catch (error) {
      console.error(`Error ${req.params.action}ing speculation bot:`, error);
      res.status(500).json({ error: `Failed to ${req.params.action} speculation bot` });
    }
  });

  // Delete a speculation bot
  app.delete("/api/speculation/bots/:id", isAuthenticated, async (req, res) => {
    try {
      const botId = parseInt(req.params.id);
      if (isNaN(botId)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }
      
      await deleteSpeculationBot(botId, req.user!.id);
      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Error deleting speculation bot:", error);
      res.status(500).json({ error: "Failed to delete speculation bot" });
    }
  });

  // Get trades for a speculation bot
  app.get("/api/speculation/bots/:id/trades", isAuthenticated, async (req, res) => {
    try {
      const botId = parseInt(req.params.id);
      if (isNaN(botId)) {
        return res.status(400).json({ error: "Invalid bot ID" });
      }
      
      const trades = await getBotTrades(botId, req.user!.id);
      
      // Format trades for client
      const formattedTrades = trades.map(trade => ({
        ...trade,
        executedAt: trade.executedAt.toISOString(),
        price: parseFloat(trade.price.toString()),
        amount: parseFloat(trade.amount.toString()),
        total: parseFloat(trade.total.toString()),
        fee: parseFloat(trade.fee.toString()),
        profitLoss: trade.profitLoss ? parseFloat(trade.profitLoss.toString()) : null,
        profitLossPercentage: trade.profitLossPercentage ? parseFloat(trade.profitLossPercentage.toString()) : null
      }));
      
      res.json(formattedTrades);
    } catch (error) {
      console.error("Error retrieving speculation bot trades:", error);
      res.status(500).json({ error: "Failed to retrieve speculation bot trades" });
    }
  });

  // Get all trades for all of a user's speculation bots
  app.get("/api/speculation/trades", isAuthenticated, async (req, res) => {
    try {
      const trades = await getUserTrades(req.user!.id);
      
      // Format trades for client
      const formattedTrades = trades.map(trade => ({
        ...trade,
        executedAt: trade.executedAt.toISOString(),
        price: parseFloat(trade.price.toString()),
        amount: parseFloat(trade.amount.toString()),
        total: parseFloat(trade.total.toString()),
        fee: parseFloat(trade.fee.toString()),
        profitLoss: trade.profitLoss ? parseFloat(trade.profitLoss.toString()) : null,
        profitLossPercentage: trade.profitLossPercentage ? parseFloat(trade.profitLossPercentage.toString()) : null
      }));
      
      res.json(formattedTrades);
    } catch (error) {
      console.error("Error retrieving user speculation trades:", error);
      res.status(500).json({ error: "Failed to retrieve user speculation trades" });
    }
  });
  
  // Clear all trades for a user's speculation bots
  app.post("/api/speculation/clear-trades", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user!.id;
      const result = await clearAllUserTrades(userId);
      res.json(result);
    } catch (error) {
      console.error("Error clearing user trades:", error);
      res.status(500).json({ error: "Failed to clear trades" });
    }
  });

  return httpServer;
}
