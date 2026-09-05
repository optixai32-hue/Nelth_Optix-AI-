<div align="center">

# Nelth-IA

Your AI assistant for answers, documents, mail and calendar — with your apps connected (Google Drive, Gmail, Calendar, GitHub, Notion).

[![GitHub](https://img.shields.io/badge/GitHub-Nelth_Optix--AI--181717.svg?logo=github)](https://github.com/optixai32-hue/Nelth_Optix-AI-)

</div>

## Features

- AI-powered search with grounded, cited answers
- Generative UI — answers render rich inline components (source-credited images, grids, headings) live from a streamed JSON spec, beyond plain markdown
- Search modes: Quick and Adaptive
- Model selector with dynamic provider detection (OpenAI, Anthropic, Google, Ollama, Vercel AI Gateway, OpenAI-compatible providers)
- Multiple search providers (Tavily, SearXNG, Brave, Exa)
- Chat history stored in PostgreSQL
- Share search results with unique URLs
- File upload support
- User authentication with Supabase Auth
- Guest mode for anonymous usage
- Docker deployment ready

## Installation

### Docker (Recommended)

The quickest way to run Nelth-IA locally:

```bash
git clone https://github.com/optixai32-hue/Nelth_Optix-AI-.git
cd Nelth_Optix-AI-
```

Then set up with Docker Compose:

1. Clone the repository and configure environment:

```bash
cd Nelth_Optix-AI-
cp .env.local.example .env.local
```

2. Edit `.env.local` and set at least one AI provider API key:

```bash
OPENAI_API_KEY=your_openai_key
```

See [supported providers](./docs/CONFIGURATION.md#supported-providers) for other options (Anthropic, Google, Ollama, Vercel AI Gateway, OpenAI-compatible providers).

3. Start all services:

```bash
docker compose up -d
```

4. Visit http://localhost:3000 and select your model from the model selector.

Docker Compose starts PostgreSQL, Redis, SearXNG, and Nelth-IA automatically. No additional search API key is needed — SearXNG is included.

See the [Docker Guide](./docs/DOCKER.md) for more options including building from source and file upload configuration.

### Local Development

1. Clone and install:

```bash
cd Nelth_Optix-AI-
bun install
```

2. Configure environment:

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and set your API keys:

```bash
OPENAI_API_KEY=your_openai_key
TAVILY_API_KEY=your_tavily_key
```

To enable chat history, authentication, file upload, and other features, see [CONFIGURATION.md](./docs/CONFIGURATION.md).

3. Start the dev server:

```bash
bun dev
```

Visit http://localhost:3000.

## Deploy

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Foptixai32-hue%2FNelth_Optix-AI-&env=GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,APP_BASE_URL,CONNECTORS_ENCRYPTION_KEY)

## Contributing

We welcome contributions! Please see our [Contributing Guide](CONTRIBUTING.md) for details on how to get started, including local development setup.

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE](LICENSE) file for details.

