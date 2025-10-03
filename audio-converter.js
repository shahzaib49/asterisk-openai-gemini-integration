const { logger } = require('./config');

logger.info('Loading audio-converter.js module');

// μ-law encoding/decoding tables for performance
const MULAW_BIAS = 0x84;
const MULAW_MAX = 0x1FFF;

// Precomputed μ-law to linear conversion table (ITU-T G.711)
const mulawToLinear = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  const mulaw = ~i; // Invert all bits
  const sign = (mulaw & 0x80) ? -1 : 1;
  const exponent = (mulaw >> 4) & 0x07;
  const mantissa = mulaw & 0x0F;
  let magnitude = ((mantissa << 3) + MULAW_BIAS) << exponent;
  magnitude = magnitude - MULAW_BIAS;
  mulawToLinear[i] = sign * magnitude;
}

// Precomputed linear to μ-law conversion table
const linearToMulaw = new Uint8Array(65536);
for (let i = 0; i < 65536; i++) {
  const sample = (i & 0x8000) ? (i - 65536) : i;
  const sign = (sample < 0) ? 0x80 : 0;
  const abs = Math.abs(sample);
  const adjusted = abs + MULAW_BIAS;
  let exponent = 7;
  for (let exp = 0; exp < 8; exp++) {
    if (adjusted < (1 << (exp + 8))) {
      exponent = exp;
      break;
    }
  }
  const mantissa = (adjusted >> (exponent + 3)) & 0x0F;
  linearToMulaw[i] = ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

/**
 * Convert μ-law (G.711) to 16-bit PCM linear
 * @param {Buffer} mulawData - μ-law encoded audio data
 * @returns {Buffer} - 16-bit PCM audio data (little-endian)
 */
function mulawToPcm16(mulawData) {
  const pcm16Buffer = Buffer.alloc(mulawData.length * 2);

  for (let i = 0; i < mulawData.length; i++) {
    const pcmValue = mulawToLinear[mulawData[i]];
    pcm16Buffer.writeInt16LE(pcmValue, i * 2);
  }

  return pcm16Buffer;
}

/**
 * Convert 16-bit PCM linear to μ-law (G.711)
 * @param {Buffer} pcm16Data - 16-bit PCM audio data (little-endian)
 * @returns {Buffer} - μ-law encoded audio data
 */
function pcm16ToMulaw(pcm16Data) {
  const mulawBuffer = Buffer.alloc(pcm16Data.length / 2);

  for (let i = 0; i < pcm16Data.length; i += 2) {
    const pcmValue = pcm16Data.readInt16LE(i);
    const unsignedValue = (pcmValue < 0) ? (pcmValue + 65536) : pcmValue;
    mulawBuffer[i / 2] = linearToMulaw[unsignedValue];
  }

  return mulawBuffer;
}

/**
 * Resample audio from 8kHz to 16kHz using linear interpolation
 * @param {Buffer} pcm8k - 16-bit PCM audio at 8kHz
 * @returns {Buffer} - 16-bit PCM audio at 16kHz
 */
function resample8to16(pcm8k) {
  const numSamples = pcm8k.length / 2;
  const pcm16k = Buffer.alloc(numSamples * 4); // Double the samples

  for (let i = 0; i < numSamples - 1; i++) {
    const sample1 = pcm8k.readInt16LE(i * 2);
    const sample2 = pcm8k.readInt16LE((i + 1) * 2);

    // Write original sample
    pcm16k.writeInt16LE(sample1, i * 4);

    // Write interpolated sample (average of current and next)
    const interpolated = Math.round((sample1 + sample2) / 2);
    pcm16k.writeInt16LE(interpolated, i * 4 + 2);
  }

  // Handle last sample
  const lastSample = pcm8k.readInt16LE((numSamples - 1) * 2);
  pcm16k.writeInt16LE(lastSample, (numSamples - 1) * 4);
  pcm16k.writeInt16LE(lastSample, (numSamples - 1) * 4 + 2);

  return pcm16k;
}

/**
 * Resample audio from 16kHz to 8kHz by decimation
 * @param {Buffer} pcm16k - 16-bit PCM audio at 16kHz
 * @returns {Buffer} - 16-bit PCM audio at 8kHz
 */
function resample16to8(pcm16k) {
  const numSamples = pcm16k.length / 2;
  const outputSamples = numSamples / 2;
  const pcm8k = Buffer.alloc(outputSamples * 2); // Correct buffer size

  // Take every other sample
  for (let i = 0; i < outputSamples; i++) {
    const sample = pcm16k.readInt16LE(i * 4);
    pcm8k.writeInt16LE(sample, i * 2);
  }

  return pcm8k;
}

/**
 * Resample audio from 24kHz to 8kHz by decimation
 * @param {Buffer} pcm24k - 16-bit PCM audio at 24kHz
 * @returns {Buffer} - 16-bit PCM audio at 8kHz
 */
function resample24to8(pcm24k) {
  const numSamples = pcm24k.length / 2;
  const outputSamples = Math.floor(numSamples / 3);
  const pcm8k = Buffer.alloc(outputSamples * 2);

  // Take every 3rd sample
  for (let i = 0; i < outputSamples; i++) {
    const sample = pcm24k.readInt16LE(i * 6);
    pcm8k.writeInt16LE(sample, i * 2);
  }

  return pcm8k;
}

/**
 * Full conversion pipeline: μ-law 8kHz → PCM 16kHz
 * (For sending Asterisk audio to Gemini)
 * @param {Buffer} mulawData - μ-law encoded audio at 8kHz
 * @returns {Buffer} - 16-bit PCM audio at 16kHz
 */
function convertAsteriskToGemini(mulawData) {
  // Debug: Check if input has actual audio data (not all silence)
  const hasAudio = !mulawData.every(byte => byte === 0x7F || byte === 0xFF);

  const pcm8k = mulawToPcm16(mulawData);
  const pcm16k = resample8to16(pcm8k);

  // Debug: Log once per 100 calls if audio is detected
  if (hasAudio && Math.random() < 0.01) {
    const { logger } = require('./config');
    logger.debug(`[AudioConvert] Input has audio data, μ-law[0]=${mulawData[0].toString(16)}, PCM[0]=${pcm8k.readInt16LE(0)}, Output length=${pcm16k.length}`);
  }

  return pcm16k;
}

/**
 * Full conversion pipeline: PCM 24kHz → μ-law 8kHz
 * (For sending Gemini audio to Asterisk)
 * @param {Buffer} pcm24k - 16-bit PCM audio at 24kHz
 * @returns {Buffer} - μ-law encoded audio at 8kHz
 */
function convertGeminiToAsterisk(pcm24k) {
  const pcm8k = resample24to8(pcm24k);
  const mulaw = pcm16ToMulaw(pcm8k);
  return mulaw;
}

/**
 * Identity function for OpenAI (no conversion needed)
 * @param {Buffer} mulawData - μ-law audio data
 * @returns {Buffer} - Same μ-law audio data
 */
function convertAsteriskToOpenAI(mulawData) {
  return mulawData; // OpenAI supports μ-law directly
}

/**
 * Identity function for OpenAI (no conversion needed)
 * @param {Buffer} mulawData - μ-law audio data
 * @returns {Buffer} - Same μ-law audio data
 */
function convertOpenAIToAsterisk(mulawData) {
  return mulawData; // OpenAI outputs μ-law directly
}

module.exports = {
  mulawToPcm16,
  pcm16ToMulaw,
  resample8to16,
  resample16to8,
  resample24to8,
  convertAsteriskToGemini,
  convertGeminiToAsterisk,
  convertAsteriskToOpenAI,
  convertOpenAIToAsterisk
};
