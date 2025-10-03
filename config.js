const winston = require('winston');
const chalk = require('chalk');

// Determine AI provider from environment variable
const AI_PROVIDER = process.env.AI_PROVIDER || 'openai'; // Default to openai

// Load appropriate config file based on provider
const configFile = AI_PROVIDER === 'gemini' ? './gemini.conf' : './openai.conf';
require('dotenv').config({ path: configFile });

console.log(`\n${'='.repeat(60)}`);
console.log(`AI Provider: ${chalk.bold.cyan(AI_PROVIDER.toUpperCase())}`);
console.log(`Config File: ${chalk.bold.yellow(configFile)}`);
console.log(`${'='.repeat(60)}\n`);

// Base configuration (common to all providers)
const baseConfig = {
  AI_PROVIDER,
  ARI_URL: process.env.ARI_URL || 'http://127.0.0.1:8088',
  ARI_USER: process.env.ARI_USERNAME,
  ARI_PASS: process.env.ARI_PASSWORD,
  ARI_APP: 'asterisk_to_openai_rt',
  RTP_PORT_START: 12000,
  MAX_CONCURRENT_CALLS: parseInt(process.env.MAX_CONCURRENT_CALLS) || 10,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  SYSTEM_PROMPT: process.env.SYSTEM_PROMPT,
  INITIAL_MESSAGE: process.env.INITIAL_MESSAGE || 'Hi',
  SILENCE_PADDING_MS: parseInt(process.env.SILENCE_PADDING_MS) || 100,
  CALL_DURATION_LIMIT_SECONDS: parseInt(process.env.CALL_DURATION_LIMIT_SECONDS) || 0
};

// OpenAI-specific configuration
const openaiConfig = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  REALTIME_URL: `wss://api.openai.com/v1/realtime?model=${process.env.REALTIME_MODEL || 'gpt-4o-mini-realtime-preview-2024-12-17'}`,
  OPENAI_VOICE: process.env.OPENAI_VOICE || 'alloy',
  VAD_THRESHOLD: parseFloat(process.env.VAD_THRESHOLD) || 0.6,
  VAD_PREFIX_PADDING_MS: Number(process.env.VAD_PREFIX_PADDING_MS) || 200,
  VAD_SILENCE_DURATION_MS: Number(process.env.VAD_SILENCE_DURATION_MS) || 600
};

// Gemini-specific configuration
const geminiConfig = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_URL: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`,
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'models/gemini-2.0-flash-exp',
  GEMINI_VOICE: process.env.GEMINI_VOICE || 'Puck'
};

// Merge configurations based on provider
const config = {
  ...baseConfig,
  ...(AI_PROVIDER === 'gemini' ? geminiConfig : openaiConfig)
};

// Debug logging of loaded configuration
console.log('Loaded configuration:', {
  AI_PROVIDER: config.AI_PROVIDER,
  ARI_URL: config.ARI_URL,
  ARI_USER: config.ARI_USER,
  ARI_PASS: config.ARI_PASS ? 'set' : 'unset',
  API_KEY: config.OPENAI_API_KEY || config.GEMINI_API_KEY ? 'set' : 'unset',
  LOG_LEVEL: config.LOG_LEVEL,
  SYSTEM_PROMPT: config.SYSTEM_PROMPT ? 'set' : 'unset',
  MODEL: config.GEMINI_MODEL || 'OpenAI Realtime',
  VOICE: config.GEMINI_VOICE || config.OPENAI_VOICE
});

// Logger configuration
let sentEventCounter = 0;
let receivedEventCounter = -1;
const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      const [origin] = message.split(' ', 1);
      let counter, coloredMessage;
      if (origin === '[Client]') {
        counter = `C-${sentEventCounter.toString().padStart(4, '0')}`;
        sentEventCounter++;
        coloredMessage = chalk.cyanBright(message);
      } else if (origin === '[OpenAI]' || origin === '[Gemini]') {
        counter = `O-${receivedEventCounter.toString().padStart(4, '0')}`;
        receivedEventCounter++;
        coloredMessage = chalk.yellowBright(message);
      } else {
        counter = 'N/A';
        coloredMessage = chalk.gray(message);
      }
      return `${counter} | ${timestamp} [${level.toUpperCase()}] ${coloredMessage}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

// Validate critical configurations
if (!config.SYSTEM_PROMPT || config.SYSTEM_PROMPT.trim() === '') {
  logger.error(`SYSTEM_PROMPT is missing or empty in ${configFile}`);
  process.exit(1);
}
logger.info(`SYSTEM_PROMPT loaded from ${configFile}`);

if (config.CALL_DURATION_LIMIT_SECONDS < 0) {
  logger.error(`CALL_DURATION_LIMIT_SECONDS cannot be negative in ${configFile}`);
  process.exit(1);
}
logger.info(`CALL_DURATION_LIMIT_SECONDS set to ${config.CALL_DURATION_LIMIT_SECONDS} seconds`);

// Validate provider-specific API keys
if (AI_PROVIDER === 'openai') {
  if (!config.OPENAI_API_KEY || config.OPENAI_API_KEY.trim() === '') {
    logger.error('OPENAI_API_KEY is missing or empty in openai.conf');
    process.exit(1);
  }
  logger.info('OPENAI_API_KEY loaded successfully');
} else if (AI_PROVIDER === 'gemini') {
  if (!config.GEMINI_API_KEY || config.GEMINI_API_KEY.trim() === '') {
    logger.error('GEMINI_API_KEY is missing or empty in gemini.conf');
    process.exit(1);
  }
  logger.info('GEMINI_API_KEY loaded successfully');
  logger.info(`Using Gemini model: ${config.GEMINI_MODEL}`);
  logger.info(`Using Gemini voice: ${config.GEMINI_VOICE}`);
}

// Provider-specific logging helpers
const logClient = (msg, level = 'info') => logger[level](`[Client] ${msg}`);
const logAI = (msg, level = 'info') => {
  const prefix = AI_PROVIDER === 'gemini' ? '[Gemini]' : '[OpenAI]';
  logger[level](`${prefix} ${msg}`);
};

// Backward compatibility aliases
const logOpenAI = logAI;
const logGemini = logAI;

module.exports = {
  config,
  logger,
  logClient,
  logOpenAI,
  logGemini,
  logAI
};
