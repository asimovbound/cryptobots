import { GoogleGenerativeAI } from '@google/generative-ai';
import { BacktestResult } from './backtestService';
import OpenAI from 'openai';
import fetch from 'node-fetch';
import http from 'http';
import https from 'https';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Define supported AI providers
export enum AiProvider {
  GEMINI = 'gemini',
  OPENAI = 'openai',
  OPENROUTER = 'openrouter',
  OLLAMA = 'ollama'
}

// Interface for analysis context
export interface AnalysisContext {
  strategyType: string;
  strategyParams: any;
  marketCondition: string;
  profitPercentage: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  avgDuration: number;
  avgWin: number;
  avgLoss: number;
  losingTradeExamples: Array<{
    entryPrice: number;
    exitPrice: number;
    profitPercentage: number;
    timestamp: string;
  }>;
}

// Interface for backtest diagnostics
export interface BacktestDiagnostics {
  summary: string;
  performanceIssues: string[];
  recommendations: Array<{
    id: number;
    title: string;
    description: string;
    expectedImprovement: string;
    confidence: string;
    implementationSteps: string[];
    parameters?: Record<string, any>;
  }>;
}

/**
 * Service for AI-powered diagnostics and recommendations
 */
export class AiDiagnosticsService {
  private genAI: GoogleGenerativeAI | null = null;
  private openai: OpenAI | null = null;
  private defaultProvider: AiProvider = AiProvider.GEMINI;
  private ollamaEndpoint: string = 'http://localhost:11434/api/generate';
  
  // Define models for each provider
  // Default models for each provider
  private models = {
    [AiProvider.GEMINI]: 'gemini-1.5-pro',  // Using 1.5 Pro as default (has free tier)
    [AiProvider.OPENAI]: 'gpt-4o',
    [AiProvider.OPENROUTER]: 'anthropic/claude-3-opus',
    [AiProvider.OLLAMA]: 'llama3.2:1b'
  };
  
  // Proxy settings
  private useProxy: boolean = false;
  private proxyUrl: string | null = null;
  
