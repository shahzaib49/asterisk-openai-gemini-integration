const WebSocket = require('ws');
const { config, logger, logClient, logAI } = require('./config');
const { sipMap, cleanupPromises } = require('./state');
const { streamAudio, rtpEvents } = require('./rtp');

logger.info('Loading gemini.js module');

async function waitForBufferEmpty(channelId, maxWaitTime = 6000, checkInterval = 10) {
  const channelData = sipMap.get(channelId);
  if (!channelData?.streamHandler) {
    logAI(`No streamHandler for ${channelId}, proceeding`, 'info');
    return true;
  }
  const streamHandler = channelData.streamHandler;
  const startWaitTime = Date.now();

  let audioDurationMs = 1000; // Default minimum
  if (channelData.totalDeltaBytes) {
    audioDurationMs = Math.ceil((channelData.totalDeltaBytes / 8000) * 1000) + 500;
  }
  const dynamicTimeout = Math.min(audioDurationMs, maxWaitTime);
  logAI(`Using dynamic timeout of ${dynamicTimeout}ms for ${channelId} (estimated audio duration: ${(channelData.totalDeltaBytes || 0) / 8000}s)`, 'info');

  let audioFinishedReceived = false;
  const audioFinishedPromise = new Promise((resolve) => {
    rtpEvents.once('audioFinished', (id) => {
      if (id === channelId) {
        logAI(`Audio finished sending for ${channelId} after ${Date.now() - startWaitTime}ms`, 'info');
        audioFinishedReceived = true;
        resolve();
      }
    });
  });

  const isBufferEmpty = () => (
    (!streamHandler.audioBuffer || streamHandler.audioBuffer.length === 0) &&
    (!streamHandler.packetQueue || streamHandler.packetQueue.length === 0)
  );
  if (!isBufferEmpty()) {
    let lastLogTime = 0;
    while (!isBufferEmpty() && (Date.now() - startWaitTime) < maxWaitTime) {
      const now = Date.now();
      if (now - lastLogTime >= 50) {
        logAI(`Waiting for RTP buffer to empty for ${channelId} | Buffer: ${streamHandler.audioBuffer?.length || 0} bytes, Queue: ${streamHandler.packetQueue?.length || 0} packets`, 'info');
        lastLogTime = now;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    if (!isBufferEmpty()) {
      logger.warn(`Timeout waiting for RTP buffer to empty for ${channelId} after ${maxWaitTime}ms`);
      return false;
    }
    logAI(`RTP buffer emptied for ${channelId} after ${Date.now() - startWaitTime}ms`, 'info');
  }

  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => {
      if (!audioFinishedReceived) {
        logger.warn(`Timeout waiting for audioFinished for ${channelId} after ${dynamicTimeout}ms`);
      }
      resolve();
    }, dynamicTimeout);
  });
  await Promise.race([audioFinishedPromise, timeoutPromise]);

  logAI(`waitForBufferEmpty completed for ${channelId} in ${Date.now() - startWaitTime}ms`, 'info');
  return true;
}

