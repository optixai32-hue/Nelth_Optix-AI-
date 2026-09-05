import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { Communicate, listVoices } from "edge-tts-universal";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";

const PORT = Number(process.env.PORT) || 3000;

// NVIDIA NIM Target Model (Strictly no fallback)
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
const TARGET_LLM_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

// Gemini client — LLM fallback only. Speech-to-text is handled 100%
// client-side by the Web Speech API (all devices, no server STT).
let genAIClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI | null {
  if (genAIClient) return genAIClient;
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  genAIClient = new GoogleGenAI({ apiKey });
  return genAIClient;
}

interface VoiceInfo {
  name: string;
  gender: string;
  locale: string;
  displayName: string;
  isUniversal?: boolean;
  description?: string;
}

// Curated list with fr-FR-DeniseNeural and the Universal Multilingual Voice
const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";

const POPULAR_VOICES: VoiceInfo[] = [
  {
    name: "en-US-AvaMultilingualNeural",
    gender: "Female",
    locale: "Multilingual",
    displayName: "Ava Multilingue (Voix Universelle - Toutes les langues)",
    isUniversal: true,
    description: "Modèle neural universel capable de parler couramment français, anglais, espagnol, arabe, allemand, japonais, etc. avec une seule voix.",
  },
  {
    name: "fr-FR-DeniseNeural",
    gender: "Female",
    locale: "fr-FR",
    displayName: "Denise (Français - France)",
    description: "Voix française classique naturelle",
  },
  {
    name: "en-US-AndrewMultilingualNeural",
    gender: "Male",
    locale: "Multilingual",
    displayName: "Andrew Multilingue (Universel Homme - Toutes langues)",
    isUniversal: true,
    description: "Voix masculine multilingue universelle",
  },
  { name: "fr-FR-HenriNeural", gender: "Male", locale: "fr-FR", displayName: "Henri (Français - France)" },
  { name: "fr-FR-EloiseNeural", gender: "Female", locale: "fr-FR", displayName: "Éloïse (Français - France)" },
  { name: "fr-FR-VivienneMultilingualNeural", gender: "Female", locale: "fr-FR", displayName: "Vivienne (Français Multilingue)" },
  { name: "fr-FR-RemyMultilingualNeural", gender: "Male", locale: "fr-FR", displayName: "Rémy (Français Multilingue)" },
  { name: "en-US-JennyNeural", gender: "Female", locale: "en-US", displayName: "Jenny (English - US)" },
  { name: "en-US-GuyNeural", gender: "Male", locale: "en-US", displayName: "Guy (English - US)" },
  { name: "es-ES-ElviraNeural", gender: "Female", locale: "es-ES", displayName: "Elvira (Español - España)" },
  { name: "de-DE-KatjaNeural", gender: "Female", locale: "de-DE", displayName: "Katja (Deutsch - Deutschland)" },
  { name: "it-IT-ElsaNeural", gender: "Female", locale: "it-IT", displayName: "Elsa (Italiano - Italia)" },
];

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "50mb" }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws/speech" });

  // API Routes
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      defaultVoice: DEFAULT_VOICE,
      sttEngine: "webspeech-inbrowser",
      llmModel: TARGET_LLM_MODEL,
    });
  });

  app.get("/api/voices", async (_req, res) => {
    try {
      res.json({
        defaultVoice: DEFAULT_VOICE,
        voices: POPULAR_VOICES,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to fetch voices" });
    }
  });

  // Direct TTS Streaming endpoint via chunked HTTP response
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, voice = DEFAULT_VOICE, rate, pitch } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Missing or invalid 'text' field" });
      }

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");

      const options: any = { voice };
      if (rate) options.rate = rate;
      if (pitch) options.pitch = pitch;

      const communicate = new Communicate(text, options);

      for await (const chunk of communicate.stream()) {
        if (chunk.type === "audio" && chunk.data) {
          // Send immediately to client response stream
          res.write(Buffer.from(chunk.data));
        }
      }
      res.end();
    } catch (err: any) {
      console.error("Direct TTS error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: err?.message || "Edge-TTS error" });
      } else {
        res.end();
      }
    }
  });

  // Full speech turn HTTP REST endpoint (Fallback when WebSocket is unavailable)
  app.post("/api/speech-turn", async (req, res) => {
    try {
      const { text, voice = DEFAULT_VOICE, systemInstruction, history = [] } = req.body;
      if (!text || typeof text !== "string") {
        return res.status(400).json({ error: "Texte manquant ou invalide" });
      }

      const nvidiaMessages: Array<{ role: "system" | "user" | "assistant"; content: any }> = [];
      if (systemInstruction) {
        nvidiaMessages.push({ role: "system", content: systemInstruction });
      }

      for (const item of history.slice(-6)) {
        if (!item || typeof item.text !== "string") continue;
        const clean = item.text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
        if (clean) nvidiaMessages.push({ role: item.role === "assistant" ? "assistant" : "user", content: clean });
      }

      nvidiaMessages.push({ role: "user", content: text.trim() });

      const abortController = new AbortController();
      const { streamGenerator, modelUsed } = await acquireLLMStream(nvidiaMessages, abortController.signal);

      let fullResponseText = "";
      for await (const chunk of streamGenerator) {
        fullResponseText += chunk;
      }

      res.json({
        text: fullResponseText.trim(),
        model: modelUsed,
        voice,
      });
    } catch (err: any) {
      console.error("Speech turn HTTP error:", err);
      res.status(500).json({ error: err?.message || "Erreur de génération de réponse AI" });
    }
  });

  // Model & System Configuration info endpoint
  app.get("/api/model-info", (req, res) => {
    const hasNvidiaKey = Boolean(process.env.NVIDIA_API_KEY && process.env.NVIDIA_API_KEY.trim());
    res.json({
      model: TARGET_LLM_MODEL,
      invokeUrl: `${NVIDIA_BASE_URL}/chat/completions`,
      hasNvidiaKey,
      provider: "NVIDIA NIM",
      stt: {
        engine: "webspeech-inbrowser",
        status: "active",
      },
    });
  });

  // Parse raw/nested API error messages into user-friendly explanations
  function parseApiErrorMessage(err: any): string {
    if (!err) return "Une erreur inattendue est survenue";
    let str = err?.message || String(err);
    try {
      const obj = typeof err === "object" && err !== null ? err : JSON.parse(str);
      if (obj.error?.message) {
        str = obj.error.message;
        try {
          const nested = JSON.parse(str);
          if (nested.error?.message) {
            str = nested.error.message;
          }
        } catch {}
      }
    } catch {}

    if (str.includes("NVIDIA_API_KEY") || str.includes("MISSING_NVIDIA_API_KEY")) {
      return "Clé NVIDIA_API_KEY manquante. Veuillez la configurer dans les Secrets/Paramètres.";
    }

    if (str.includes("401") || str.includes("Unauthorized") || str.includes("invalid_api_key")) {
      return "Clé NVIDIA_API_KEY invalide ou non autorisée auprès de l'API NVIDIA.";
    }

    if (
      str.includes("503") ||
      str.includes("high demand") ||
      str.includes("UNAVAILABLE") ||
      str.includes("Service Unavailable")
    ) {
      return "Le modèle NVIDIA Nemotron connaît une forte demande temporaire. Veuillez réessayer.";
    }

    if (str.includes("429") || str.includes("RESOURCE_EXHAUSTED")) {
      return "Limite temporaire de requêtes atteinte sur l'API NVIDIA. Veuillez patienter un instant.";
    }

    return str;
  }

  // Stream text deltas strictly from NVIDIA Nemotron-3.5-Lightning via OpenAI SDK
  async function* streamNemotronLightning(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    apiKey: string,
    abortSignal: AbortSignal
  ): AsyncGenerator<string> {
    const client = new OpenAI({
      baseURL: NVIDIA_BASE_URL,
      apiKey: apiKey,
      timeout: 30000,
    });

    console.log(`[NVIDIA] Invoking model: ${TARGET_LLM_MODEL} with ${messages.length} messages (temp: 1, top_p: 0.95, stream: true)...`);

    const completion = (await client.chat.completions.create(
      {
        model: TARGET_LLM_MODEL,
        messages: messages as any,
        temperature: 1,
        top_p: 0.95,
        max_tokens: 4096,
        chat_template_kwargs: {
          enable_thinking: false,
        },
        stream: true,
      } as any,
      { signal: abortSignal }
    )) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    let totalYielded = 0;
    let inThinkTag = false;
    let thinkBuffer = "";

    for await (const chunk of completion) {
      if (abortSignal.aborted) break;
      if (!chunk.choices || chunk.choices.length === 0) continue;
      const text = chunk.choices[0]?.delta?.content;
      if (!text) continue;

      // Real-time filtering of potential reasoning / <think> tags from output
      if (!inThinkTag && text.includes("<think>")) {
        inThinkTag = true;
        const parts = text.split("<think>");
        if (parts[0]) {
          totalYielded++;
          yield parts[0];
        }
        thinkBuffer = parts.slice(1).join("<think>");
        if (thinkBuffer.includes("</think>")) {
          const afterParts = thinkBuffer.split("</think>");
          inThinkTag = false;
          thinkBuffer = "";
          const afterText = afterParts.slice(1).join("</think>").trimStart();
          if (afterText) {
            totalYielded++;
            yield afterText;
          }
        }
        continue;
      }

      if (inThinkTag) {
        thinkBuffer += text;
        if (thinkBuffer.includes("</think>")) {
          const parts = thinkBuffer.split("</think>");
          inThinkTag = false;
          thinkBuffer = "";
          const afterText = parts.slice(1).join("</think>").trimStart();
          if (afterText) {
            totalYielded++;
            yield afterText;
          }
        }
        continue;
      }

      const cleanText = text.replace(/<\/?[a-zA-Z0-9_-]+>/g, "");
      if (cleanText) {
        totalYielded++;
        yield cleanText;
      }
    }

    if (inThinkTag && thinkBuffer) {
      const clean = thinkBuffer.replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trimStart();
      if (clean) {
        totalYielded++;
        yield clean;
      }
    }

    if (totalYielded === 0 && !abortSignal.aborted) {
      throw new Error(`Le modèle ${TARGET_LLM_MODEL} a terminé le flux sans texte émis.`);
    }
  }

  // Fallback Gemini 2.5 Flash LLM stream generator
  async function* streamGeminiFlash(
    messages: Array<{ role: "system" | "user" | "assistant"; content: any }>,
    abortSignal: AbortSignal
  ): AsyncGenerator<string> {
    const ai = getGenAI();
    if (!ai) {
      throw new Error("Ni NVIDIA_API_KEY ni GEMINI_API_KEY ne sont configurées sur le serveur.");
    }

    let systemInstruction = "";
    const contents: any[] = [];

    for (const m of messages) {
      if (m.role === "system") {
        systemInstruction += (typeof m.content === "string" ? m.content : "") + "\n";
      } else {
        const role = m.role === "assistant" ? "model" : "user";
        let parts: any[] = [];
        if (typeof m.content === "string") {
          parts = [{ text: m.content }];
        } else if (Array.isArray(m.content)) {
          parts = m.content.map((part: any) => {
            if (part.type === "text") return { text: part.text };
            if (part.type === "image_url" && part.image_url?.url) {
              const url = part.image_url.url;
              if (url.startsWith("data:")) {
                const [header, base64] = url.split(",");
                const mimeType = header.split(";")[0].replace("data:", "");
                return { inlineData: { mimeType, data: base64 } };
              }
            }
            return { text: "" };
          });
        }
        contents.push({ role, parts });
      }
    }

    console.log(`[Gemini Flash LLM] Streaming response from gemini-2.5-flash...`);
    const responseStream = await ai.models.generateContentStream({
      model: "gemini-2.5-flash",
      contents,
      config: {
        systemInstruction: systemInstruction.trim() || undefined,
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    });

    let totalYielded = 0;
    for await (const chunk of responseStream) {
      if (abortSignal.aborted) break;
      const text = chunk.text;
      if (text) {
        totalYielded++;
        yield text;
      }
    }

    if (totalYielded === 0 && !abortSignal.aborted) {
      throw new Error("Gemini 2.5 Flash a terminé le flux sans texte émis.");
    }
  }

  // Acquire LLM stream with primary NVIDIA Nemotron and automatic Gemini 2.5 Flash fallback
  async function acquireLLMStream(
    nvidiaMessages: Array<{ role: "system" | "user" | "assistant"; content: any }>,
    abortSignal: AbortSignal
  ): Promise<{
    streamGenerator: AsyncIterable<string>;
    modelUsed: string;
  }> {
    const apiKey = process.env.NVIDIA_API_KEY?.trim();

    if (apiKey) {
      try {
        const gen = streamNemotronLightning(nvidiaMessages, apiKey, abortSignal);
        const first = await gen.next();

        if (!first.done || first.value) {
          async function* unifiedGen() {
            if (first.value) yield first.value;
            if (first.done) return;
            while (!abortSignal.aborted) {
              const res = await gen.next();
              if (res.done) break;
              if (res.value) yield res.value;
            }
          }

          console.log(`[NVIDIA] Stream successfully opened for ${TARGET_LLM_MODEL}`);
          return {
            streamGenerator: unifiedGen(),
            modelUsed: TARGET_LLM_MODEL,
          };
        }
      } catch (nvidiaErr: any) {
        console.warn(`[NVIDIA] Call failed or key issue: ${nvidiaErr?.message || nvidiaErr}. Falling back to Gemini 2.5 Flash...`);
      }
    } else {
      console.log(`[LLM] NVIDIA_API_KEY non fournie. Bascule automatique sur Gemini 2.5 Flash...`);
    }

    // Fallback to Gemini 2.5 Flash
    const geminiGen = streamGeminiFlash(nvidiaMessages, abortSignal);
    const firstGemini = await geminiGen.next();

    if (firstGemini.done && !firstGemini.value) {
      throw new Error("Le modèle de secours Gemini 2.5 Flash n'a renvoyé aucun contenu.");
    }

    async function* unifiedGeminiGen() {
      if (firstGemini.value) yield firstGemini.value;
      if (firstGemini.done) return;
      while (!abortSignal.aborted) {
        const res = await geminiGen.next();
        if (res.done) break;
        if (res.value) yield res.value;
      }
    }

    return {
      streamGenerator: unifiedGeminiGen(),
      modelUsed: "gemini-2.5-flash",
    };
  }

  // Helper to split incoming LLM streaming text into natural, ultra-low-latency spoken clauses & sentences
  function extractSpokenChunks(
    buffer: string,
    isFirstChunk: boolean
  ): { chunks: string[]; remainder: string } {
    const chunks: string[] = [];
    let remaining = buffer;

    while (true) {
      const trimmed = remaining.trimStart();
      if (!trimmed) {
        remaining = "";
        break;
      }

      // For the very first chunk of a turn, trigger ultra-early on short clause/comma/punctuation or >= 4 words
      if (isFirstChunk && chunks.length === 0) {
        // Check for early punctuation (, : ; - — . ? !)
        const earlyMatch = trimmed.match(/^([^,;:—–.?!]+[,;:—–.?!])(\s+|$)/);
        if (earlyMatch && earlyMatch[1].trim().length >= 2) {
          const chunk = earlyMatch[1].replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
          if (chunk.length > 0) {
            chunks.push(chunk);
            remaining = trimmed.slice(earlyMatch[0].length);
            continue;
          }
        }

        // If no punctuation yet, check if we have reached at least 4-5 words (~20-25 chars)
        const words = trimmed.split(/\s+/);
        if (words.length >= 5) {
          const firstWords = words.slice(0, 4).join(" ");
          const chunk = firstWords.replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
          if (chunk.length > 0) {
            chunks.push(chunk);
            remaining = trimmed.slice(firstWords.length).trimStart();
            continue;
          }
        }
      }

      // Sentence terminators (. ? ! \n)
      const sentenceMatch = trimmed.match(/^([^.?!;\n]+[.?!;\n]+)(\s+|$)/);
      if (sentenceMatch) {
        const chunk = sentenceMatch[1].replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
        if (chunk.length > 0) {
          chunks.push(chunk);
        }
        remaining = trimmed.slice(sentenceMatch[0].length);
        continue;
      }

      // Clause boundary on comma/semicolon/dash if accumulated >= 5 words
      const clauseMatch = trimmed.match(/^([^,;—–]+[,;—–])(\s+|$)/);
      if (clauseMatch) {
        const clauseWords = clauseMatch[1].trim().split(/\s+/);
        if (clauseWords.length >= 5) {
          const chunk = clauseMatch[1].replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
          if (chunk.length > 0) {
            chunks.push(chunk);
          }
          remaining = trimmed.slice(clauseMatch[0].length);
          continue;
        }
      }

      // Hard boundary if buffer is getting long (>= 14 words) without punctuation
      const words = trimmed.split(/\s+/);
      if (words.length >= 14) {
        const subWords = words.slice(0, 9).join(" ");
        const chunk = subWords.replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
        if (chunk.length > 0) {
          chunks.push(chunk);
        }
        remaining = trimmed.slice(subWords.length).trimStart();
        continue;
      }

      break;
    }

    return { chunks, remainder: remaining };
  }

  // WebSocket Speech-to-Speech Streaming Session
  wss.on("connection", (ws: WebSocket) => {
    let currentAbortController: AbortController | null = null;
    let isProcessingTurn = false;

    ws.on("message", async (rawMessage) => {
      try {
        const payload = JSON.parse(rawMessage.toString());

        if (payload.type === "interrupt") {
          if (currentAbortController) {
            currentAbortController.abort();
            currentAbortController = null;
          }
          isProcessingTurn = false;
          ws.send(JSON.stringify({ type: "interrupted" }));
          return;
        }

        if (payload.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
          return;
        }

        if (payload.type === "tts_request") {
          // Direct TTS via WebSocket
          const text = payload.text;
          const voice = payload.voice || DEFAULT_VOICE;
          if (!text) return;

          try {
            const communicate = new Communicate(text, { voice });
            let chunkCount = 0;
            for await (const chunk of communicate.stream()) {
              if (chunk.type === "audio" && chunk.data) {
                chunkCount++;
                ws.send(
                  JSON.stringify({
                    type: "audio_chunk",
                    sentenceIndex: 0,
                    chunkIndex: chunkCount,
                    data: Buffer.from(chunk.data).toString("base64"),
                  })
                );
              }
            }
            ws.send(
              JSON.stringify({
                type: "audio_stream_end",
                sentenceIndex: 0,
                fullText: text,
              })
            );
          } catch (ttsErr: any) {
            ws.send(JSON.stringify({ type: "error", error: ttsErr?.message || "TTS error" }));
          }
          return;
        }

        if (payload.type === "user_speech") {
          // Stop any previous active turn
          if (currentAbortController) {
            currentAbortController.abort();
          }

          const abortController = new AbortController();
          currentAbortController = abortController;
          isProcessingTurn = true;

          const userText = (payload.text || "").trim();
          const voice = payload.voice || DEFAULT_VOICE;
          const systemInstruction =
            payload.systemInstruction ||
            "You are a friendly, intelligent voice conversational partner. Keep your answers natural, concise, and spoken-friendly (1-3 sentences per turn), in the language the user speaks (French by default if they speak French, or their language). Never output thinking tags, internal monologue, or markdown asterisks/bullets. Output ONLY the final spoken words.";

          if (!userText) {
            ws.send(JSON.stringify({ type: "error", error: "Empty speech text" }));
            return;
          }

          // Acknowledge receipt and transition state to thinking
          ws.send(
            JSON.stringify({
              type: "ai_thinking",
              userText,
            })
          );

          // Build conversation context for NVIDIA Nemotron and Gemini
          const history = Array.isArray(payload.history) ? payload.history : [];

          // Format and sanitize messages for NVIDIA Nemotron-3.5-Lightning
          const nvidiaMessages: Array<{ role: "system" | "user" | "assistant"; content: any }> = [];
          if (systemInstruction) {
            nvidiaMessages.push({
              role: "system",
              content: systemInstruction,
            });
          }

          // Filter history to ensure alternating roles and clean text without thinking tags
          for (const item of history.slice(-6)) {
            if (!item || typeof item.text !== "string") continue;
            const cleanItemText = item.text
              .replace(/<think>[\s\S]*?<\/think>/gi, "")
              .replace(/<\/?[a-zA-Z0-9_-]+>/g, "")
              .trim();
            if (!cleanItemText) continue;

            const role: "assistant" | "user" = item.role === "assistant" ? "assistant" : "user";
            // Avoid duplicate consecutive roles by merging content if needed
            const lastMsg = nvidiaMessages[nvidiaMessages.length - 1];
            if (lastMsg && lastMsg.role === role) {
              lastMsg.content = typeof lastMsg.content === "string" 
                ? `${lastMsg.content}\n${cleanItemText}`
                : cleanItemText;
            } else {
              nvidiaMessages.push({
                role,
                content: cleanItemText,
              });
            }
          }

          // Ensure the current turn is added as the final user message
          if (payload.imageUrl) {
            nvidiaMessages.push({
              role: "user",
              content: [
                { type: "text", text: userText },
                { type: "image_url", image_url: { url: payload.imageUrl } },
              ],
            });
          } else {
            const lastMsg = nvidiaMessages[nvidiaMessages.length - 1];
            if (lastMsg && lastMsg.role === "user") {
              // Replace or append current turn
              lastMsg.content = userText;
            } else {
              nvidiaMessages.push({
                role: "user",
                content: userText,
              });
            }
          }

          // Generate response strictly from NVIDIA Nemotron-3.5-Lightning (No fallback)
          let streamResult;
          try {
            streamResult = await acquireLLMStream(
              nvidiaMessages,
              abortController.signal
            );
          } catch (llmErr: any) {
            if (abortController.signal.aborted) return;
            const friendlyError = parseApiErrorMessage(llmErr);
            console.error("LLM stream failed:", friendlyError);

            ws.send(
              JSON.stringify({
                type: "error",
                error: friendlyError,
              })
            );

            // Spoken voice apology via Edge-TTS so speech-to-speech doesn't fail silently
            try {
              const apology =
                "Désolé, une erreur est survenue lors de l'appel au modèle NVIDIA. Veuillez vérifier votre clé d'API NVIDIA.";
              const communicate = new Communicate(apology, { voice });
              let chunkIdx = 0;
              ws.send(
                JSON.stringify({
                  type: "sentence_start",
                  sentenceIndex: 0,
                  text: apology,
                })
              );
              for await (const ttsChunk of communicate.stream()) {
                if (abortController.signal.aborted) break;
                if (ttsChunk.type === "audio" && ttsChunk.data) {
                  chunkIdx++;
                  ws.send(
                    JSON.stringify({
                      type: "audio_chunk",
                      sentenceIndex: 0,
                      chunkIndex: chunkIdx,
                      data: Buffer.from(ttsChunk.data).toString("base64"),
                    })
                  );
                }
              }
              ws.send(
                JSON.stringify({
                  type: "sentence_end",
                  sentenceIndex: 0,
                  text: apology,
                })
              );
            } catch {}

            isProcessingTurn = false;
            return;
          }

          const { streamGenerator, modelUsed } = streamResult;

          let fullResponseText = "";
          let textBuffer = "";
          let sentenceCounter = 0;
          let isFirstChunk = true;

          // Asynchronous TTS synthesis pipeline queue
          interface TtsTask {
            sentenceIndex: number;
            text: string;
          }

          const ttsQueue: TtsTask[] = [];
          let isTtsWorkerBusy = false;
          let ttsCompletionResolver: (() => void) | null = null;

          const runTtsWorker = async () => {
            if (isTtsWorkerBusy) return;
            isTtsWorkerBusy = true;

            while (ttsQueue.length > 0 && !abortController.signal.aborted) {
              const currentTask = ttsQueue.shift()!;
              const { sentenceIndex, text } = currentTask;

              ws.send(
                JSON.stringify({
                  type: "sentence_start",
                  sentenceIndex,
                  text,
                })
              );

              try {
                const communicate = new Communicate(text, { voice });
                let chunkIndex = 0;
                for await (const ttsChunk of communicate.stream()) {
                  if (abortController.signal.aborted) break;

                  if (ttsChunk.type === "audio" && ttsChunk.data) {
                    chunkIndex++;
                    ws.send(
                      JSON.stringify({
                        type: "audio_chunk",
                        sentenceIndex,
                        chunkIndex,
                        data: Buffer.from(ttsChunk.data).toString("base64"),
                      })
                    );
                  }
                }

                ws.send(
                  JSON.stringify({
                    type: "sentence_end",
                    sentenceIndex,
                    text,
                  })
                );
              } catch (ttsErr: any) {
                console.error("Error synthesizing speech chunk:", text, ttsErr);
              }
            }

            isTtsWorkerBusy = false;
            if (ttsQueue.length === 0 && ttsCompletionResolver) {
              ttsCompletionResolver();
              ttsCompletionResolver = null;
            }
          };

          const enqueueTtsChunk = (text: string) => {
            if (abortController.signal.aborted || !text.trim()) return;
            const currentIndex = sentenceCounter++;
            ttsQueue.push({
              sentenceIndex: currentIndex,
              text: text.trim(),
            });
            runTtsWorker();
          };

          // Stream LLM tokens asynchronously and push audio tasks into the pipeline
          for await (const textDelta of streamGenerator) {
            if (abortController.signal.aborted) break;
            if (!textDelta) continue;

            fullResponseText += textDelta;
            textBuffer += textDelta;

            // Transmit text delta to UI instantly for 0ms visual latency
            ws.send(
              JSON.stringify({
                type: "ai_text_delta",
                delta: textDelta,
                fullText: fullResponseText,
                modelUsed,
              })
            );

            // Extract early clauses and sentences
            const { chunks, remainder } = extractSpokenChunks(textBuffer, isFirstChunk);
            if (chunks.length > 0) {
              isFirstChunk = false;
              textBuffer = remainder;
              for (const chunk of chunks) {
                enqueueTtsChunk(chunk);
              }
            }
          }

          // Handle any final remaining trailing words in buffer
          if (!abortController.signal.aborted && textBuffer.trim().length > 0) {
            const finalChunk = textBuffer.replace(/<\/?[a-zA-Z0-9_-]+>/g, "").trim();
            if (finalChunk.length > 0) {
              enqueueTtsChunk(finalChunk);
            }
            textBuffer = "";
          }

          // Wait for all queued audio synthesis tasks to complete
          if (ttsQueue.length > 0 || isTtsWorkerBusy) {
            await new Promise<void>((resolve) => {
              if (ttsQueue.length === 0 && !isTtsWorkerBusy) {
                resolve();
              } else {
                ttsCompletionResolver = resolve;
              }
            });
          }

          if (!abortController.signal.aborted) {
            ws.send(
              JSON.stringify({
                type: "turn_complete",
                fullText: fullResponseText,
                sentenceCount: sentenceCounter,
              })
            );
          }

          isProcessingTurn = false;
        }
      } catch (err: any) {
        const friendlyError = parseApiErrorMessage(err);
        console.error("WS error handling message:", friendlyError);
        ws.send(
          JSON.stringify({
            type: "error",
            error: friendlyError,
          })
        );
      }
    });

    ws.on("close", () => {
      if (currentAbortController) {
        currentAbortController.abort();
      }
    });
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Nelth-Voice backend listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
