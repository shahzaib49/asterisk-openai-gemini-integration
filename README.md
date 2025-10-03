# Asterisk to AI Voice Assistant (OpenAI + Gemini Realtime Integration)

This project provides a **full integration between Asterisk 22 and modern AI voice assistants** using either the **OpenAI Realtime API** or **Google Gemini Live API**.

It enables you to connect **SIP calls in Asterisk** directly with **AI-powered voice assistants**, making it possible to build **real-time conversational IVRs, AI receptionists, and voice bots**.

---

## 📌 Use Cases

- Asterisk + OpenAI realtime voice assistant
- Asterisk + Gemini conversational AI
- AI-powered SIP IVR
- Real-time speech-to-speech with Asterisk

---

## ✨ Features

- Real-time audio integration between **Asterisk** and **AI providers (OpenAI or Gemini)**
- Two-way transcription: user speech + AI assistant response
- Clean resource management (channels, bridges, WebSocket, RTP)
- Switch between OpenAI and Gemini with a simple environment variable
- Support for multiple calls via concurrency controls
- Debug mode with audio recording support

---

## 🛠 Requirements

| Category    | Details                                                                 |
|-------------|-------------------------------------------------------------------------|
| OS          | Ubuntu 24.04 LTS                                                        |
| Software    | - Node.js v18.20.8+ (`node -v`)<br>- Asterisk 22 with ARI enabled (`http.conf`, `ari.conf`)<br>- Node dependencies: `ari-client`, `ws`, `uuid`, `winston`, `chalk`, `dotenv` |
| Network     | - Ports: 8088 (ARI), 12000+ (RTP)<br>- Access to AI provider API        |
| Credentials | - OpenAI API key OR Gemini API key<br>- ARI credentials (`asterisk`/`asterisk`) |

---

## ⚡ Installation & Setup

### 1. Install prerequisites

```bash
sudo apt update
sudo apt install nodejs npm asterisk
```

### 2. Configure Asterisk for ARI & SIP

**Enable HTTP:**

```ini
; /etc/asterisk/http.conf
enabled=yes
bindaddr=127.0.0.1
bindport=8088
```

**Enable ARI:**

```ini
; /etc/asterisk/ari.conf
[asterisk]
type=user
password=asterisk
```

**Dialplan configuration:**

```ini
; /etc/asterisk/extensions.conf
[default]
exten => 9999,1,Answer()
 same => n,Stasis(asterisk_to_openai_rt)
 same => n,Hangup()
```

**SIP endpoint:**

```ini
; /etc/asterisk/pjsip.conf
[transport-udp]
type=transport
protocol=udp
bind=0.0.0.0
external_media_address=YOUR_SERVER_IP
external_signaling_address=YOUR_SERVER_IP

[300]
type=endpoint
context=default
disallow=all
allow=ulaw
auth=300
aors=300
direct_media=no
media_use_received_transport=yes
rtp_symmetric=yes
force_rport=yes
rewrite_contact=yes

[300]
type=auth
auth_type=userpass
password=pass300
username=300

[300]
type=aor
max_contacts=2
```

**Restart Asterisk:**

```bash
sudo systemctl restart asterisk
```

### 3. Clone repository & install dependencies

```bash
git clone <your-repo-url>
cd <repo-directory>
npm install
```

### 4. Configure AI Provider

**OpenAI** (`openai.conf`):

```ini
OPENAI_API_KEY=your_openai_api_key_here
REALTIME_MODEL=gpt-4o-mini-realtime-preview-2024-12-17
```

**Gemini** (`gemini.conf`):

```ini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=models/gemini-2.0-flash-exp
GEMINI_VOICE=Puck
```

### 5. Run the app

```bash
# Run with OpenAI
export AI_PROVIDER=openai
node index.js

# Run with Gemini
export AI_PROVIDER=gemini
node index.js
```

---

## 📞 Usage

1. Dial extension **9999** from your SIP client
2. Speak naturally — your audio is streamed in real-time to OpenAI or Gemini
3. Get immediate AI responses back into your call
4. Monitor live transcriptions in the console

**Example:**

```
[OpenAI] User: What is your name?
[OpenAI] Assistant: I'm an AI assistant running inside your Asterisk call.
```

---

## ⚙️ Configuration Files

### openai.conf

- `OPENAI_API_KEY` – Your OpenAI API key
- `REALTIME_MODEL` – Model version (default: gpt-4o-mini-realtime-preview-2024-12-17)
- `VAD_THRESHOLD` – Voice activity detection threshold (default: 0.6)
- `VAD_PREFIX_PADDING_MS` – Audio padding before speech (default: 200)
- `VAD_SILENCE_DURATION_MS` – Silence duration to detect end of speech (default: 600)

### gemini.conf

- `GEMINI_API_KEY` – Your Gemini API key
- `GEMINI_MODEL` – Model version (default: models/gemini-2.0-flash-exp)
- `GEMINI_VOICE` – Voice selection (Puck, Charon, Kore, Fenrir, Aoede, etc.)

### Common Settings

- `SYSTEM_PROMPT` – Assistant instructions
- `INITIAL_MESSAGE` – First message (default: "Hi")
- `CALL_DURATION_LIMIT_SECONDS` – Max call duration (default: 300)
- `MAX_CONCURRENT_CALLS` – Max simultaneous calls (default: 10)
- `LOG_LEVEL` – Logging verbosity: info or debug (default: info)

---

## 🔍 Troubleshooting

### OpenAI Issues

- `OPENAI_API_KEY is missing` → check `openai.conf`
- No transcription → set `LOG_LEVEL=debug`

### Gemini Issues

- `GEMINI_API_KEY is missing` → check `gemini.conf`
- Poor audio quality → enable `RECORD_AUDIO=true`

### General

- ARI connection error → verify Asterisk ARI setup
- No audio → check `external_media_address` in `pjsip.conf`
- Debug logs:
  ```bash
  tail -f /var/log/asterisk/messages
  node --inspect index.js
  ```

---

## 🎙️ Audio Recording (Debug)

To record raw audio for debugging:

```bash
export AI_PROVIDER=gemini
export RECORD_AUDIO=true
node index.js
```

Audio files will be saved in `recordings/` directory:
- `*_mulaw.raw` - Original audio from Asterisk (8kHz μ-law)
- `*_pcm16k.raw` - Converted audio sent to Gemini (16kHz PCM)

Convert to WAV for playback:

```bash
ffmpeg -f mulaw -ar 8000 -ac 1 -i recordings/<file>_mulaw.raw output_mulaw.wav
ffmpeg -f s16le -ar 16000 -ac 1 -i recordings/<file>_pcm16k.raw output_pcm.wav
```

---

## 📊 OpenAI vs Gemini for Asterisk Integration

| Feature       | OpenAI Realtime API | Gemini Live API       |
|---------------|---------------------|-----------------------|
| Audio Format  | μ-law 8kHz          | PCM 16kHz             |
| Latency       | Very low            | Slightly higher       |
| Voices        | 8 voices            | 30+ voices            |
| Setup         | Easier              | Requires audio conversion |

---

## 🙌 Credits

This project is a heavily modified fork of [Original Repository](https://github.com/infinitocloud/asterisk_to_openai_rt_community).

Huge thanks to the original author Yan Frank for providing the initial foundation.

---

## 📜 License

This project is released under the **Apache 2.0 License** (see LICENSE).
You are free to use, modify, and distribute, but attribution is required.