async function startGeminiWebSocket(channelId) {
  const GEMINI_API_KEY = config.GEMINI_API_KEY;
  if (!GEMINI_API_KEY) {
    logger.error('GEMINI_API_KEY is missing in config');
    throw new Error('Missing GEMINI_API_KEY');
  }

  let channelData = sipMap.get(channelId);
  if (!channelData) {
    throw new Error(`Channel ${channelId} not found in sipMap`);
  }

  let ws;
  let streamHandler = null;
  let retryCount = 0;
  const maxRetries = 3;
  let totalDeltaBytes = 0;
  let messageQueue = [];
  let setupComplete = false;

  const processMessage = async (response) => {
    try {
      logger.debug(`[Gemini] Processing message type: ${Object.keys(response).join(', ')} for ${channelId}`);

      // Setup completion
      if (response.setupComplete) {
        logAI(`Setup completed for ${channelId}`);
        setupComplete = true;
      }

      // Server content (model responses)
      if (response.serverContent) {
        const modelTurn = response.serverContent.modelTurn;

        // Handle interruption
        if (response.serverContent.interrupted) {
          logAI(`Response interrupted for ${channelId}, stopping playback`);
          if (streamHandler) {
            streamHandler.stopPlayback();
          }
        }

        // Process response parts
        if (modelTurn && modelTurn.parts) {
          for (const part of modelTurn.parts) {
            // Handle audio data
            if (part.inlineData && part.inlineData.mimeType && part.inlineData.mimeType.startsWith('audio/pcm')) {
              const base64Audio = part.inlineData.data;
              const pcm24kBuffer = Buffer.from(base64Audio, 'base64');

              totalDeltaBytes += pcm24kBuffer.length;
              channelData.totalDeltaBytes = totalDeltaBytes;
              sipMap.set(channelId, channelData);

              logAI(`Received PCM audio: ${pcm24kBuffer.length} bytes at 24kHz for ${channelId}, total: ${totalDeltaBytes} bytes`, 'info');

              // Audio conversion handled in RTP module
              if (sipMap.has(channelId) && streamHandler) {
                streamHandler.sendAudioChunk(pcm24kBuffer, 'gemini');
              }
            }

            // Handle text response
            if (part.text) {
              logAI(`Assistant text: ${part.text} for ${channelId}`);
            }
          }
        }

        // Turn complete
        if (response.serverContent.turnComplete) {
          logAI(`Turn completed for ${channelId}, total audio: ${totalDeltaBytes} bytes`);
          totalDeltaBytes = 0;
          channelData.totalDeltaBytes = 0;
          sipMap.set(channelId, channelData);
        }
      }

      // Tool call request
      if (response.toolCall) {
        logAI(`Tool call requested: ${response.toolCall.functionCalls?.[0]?.name || 'unknown'} for ${channelId}`);
      }

      // Input transcription (user speech)
      if (response.inputTranscription) {
        const transcript = response.inputTranscription.text;
        logAI(`User transcription: ${transcript} for ${channelId}`, 'info');
      }

      // Output transcription (assistant speech)
      if (response.outputTranscription) {
        const transcript = response.outputTranscription.text;
        logAI(`Assistant transcription: ${transcript} for ${channelId}`, 'info');
      }

      // Log unhandled message types for debugging
      const knownTypes = ['setupComplete', 'serverContent', 'toolCall', 'inputTranscription', 'outputTranscription'];
      const messageTypes = Object.keys(response);
      const unknownTypes = messageTypes.filter(t => !knownTypes.includes(t));
      if (unknownTypes.length > 0) {
        logger.debug(`[Gemini] Unknown message types for ${channelId}: ${unknownTypes.join(', ')}`);
        logger.debug(`[Gemini] Full unknown message: ${JSON.stringify(response)}`);
      }

      // Log if no message types matched
      if (messageTypes.length === 0 || (messageTypes.length === 1 && messageTypes[0] === 'type')) {
        logger.debug(`[Gemini] Empty or minimal message for ${channelId}: ${JSON.stringify(response)}`);
      }

    } catch (e) {
      logger.error(`Error processing Gemini message for ${channelId}: ${e.message}`);
    }
  };

  const connectWebSocket = () => {
    return new Promise((resolve, reject) => {
      // Construct WebSocket URL with API key
      const geminiUrl = `${config.GEMINI_URL}?key=${GEMINI_API_KEY}`;
      ws = new WebSocket(geminiUrl);

      ws.on('open', async () => {
        logClient(`Gemini WebSocket connected for ${channelId}`);

        // STEP 1: Send setup message (REQUIRED FIRST)
        const setupMessage = {
          setup: {
            model: config.GEMINI_MODEL,
            generationConfig: {
              responseModalities: 'audio',
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: config.GEMINI_VOICE
                  }
                }
              }
            },
            systemInstruction: {
              parts: [{ text: config.SYSTEM_PROMPT }]
            },
            // Enable automatic voice activity detection
            tools: []
          }
        };

        logger.info(`[Gemini] Setup message: ${JSON.stringify(setupMessage)}`);

        ws.send(JSON.stringify(setupMessage));
        logClient(`Setup message sent for ${channelId} (model: ${config.GEMINI_MODEL}, voice: ${config.GEMINI_VOICE})`);

        try {
          // Initialize RTP stream handler
          const rtpSource = channelData.rtpSource || { address: '127.0.0.1', port: 12000 };
          streamHandler = await streamAudio(channelId, rtpSource);
          channelData.ws = ws;
          channelData.streamHandler = streamHandler;
          channelData.totalDeltaBytes = 0;
          sipMap.set(channelId, channelData);

          // Wait for setup to complete
          await new Promise((resolveSetup) => {
            const checkSetup = setInterval(() => {
              if (setupComplete) {
                clearInterval(checkSetup);
                resolveSetup();
              }
            }, 50);
            // Timeout after 5 seconds
            setTimeout(() => {
              clearInterval(checkSetup);
              if (!setupComplete) {
                logger.warn(`Setup not completed within timeout for ${channelId}, proceeding anyway`);
              }
              resolveSetup();
            }, 5000);
          });

          // STEP 2: Send initial text message to trigger greeting
          const initialMessage = {
            clientContent: {
              turns: [
                {
                  role: 'user',
                  parts: [{ text: config.INITIAL_MESSAGE }]
                }
              ],
              turnComplete: true
            }
          };

          ws.send(JSON.stringify(initialMessage));
          logClient(`Initial message sent for ${channelId}: "${config.INITIAL_MESSAGE}"`);

          resolve(ws);
        } catch (e) {
          logger.error(`Error setting up Gemini WebSocket for ${channelId}: ${e.message}`);
          reject(e);
        }
      });

      let messageCount = 0;
      ws.on('message', (data) => {
        try {
          const response = JSON.parse(data.toString());
          messageCount++;

          // Log first 5 messages completely, then just keys
          if (messageCount <= 5) {
            logger.info(`[Gemini] Message #${messageCount} FULL for ${channelId}: ${JSON.stringify(response)}`);
          } else {
            logger.debug(`[Gemini] Message #${messageCount} keys for ${channelId}: ${Object.keys(response).join(', ')}`);
          }

          messageQueue.push(response);
        } catch (e) {
          logger.error(`Error parsing Gemini message for ${channelId}: ${e.message}`);
        }
      });

      ws.on('error', (e) => {
        logger.error(`Gemini WebSocket error for ${channelId}: ${e.message}`);
        if (retryCount < maxRetries && sipMap.has(channelId)) {
          retryCount++;
          setTimeout(() => connectWebSocket().then(resolve).catch(reject), 1000);
        } else {
          reject(new Error(`Failed Gemini WebSocket after ${maxRetries} attempts`));
        }
      });

      const handleClose = () => {
        logger.info(`Gemini WebSocket closed for ${channelId}`);
        channelData.wsClosed = true;
        channelData.ws = null;
        sipMap.set(channelId, channelData);
        ws.off('close', handleClose);
        const cleanupResolve = cleanupPromises.get(`ws_${channelId}`);
        if (cleanupResolve) {
          cleanupResolve();
          cleanupPromises.delete(`ws_${channelId}`);
        }
      };
      ws.on('close', handleClose);
    });
  };

  // Message processing loop
  setInterval(async () => {
    const maxMessages = 5;
    for (let i = 0; i < maxMessages && messageQueue.length > 0; i++) {
      await processMessage(messageQueue.shift());
    }
  }, 25);

  try {
    await connectWebSocket();
  } catch (e) {
    logger.error(`Failed to start Gemini WebSocket for ${channelId}: ${e.message}`);
    throw e;
  }
}

module.exports = { startGeminiWebSocket };