  // Available models for each provider
  private availableModels = {
    [AiProvider.GEMINI]: [
      { id: 'gemini-2.5-pro-preview-03-25', name: 'Gemini 2.5 Pro (Premium)' },
      { id: 'gemini-2.5-pro-exp-03-25', name: 'Gemini 2.5 Pro Experimental (Free)' },
      { id: 'gemini-2.5-flash-preview-04-17', name: 'Gemini 2.5 Pro Flash' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
    ],
    [AiProvider.OPENAI]: [
      { id: 'gpt-4o', name: 'GPT-4o (April 2024)' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' }
    ],
    [AiProvider.OPENROUTER]: [
      { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus' },
      { id: 'anthropic/claude-3-sonnet', name: 'Claude 3 Sonnet' },
      { id: 'anthropic/claude-3-haiku', name: 'Claude 3 Haiku' },
      { id: 'meta-llama/llama-3-70b-instruct', name: 'Llama 3 70B' }
    ],
    [AiProvider.OLLAMA]: []  // Will be populated dynamically
  };
  
  constructor() {
    // Initialize APIs based on available keys
    this.initializeClients();
  }
  
  private initializeClients() {
    // Initialize Google Generative AI with API key
    const geminiApiKey = process.env.GEMINI_API_KEY;
    
    // Check if we should use a proxy
    this.proxyUrl = process.env.HTTP_PROXY || process.env.HTTPS_PROXY || null;
    this.useProxy = !!this.proxyUrl;
    
    if (this.useProxy) {
      console.log(`Using proxy for API requests: ${this.proxyUrl}`);
    }
    
    if (geminiApiKey) {
      // Create the Google Generative AI client with optional proxy
      let options = {};
      
      // If using proxy, configure with HttpsProxyAgent
      if (this.useProxy && this.proxyUrl) {
        const agent = new HttpsProxyAgent(this.proxyUrl);
        options = { 
          httpAgent: agent,
          httpsAgent: agent
        };
      }
      
      this.genAI = new GoogleGenerativeAI(geminiApiKey, options);
    } else {
      console.warn('GEMINI_API_KEY is not set, Gemini provider will not be available');
    }
    
    // Initialize OpenAI with API key if available
    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (openaiApiKey) {
      // Configure OpenAI with proxy if needed
      const config: any = { apiKey: openaiApiKey };
      
      if (this.useProxy && this.proxyUrl) {
        const agent = new HttpsProxyAgent(this.proxyUrl);
        config.httpAgent = agent;
        config.httpsAgent = agent;
      }
      
      this.openai = new OpenAI(config);
    } else {
      console.warn('OPENAI_API_KEY is not set, OpenAI provider will not be available');
    }
    
    // Check OpenRouter API key
    const openrouterApiKey = process.env.OPENROUTER_API_KEY;
    if (!openrouterApiKey) {
      console.warn('OPENROUTER_API_KEY is not set, OpenRouter provider will not be available');
    }
  }
  
  // Cache the result of the Ollama check to avoid too many requests
  private ollamaAvailable: boolean | null = null;
  private lastOllamaCheck: number = 0;
  
  /**
   * Check if Ollama is available by testing the connection
   * @returns Promise that resolves to true if Ollama is available, false otherwise
   */
  private async isOllamaAvailable(): Promise<boolean> {
    // If we checked recently, use the cached result
    const now = Date.now();
    if (this.ollamaAvailable !== null && (now - this.lastOllamaCheck) < 60000) { // Cache for 1 minute
      return this.ollamaAvailable;
    }
    
    try {
      const response = await fetch(`${this.ollamaEndpoint.replace('/generate', '/tags')}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(2000) // 2 second timeout
      });
      
      this.ollamaAvailable = response.ok;
      this.lastOllamaCheck = now;
      
      console.log(`Ollama service check: ${this.ollamaAvailable ? 'AVAILABLE' : 'NOT AVAILABLE'}`);
      return this.ollamaAvailable;
    } catch (error) {
      console.log('Ollama service check failed:', error);
      this.ollamaAvailable = false;
      this.lastOllamaCheck = now;
      return false;
    }
  }
  
  /**
   * Get list of available AI providers
   */
  async getAvailableProviders(): Promise<{ id: string, name: string, available: boolean }[]> {
    const ollamaStatus = await this.isOllamaAvailable();
    
    return [
      { 
        id: AiProvider.GEMINI, 
        name: 'Google Gemini', 
        available: !!this.genAI 
      },
      { 
        id: AiProvider.OPENAI, 
        name: 'OpenAI', 
        available: !!this.openai 
      },
      { 
        id: AiProvider.OPENROUTER, 
        name: 'OpenRouter', 
        available: !!process.env.OPENROUTER_API_KEY 
      },
      { 
        id: AiProvider.OLLAMA, 
        name: 'Ollama (Phi4-Mini)', 
        available: ollamaStatus
      }
    ];
  }
  
  /**
   * Get available models for a specific provider
   * @param provider The AI provider to get models for
   * @returns Array of available model objects with id and name
   */
  async getModelsForProvider(provider: AiProvider): Promise<Array<{ id: string, name: string }>> {
    try {
      // For Gemini, try to fetch models dynamically using the API
      if (provider === AiProvider.GEMINI && this.genAI) {
        try {
          console.log('Attempting to fetch available Gemini models...');
          
          // Add all Gemini models with correct preview IDs as provided by the user
          const enhancedModels = [
            { id: 'gemini-2.5-pro-preview-03-25', name: 'Gemini 2.5 Pro (Premium)' },
            { id: 'gemini-2.5-pro-exp-03-25', name: 'Gemini 2.5 Pro Experimental (Free)' },
            { id: 'gemini-2.5-flash-preview-04-17', name: 'Gemini 2.5 Pro Flash' },
            { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
            { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
            { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' }
          ];
          
          // Set the updated model list
          this.availableModels[provider] = enhancedModels;
          
          // Update the default model to use Gemini 2.5 Pro if available
          if (!this.models[provider] || this.models[provider] === 'gemini-pro') {
            this.models[provider] = 'gemini-1.5-pro';
            console.log('Updated default Gemini model to gemini-1.5-pro');
          }
        } catch (error) {
          console.warn('Failed to fetch Gemini models, using predefined list:', error);
          // Keep using the predefined list in this.availableModels[provider]
        }
      }
      
      // For Ollama, check if it's available and query for all available models
      if (provider === AiProvider.OLLAMA) {
        try {
          // Check if Ollama is available
          const isAvailable = await this.isOllamaAvailable();
          
          if (isAvailable) {
            // If Ollama is available, fetch all available models
            try {
              console.log('Fetching available Ollama models...');
              const response = await fetch('http://localhost:11434/api/tags', {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(3000) // 3 second timeout
              });
              
              if (response.ok) {
                const data = await response.json() as any;
                
                if (data.models && Array.isArray(data.models)) {
                  // Update Ollama models list with all available models
                  this.availableModels[provider] = data.models.map((model: any) => ({
                    id: model.name,
                    name: model.name.charAt(0).toUpperCase() + model.name.slice(1)
                  }));
                  
                  console.log(`Found ${this.availableModels[provider].length} available Ollama models`);
                  
                  // If phi is available, set it as the default model
                  const hasPhi = this.availableModels[provider].some(model => model.id === 'phi');
                  if (hasPhi && this.models[provider] !== 'phi') {
                    this.models[provider] = 'phi';
                    console.log('Set Phi model as default for Ollama');
                  }
                  // If no models found, set empty array
                  if (this.availableModels[provider].length === 0) {
                    console.log('No Ollama models found');
                    this.availableModels[provider] = [];
                  }
                } else {
                  console.warn('Invalid response format from Ollama API');
                  this.availableModels[provider] = [];
                }
              } else {
                console.warn(`Error fetching Ollama models: ${response.status} ${response.statusText}`);
                this.availableModels[provider] = [];
              }
            } catch (fetchError) {
              console.warn('Error fetching Ollama models:', fetchError);
              this.availableModels[provider] = [];
            }
          } else {
            // If Ollama is not available, clear the models list
            this.availableModels[provider] = [];
            console.log('Ollama service is not available, no models will be shown');
          }
        } catch (error) {
          console.warn('Failed to check Ollama service:', error);
          this.availableModels[provider] = [];
        }
      }
      
      return this.availableModels[provider] || [];
    } catch (error) {
      console.error(`Error getting models for provider ${provider}:`, error);
      return [];
    }
  }
  
  /**
   * Analyze a backtest result and provide recommendations for improvement
   * @param result The backtest result to analyze
   * @param strategyParams The parameters used for the strategy
   * @param marketCondition Additional market condition context
   * @param provider Optional AI provider to use
   */
  async analyzeBacktest(
    result: BacktestResult, 
    strategyType: string,
    strategyParams: any,
    marketCondition: string = 'unknown',
    provider: AiProvider = this.defaultProvider
  ): Promise<BacktestDiagnostics> {
    try {
      // Prepare the analysis context
      const context = this.prepareAnalysisContext(result, strategyType, strategyParams, marketCondition);
      const prompt = this.generateAnalysisPrompt(context);
      
      let responseText: string = '';
      
      // Use the appropriate provider
      switch(provider) {
        case AiProvider.GEMINI:
          responseText = await this.analyzeWithGemini(prompt);
          break;
        case AiProvider.OPENAI:
          responseText = await this.analyzeWithOpenAI(prompt);
          break;
        case AiProvider.OPENROUTER:
          responseText = await this.analyzeWithOpenRouter(prompt);
          break;
        case AiProvider.OLLAMA:
          responseText = await this.analyzeWithOllama(prompt);
          break;
        default:
          throw new Error(`Unsupported AI provider: ${provider}`);
      }
      
      // Parse the response
      const diagnostics = await this.parseAiResponse(responseText);
      return diagnostics;
      
    } catch (error: any) {
      console.error(`Error analyzing backtest with ${provider}:`, error);
      
      // Try fallback provider if primary fails
      if (provider === this.defaultProvider) {
        const fallbackProviders = Object.values(AiProvider).filter(p => 
          p !== provider && this.isProviderAvailable(p as AiProvider)
        );
        
        if (fallbackProviders.length > 0) {
          console.log(`Attempting with fallback provider: ${fallbackProviders[0]}`);
          return this.analyzeBacktest(
            result, 
            strategyType, 
            strategyParams, 
            marketCondition, 
            fallbackProviders[0] as AiProvider
          );
        }
      }
      
      // If all fails, return a graceful error response
      return {
        summary: 'AI analysis failed',
        performanceIssues: ['Could not analyze due to an error'],
        recommendations: [{
          id: 1,
          title: 'Try again later',
          description: `Error analyzing backtest: ${error.message || 'Unknown error'}`,
          expectedImprovement: 'Unknown',
          confidence: 'Low',
          implementationSteps: ['Please try again later or select a different AI provider.']
        }]
      };
    }
  }
  
  /**
   * Check if a provider is available
   */
  private async isProviderAvailable(provider: AiProvider): Promise<boolean> {
    switch(provider) {
      case AiProvider.GEMINI:
        return !!this.genAI;
      case AiProvider.OPENAI:
        return !!this.openai;
      case AiProvider.OPENROUTER:
        return !!process.env.OPENROUTER_API_KEY;
      case AiProvider.OLLAMA:
        // Check if Ollama is actually available by testing connection
        return await this.isOllamaAvailable();
      default:
        return false;
    }
  }
  
  /**
   * Set model for a specific provider
   * @param provider The AI provider to set model for
   * @param modelId The model ID to use
   * @returns Boolean indicating success
   */
  async setModelForProvider(provider: AiProvider, modelId: string): Promise<boolean> {
    try {
      // First check if the provider is available
      const isAvailable = await this.isProviderAvailable(provider);
      if (!isAvailable) {
        console.warn(`Provider ${provider} is not available`);
        return false;
      }
      
      // Check if the modelId exists in the available models for this provider
      const models = this.availableModels[provider];
      
      if (!models || models.length === 0) {
        console.warn(`No models available for provider ${provider}`);
        return false;
      }
      
      const modelExists = models.some(model => model.id === modelId);
      
      if (modelExists) {
        // Log the model change
        console.log(`Changing ${provider} model from ${this.models[provider]} to ${modelId}`);
        this.models[provider] = modelId;
        return true;
      } else {
        // List available models for debugging
        const availableModelIds = models.map(m => m.id).join(', ');
        console.warn(`Model ${modelId} not found for provider ${provider}. Available models: ${availableModelIds}`);
        return false;
      }
    } catch (error) {
      console.error(`Error setting model for provider ${provider}:`, error);
      return false;
    }
  }
  
  /**
   * Get the currently set model for a provider
   * @param provider The AI provider
   * @returns Current model ID
   */
  getModelForProvider(provider: AiProvider): string {
    return this.models[provider];
  }
  
  /**
   * Analyze with Google Gemini
   */
  private async analyzeWithGemini(prompt: string): Promise<string> {
    if (!this.genAI) {
      throw new Error('Gemini API not initialized');
    }
    
    // Create a generative model instance with the configured model name
    const modelName = this.models[AiProvider.GEMINI];
    console.log(`Using Gemini model: ${modelName}`);
    
    // Maximum number of retries for rate limiting
    const maxRetries = 3;
    let retryCount = 0;
    let retryDelay = 2000; // Start with 2 seconds delay
    
    // Create structured prompt with clear JSON output expectations
    const structuredPrompt = `
As a cryptocurrency trading bot strategy analyst, provide a detailed analysis in JSON format.

${prompt}

Respond with valid JSON matching this structure exactly:
{
  "summary": "Concise summary of the strategy's performance",
  "performanceIssues": ["Issue 1", "Issue 2", "Issue 3"],
  "recommendations": [
    {
      "id": 1,
      "title": "Title of recommendation",
      "description": "Detailed explanation",
      "expectedImprovement": "Expected improvement",
      "confidence": "high/medium/low",
      "implementationSteps": ["Step 1", "Step 2"],
      "parameters": {
        "param1": "value1",
        "param2": "value2"
      }
    }
  ]
}
`;
    
    // Keep trying until we succeed or exhaust retries
    while (retryCount <= maxRetries) {
      try {
        // If we've failed before due to rate limiting on premium models, 
        // switch to experimental model which has free quota
        let currentModelName = modelName;
        if (retryCount > 0 && modelName === 'gemini-2.5-pro-preview-03-25') {
          // Switch to the experimental version that has free quota
          currentModelName = 'gemini-2.5-pro-exp-03-25';
          console.log(`Rate limited. Retrying with free tier model: ${currentModelName}`);
        } else if (retryCount > 1) {
          // If still failing, try the older stable model
          currentModelName = 'gemini-1.5-pro';
          console.log(`Still rate limited. Falling back to: ${currentModelName}`);
        }
        
        // Configure the model with appropriate safety settings
        const model = this.genAI.getGenerativeModel({ 
          model: currentModelName,
          generationConfig: {
            temperature: 0.2,
            topK: 40,
            topP: 0.95,
            maxOutputTokens: 4096,
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            },
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_MEDIUM_AND_ABOVE"
            }
          ]
        });
        
        // Get the response from Gemini
        const response = await model.generateContent(structuredPrompt);
        return response.response.text();
        
      } catch (error: any) {
        console.error(`Gemini API error (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);
        
        // Check for specific error types
        if (error.message) {
          // Check for rate limit error (429)
          if (error.message.includes('429') || error.message.includes('Too Many Requests')) {
            retryCount++;
            
            // Extract retry delay if available in the error
            let waitTime = retryDelay;
            if (error.message.includes('retryDelay')) {
              const match = error.message.match(/retryDelay":"([^"]+)"/);
              if (match && match[1]) {
                const delay = match[1].replace('s', '');
                waitTime = parseInt(delay, 10) * 1000;
              }
            }
            
            if (retryCount <= maxRetries) {
              console.log(`Rate limited. Waiting ${waitTime/1000}s before retry #${retryCount}...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
              // Exponential backoff for next attempt
              retryDelay *= 2;
              continue;
            }
          }
          
          // Handle case where model doesn't exist
          if (error.message.includes('404')) {
            console.error(`Model ${modelName} not found. Falling back to gemini-1.5-pro`);
            
            // Try again with a known working model
            const fallbackModel = this.genAI.getGenerativeModel({ 
              model: 'gemini-1.5-pro',
              generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 4096,
              }
            });
            
            const response = await fallbackModel.generateContent(prompt);
            return response.response.text();
          }
        }
        
        // If we've exhausted retries or it's not a retryable error, rethrow
        throw error;
      }
    }
    
    // If we've exhausted all retries
    throw new Error(`Failed to get response from Gemini API after ${maxRetries + 1} attempts`);
  }
  
  /**
   * Analyze with OpenAI
   */
  private async analyzeWithOpenAI(prompt: string): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI API not initialized');
    }
    
    const modelName = this.models[AiProvider.OPENAI];
    console.log(`Using OpenAI model: ${modelName}`);
    
    const completion = await this.openai.chat.completions.create({
      model: modelName,
      messages: [
        { role: 'system', content: 'You are an expert cryptocurrency trading bot strategy analyst.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.3,
    });
    
    return completion.choices[0].message.content || '';
  }
  
  /**
   * Analyze with OpenRouter
   */
  private async analyzeWithOpenRouter(prompt: string): Promise<string> {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OpenRouter API key not found');
    }
    
    const modelName = this.models[AiProvider.OPENROUTER];
    console.log(`Using OpenRouter model: ${modelName}`);
    
    // Prepare fetch options with proxy if configured
    const fetchOptions: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://crypto-trading-platform.replit.app'
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: 'You are an expert cryptocurrency trading bot strategy analyst.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3
      })
    };
    
    // Add proxy agent if proxy is configured
    if (this.useProxy && this.proxyUrl) {
      console.log(`Using proxy for OpenRouter API request: ${this.proxyUrl}`);
      const agent = new HttpsProxyAgent(this.proxyUrl);
      fetchOptions.agent = agent;
    }
    
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', fetchOptions);
    
    // Handle rate limiting (429) with exponential backoff
    if (response.status === 429) {
      console.warn('OpenRouter rate limit exceeded. Retrying after delay...');
      
      // Get retry-after header or default to 5 seconds
      const retryAfter = parseInt(response.headers.get('retry-after') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      
      // Retry the request
      return this.analyzeWithOpenRouter(prompt);
    }
    
    const data = await response.json() as any;
    return data.choices[0].message.content || '';
  }
  
  /**
   * Analyze with Ollama (local)
   */
  private async analyzeWithOllama(prompt: string): Promise<string> {
    try {
      // Create a more structured prompt for Ollama that explicitly requests JSON output
      const structuredPrompt = `
You are an expert cryptocurrency trading bot strategy analyst. 

I need your analysis in a specific JSON format with the following structure:
{
  "summary": "A concise summary of the strategy's performance",
  "performanceIssues": ["Issue 1", "Issue 2", "Issue 3"],
  "recommendations": [
    {
      "id": 1,
      "title": "Title of recommendation",
      "description": "Detailed explanation",
      "expectedImprovement": "Expected improvement",
      "confidence": "high/medium/low",
      "implementationSteps": ["Step 1", "Step 2"],
      "parameters": { 
        // Optional parameters that should be adjusted
      }
    }
  ]
}

${prompt}

Remember to format your entire response as valid JSON following the structure above.
`;

      // Maximum number of retries
      const maxRetries = 2;
      let retryCount = 0;
      let lastError: Error | null = null;
      
      while (retryCount <= maxRetries) {
        try {
          const modelName = this.models[AiProvider.OLLAMA];
          console.log(`Using Ollama model: ${modelName}`);
          
          // Prepare request options
          const fetchOptions: RequestInit = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: modelName,
              prompt: structuredPrompt,
              stream: false,
              options: {
                temperature: 0.3
              }
            })
          };
          
          const response = await fetch(this.ollamaEndpoint, fetchOptions);
          
          if (!response.ok) {
            const errorMessage = `Ollama API returned status ${response.status}: ${response.statusText}`;
            console.warn(errorMessage);
            
            if (response.status === 404) {
              // Model not found, try with the other available model
              console.log('Model not found. Trying with phi4-mini model instead.');
              this.models[AiProvider.OLLAMA] = 'phi4-mini:latest';
              retryCount++;
              continue;
            }
            
            throw new Error(errorMessage);
          }
          
          const data = await response.json() as any;
          return data.response || '';
        } catch (error: any) {
          lastError = error;
          console.error(`Error calling Ollama (attempt ${retryCount + 1}/${maxRetries + 1}):`, error.message);
          
          // Increase retry count and wait before retrying
          retryCount++;
          if (retryCount <= maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            continue;
          }
          
          // All retries exhausted, throw the last error
          break;
        }
      }
      
      throw lastError || new Error('Failed to connect to Ollama after multiple attempts');
    } catch (error) {
      console.error('Error calling Ollama:', error);
      throw new Error('Failed to connect to Ollama. Make sure Ollama is running locally.');
    }
  }
  
  /**
   * Prepare the context for AI analysis
   */
  private prepareAnalysisContext(
    result: BacktestResult,
    strategyType: string,
    strategyParams: any,
    marketCondition: string
  ): AnalysisContext {
    // Extract key metrics
    const totalTrades = result.metrics.totalTrades;
    const winRate = result.metrics.winRate;
    const profitFactor = result.metrics.profitFactor || 0;
    const maxDrawdown = result.metrics.maxDrawdown;
    const profitPercentage = result.profitPercentage;
    
    // Calculate average trade duration
    const avgDuration = result.trades.length > 0 
      ? result.trades.reduce((sum, trade) => sum + trade.duration, 0) / result.trades.length / (1000 * 60 * 60 * 24) // convert to days
      : 0;
    
    // Calculate win/loss stats
    const winningTrades = result.trades.filter(t => t.profit > 0);
    const losingTrades = result.trades.filter(t => t.profit <= 0);
    const avgWin = winningTrades.length > 0 
      ? winningTrades.reduce((sum, trade) => sum + trade.profitPercentage, 0) / winningTrades.length 
      : 0;
    const avgLoss = losingTrades.length > 0 
      ? losingTrades.reduce((sum, trade) => sum + trade.profitPercentage, 0) / losingTrades.length 
      : 0;
    
    // Prepare detailed examples of losing trades
    const losingTradeExamples = losingTrades.slice(0, 3).map(trade => ({
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice,
      profitPercentage: trade.profitPercentage,
      timestamp: new Date(trade.timestamp).toISOString().split('T')[0]
    }));
    
    return {
      strategyType,
      strategyParams,
      marketCondition,
      profitPercentage,
      totalTrades,
      winRate,
      profitFactor,
      maxDrawdown,
      avgDuration,
      avgWin,
      avgLoss,
      losingTradeExamples
    };
  }
  
  /**
   * Generate a prompt for AI analysis
   */
  private generateAnalysisPrompt(context: AnalysisContext): string {
    // Get strategy specific guidance
    const strategyGuidance = this.getStrategySpecificGuidance(context.strategyType);
    
    return `
You are an expert cryptocurrency trading bot strategy analyst. Analyze the following backtest result and provide detailed diagnostic recommendations to improve performance.

## Backtest Summary
- Strategy Type: ${context.strategyType}
- Strategy Parameters: ${JSON.stringify(context.strategyParams, null, 2)}
- Market Condition: ${context.marketCondition}
- Overall Profit/Loss: ${context.profitPercentage.toFixed(2)}%
- Total Trades: ${context.totalTrades}
- Win Rate: ${context.winRate.toFixed(2)}%
- Profit Factor: ${context.profitFactor.toFixed(2)}
- Maximum Drawdown: ${context.maxDrawdown.toFixed(2)}%
- Average Trade Duration: ${context.avgDuration.toFixed(2)} days
- Average Win: ${context.avgWin.toFixed(2)}%
- Average Loss: ${context.avgLoss.toFixed(2)}%

## Strategy-Specific Information
${strategyGuidance}

## Example Losing Trades
${context.losingTradeExamples.map((trade, index) => 
  `Trade ${index + 1}: Entry $${trade.entryPrice}, Exit $${trade.exitPrice}, P/L: ${trade.profitPercentage.toFixed(2)}%, Date: ${trade.timestamp}`
).join('\n')}

## Instructions
1. Provide a succinct summary of the backtest performance, identifying key strengths and weaknesses.
2. List the most critical performance issues in order of importance.
3. Provide 3-5 specific, actionable recommendations to improve the strategy. For each recommendation:
   a. Give it a short, descriptive title
   b. Provide a detailed description of the change to make
   c. Estimate the expected improvement (Low/Medium/High)
   d. Indicate your confidence in the recommendation (Low/Medium/High)
   e. List specific implementation steps
4. Focus on parameter adjustments, entry/exit criteria modifications, risk management improvements, and any other potential optimizations.
5. Consider the market condition in your analysis if provided.

Format your response in JSON with the following structure:
{
  "summary": "Brief analysis of the backtest result",
  "performanceIssues": ["Issue 1", "Issue 2", ...],
  "recommendations": [
    {
      "id": 1,
      "title": "Short title",
      "description": "Detailed description",
      "expectedImprovement": "Low/Medium/High",
      "confidence": "Low/Medium/High",
      "implementationSteps": ["Step 1", "Step 2", ...],
      "parameters": {
        "param1": "newValue1",
        "param2": "newValue2",
        "nestedParam.subParam": "newValue3"
      }
    }
  ]
}`;
  }
  
  /**
   * Parse AI response into structured format
   */
  private async parseAiResponse(responseText: string): Promise<BacktestDiagnostics> {
    try {
      // Special handling for Ollama responses that may not include proper JSON
      if (responseText.length > 0 && 
          !responseText.includes('{') && 
          !responseText.includes('[') &&
          !responseText.includes('```')) {
        console.log('Response appears to be non-JSON text from Ollama. Creating structured response.');
        
        // Extract what appears to be a summary from the text
        const summaryText = responseText.split('.')[0] + '.';
        
        // Create a structured response with the text
        return {
          summary: summaryText || "Analysis provided by Ollama (text format)",
          performanceIssues: ["Ollama response was not in JSON format"],
          recommendations: [{
            id: 1,
            title: "Ollama Response (Text Format)",
            description: responseText,
            expectedImprovement: "Unknown",
            confidence: "Low",
            implementationSteps: ["Try running the analysis with a different AI provider for structured recommendations."]
          }]
        };
      }
      
      // First, check if there's a code block with JSON (multiple formats possible)
      let jsonStr = '';
      
      // Try JSON code block format
      const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
      let codeBlockMatch = responseText.match(jsonRegex);
      if (codeBlockMatch && codeBlockMatch[1]) {
        jsonStr = codeBlockMatch[1];
      } 
      // Try generic code block that might contain JSON
      else {
        const genericRegex = /```\s*([\s\S]*?)\s*```/;
        codeBlockMatch = responseText.match(genericRegex);
        if (codeBlockMatch && codeBlockMatch[1] && codeBlockMatch[1].trim().startsWith('{')) {
          jsonStr = codeBlockMatch[1];
        }
        // Try to extract JSON from response (in case AI included other text)
        else {
          const jsonMatch = responseText.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            console.warn('No JSON found in AI response. Raw response:', responseText);
            
            // If it's a substantial text response but not JSON, create a structured format from it
            if (responseText.length > 50) {
              // Break into paragraphs
              const paragraphs = responseText.split('\n\n').filter(p => p.trim().length > 0);
              
              // Use first paragraph as summary
              const summary = paragraphs.length > 0 ? 
                paragraphs[0].substring(0, 200) + (paragraphs[0].length > 200 ? '...' : '') : 
                "Analysis provided by AI (text format)";
              
              // Extract potential issues/recommendations
              const issues = paragraphs.length > 1 ? 
                paragraphs.slice(1).map(p => p.split('.')[0] + '.').slice(0, 3) : 
                ["AI response was not in JSON format"];
              
              return {
                summary: summary,
                performanceIssues: issues,
                recommendations: [{
                  id: 1,
                  title: "AI Analysis (Text Format)",
                  description: responseText,
                  expectedImprovement: "Unknown",
                  confidence: "Low",
                  implementationSteps: ["Try running the analysis with a different AI provider for structured recommendations."]
                }]
              };
            }
            
            throw new Error('No JSON found in AI response');
          }
          jsonStr = jsonMatch[0];
        }
      }
      
      // Clean up JSON string
      jsonStr = jsonStr.trim();
      
      // Try to clean up common JSON formatting issues
      jsonStr = this.sanitizeJsonString(jsonStr);
      
      let parsed;
      try {
        // Try standard JSON parsing first
        parsed = JSON.parse(jsonStr);
      } catch (jsonError) {
        console.error('JSON parse error:', jsonError);
        console.log('Attempting to parse with JSON5...');
        
        // Try using JSON5, which is more forgiving with syntax
        try {
          // Dynamically import JSON5 with ESM dynamic import
          const json5Module = await import('json5');
          const JSON5 = json5Module.default;
          
          // Additional pre-processing for problematic JSON before using JSON5
          // Replace common patterns that cause JSON5 to fail
          jsonStr = jsonStr.replace(/(\w+)'s/g, '$1s'); // Replace possessives like "strategy's" with "strategys"
          jsonStr = jsonStr.replace(/(\w)"(\w)/g, '$1\\"$2'); // Escape quotes within words
          jsonStr = jsonStr.replace(/,(\s*[\]}])/g, '$1'); // Remove trailing commas
          
          parsed = JSON5.parse(jsonStr);
          console.log('Successfully parsed with JSON5');
        } catch (json5Error) {
          console.error('JSON5 parse error:', json5Error);
          console.log('Attempted to parse JSON string:', jsonStr);
          
          // Return a default response when parsing fails
          return {
            summary: "The AI response could not be parsed correctly. Please try again or use a different provider.",
            performanceIssues: ["Unable to parse AI response"],
            recommendations: [{
              id: 1,
              title: "Try a different AI provider",
              description: "The current AI provider returned a response that couldn't be parsed correctly.",
              expectedImprovement: "Unknown",
              confidence: "Low",
              implementationSteps: ["Select a different AI provider from the dropdown menu."]
            }]
          };
        }
      }
      
      // Validate the parsed response
      if (!parsed.summary || !Array.isArray(parsed.recommendations)) {
        console.warn('Invalid AI response structure:', parsed);
        throw new Error('Invalid AI response structure');
      }
      
      // Fill in missing fields if needed
      if (!parsed.performanceIssues) {
        parsed.performanceIssues = [];
      }
      
      // Validate and normalize each recommendation
      parsed.recommendations = parsed.recommendations.map((rec: any, index: number) => ({
        id: rec.id || index + 1,
        title: rec.title || `Recommendation ${index + 1}`,
        description: rec.description || "No detailed description provided",
        expectedImprovement: rec.expectedImprovement || "Unknown",
        confidence: rec.confidence || "Medium",
        implementationSteps: Array.isArray(rec.implementationSteps) ? rec.implementationSteps : [],
        parameters: rec.parameters || {}
      }));
      
      return parsed;
    } catch (error) {
      console.error('Error parsing AI response:', error);
      
      // Return a default response when parsing fails
      return {
        summary: "The strategy analysis could not be completed successfully due to a technical issue.",
        performanceIssues: ["AI response processing error"],
        recommendations: [{
          id: 1,
          title: "Manual strategy review",
          description: "Due to an error processing the AI response, we recommend manually reviewing your strategy.",
          expectedImprovement: "Unknown",
          confidence: "Low",
          implementationSteps: ["Review performance metrics", "Consider adjusting parameters based on losing trades"]
        }]
      };
    }
  }
  
  /**
   * Sanitize JSON string to fix common formatting issues
   * @param jsonStr JSON string to sanitize
   * @returns Sanitized JSON string
   */
  private sanitizeJsonString(jsonStr: string): string {
    return jsonStr
      // Fix trailing commas in arrays and objects
      .replace(/,(\s*[\]}])/g, '$1')
      // Fix missing quotes around property names
      .replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3')
      // Fix single quotes to double quotes (if not within already double-quoted strings)
      .replace(/"[^"]*"|'([^']*)'|([a-zA-Z0-9_]+)'s/g, function(match) {
        if (match.startsWith('"')) return match; // Already double-quoted
        if (match.indexOf("'s") > 0) return match.replace("'s", "s"); // Possessive
        return match.replace(/'/g, '"'); // Single quotes to double quotes
      });
  }
  
  /**
   * Get strategy-specific guidance for the AI
   */
  private getStrategySpecificGuidance(strategyType: string | undefined): string {
    // Default to empty string if strategy type is undefined
    if (!strategyType) {
      console.warn('Strategy type is undefined in getStrategySpecificGuidance');
      return this.getStrategySpecificGuidance('default');
    }
    
    switch (strategyType.toLowerCase()) {
      case 'bollinger':
      case 'bollinger_bands':
        return `
Bollinger Bands strategy uses a moving average with upper and lower bands based on standard deviations.
- Key parameters: Period (controls smoothing), Deviation (sets band width)
- Common issues: Too narrow bands causing frequent false signals, or too wide bands missing opportunities
- Optimization areas: Band width adjustment, entry/exit timing based on band penetration depth
- Potential improvements: Adding volume confirmation, trend filters, or combining with oscillators like RSI`;
      
      case 'macd':
        return `
MACD (Moving Average Convergence Divergence) strategy uses the difference between two moving averages.
- Key parameters: Fast Period, Slow Period, Signal Period
- Common issues: False signals in sideways markets, late entries in trending markets
- Optimization areas: Adjusting periods for faster/slower response, customizing signal thresholds
- Potential improvements: Adding trend filters, combining with support/resistance levels`;
      
      case 'rsi':
        return `
RSI (Relative Strength Index) strategy is based on momentum oscillator calculations.
- Key parameters: Period, Overbought threshold, Oversold threshold
- Common issues: False signals during strong trends, poor performance in ranging markets
- Optimization areas: Adjusting thresholds based on market conditions, using dynamic thresholds
- Potential improvements: Adding trend confirmation, modifying exit criteria, implementing divergence detection`;
      
      case 'grid':
        return `
Grid trading strategy places buy and sell orders at regular intervals above and below the current price.
- Key parameters: Grid levels, Grid spacing, Order size
- Common issues: Poor performance in trending markets, risk of running out of funds in strong directional moves
- Optimization areas: Grid spacing relative to volatility, dynamic grid adjustments
- Potential improvements: Adding trend bias, implementing take profit levels, dynamic sizing based on volatility`;
      
      case 'dca':
        return `
Dollar Cost Averaging (DCA) strategy involves buying at regular intervals regardless of price.
- Key parameters: Interval duration, Purchase amount, Maximum purchases
- Common issues: Inefficient fund usage in sideways markets, missed opportunities for better entries
- Optimization areas: Timing of purchases, dynamic sizing based on market conditions
- Potential improvements: Adding price condition filters, implementing partial take profits`;
      
      default:
        return `
General trading strategy optimization guidance:
- Examine the win rate and average profit vs. loss - aim for either high win rate or high average profit per trade
- Consider the market conditions during backtest period and how they affect performance
- Look for opportunities to reduce drawdown by implementing better stop loss or position sizing
- Consider combining indicators or adding filters to reduce false signals`;
    }
  }
}

export const aiDiagnosticsService = new AiDiagnosticsService();