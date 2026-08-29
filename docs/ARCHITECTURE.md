# 🏛️ Architecture Technique de Gravity Bridge

Gravity Bridge agit comme une passerelle universelle de proxy inverse et de traduction de protocoles entre les modèles de l'écosystème **Google Antigravity** et n'importe quel agent tiers (**Claude Code**, **Codex**, **Aider**, **Cursor**, etc.).

---

## 🗺️ Diagramme d'Architecture

```
 +-------------------------------------------------------------------------+
 |                               CLIENTS AI                                |
 |   Claude Code CLI  •  Codex CLI  •  Aider  •  Cursor  •  Continue.dev   |
 +-------------------------------------------------------------------------+
                    |                                     |
    Anthropic API   | (/v1/messages)      OpenAI API      | (/v1/chat/completions)
                    v                                     v
 +-------------------------------------------------------------------------+
 |                             GRAVITY BRIDGE                              |
 |   - Routeur HTTP & Auth Middleware                                      |
 |   - ProtocolConverter (OpenAI <-> Anthropic <-> Gemini <-> Antigravity)  |
 |   - Live SSE Streaming Engine                                           |
 |   - Web Dashboard & Real-time Metrics Inspector (/dashboard)           |
 +-------------------------------------------------------------------------+
                    |                                     |
    Zero-Config     | (Connect-RPC & agentapi)            | Direct API Fallback
    Auto-Discovery  |                                     | (GEMINI_API_KEY)
                    v                                     v
 +-------------------------------------+  +--------------------------------+
 | GOOGLE ANTIGRAVITY LANGUAGE SERVER  |  | GOOGLE AI STUDIO / VERTEX AI   |
 | - Local daemon (language_server.exe)|  | - generativelanguage.googleapis|
 | - Authentification session Pro      |  | - SSE streamGenerateContent    |
 | - Accès 28+ modèles connectés       |  +--------------------------------+
 +-------------------------------------+
```

---

## 🔑 Composants Clés

### 1. `AntigravityDiscovery` (`src/engines/discovery.ts`)
- Détecte automatiquement les processus `language_server.exe` ou Antigravity actifs.
- Récupère dynamiquement les arguments de démarrage, notamment le token CSRF `--csrf_token` et les ports d'écoute TCP.
- Effectue un contrôle de santé (`/healthz`) avec le header de sécurité requis `x-codeium-csrf-token`.

### 2. `AntigravityCore` (`src/engines/antigravity-core.ts`)
- Interface avec les services gRPC/Connect-RPC internes du Language Server (`exa.language_server_pb.LanguageServerService`).
- Récupère la liste dynamique des modèles disponibles, les quotas et l'état utilisateur via `GetAvailableModels` et `GetUserStatus`.
- Exécute les requêtes de génération via l'interface locale `agentapi` ou les RPC du daemon.

### 3. `ProtocolConverter` (`src/engines/converter.ts`)
- Assure la conversion bidirectionnelle sans perte des messages, rôles (`system`, `user`, `assistant`, `tool`), contextes multimodaux (images base64/url), appels de fonctions/outils (`tool_calls`, `tool_use`), et tokens de pensée (`thinkingConfig`).

### 4. `RequestRouter` (`src/engines/router.ts`)
- Achemine intelligemment les requêtes vers le meilleur moteur disponible (moteur direct haute vitesse ou moteur Antigravity local).
- Assure le streaming SSE fluide conforme aux spécifications exactes d'OpenAI (`chat.completion.chunk`) et d'Anthropic (`content_block_delta`, `message_delta`).

### 5. `Web Dashboard` (`src/web/index.html`)
- Interface moderne avec graphiques de latence, statistiques de requêtes et de tokens, explorateur de modèles, testeur de prompt (Playground) et flux de logs en temps réel.
