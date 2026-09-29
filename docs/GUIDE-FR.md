# Open Gravity : guide en français

Open Gravity est un **routeur IA local** et une **application de bureau** : un seul point d'accès (`http://127.0.0.1:18080`) pour tous vos modèles, avec combos de secours, rotation de clés, APIs gratuites, économiseur de jetons, quotas, statistiques complètes et un tableau de bord, le tout dans **un seul fichier**.

Vos outils (Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Cline, Aider, VS Code Copilot, Open WebUI, SDK…) gardent leur protocole habituel ; Open Gravity traduit à la volée entre **OpenAI Chat**, **Anthropic Messages**, **OpenAI Responses**, **Gemini**, **Ollama** et l'ancienne API **Completions**, y compris le streaming, les appels d'outils, le raisonnement et les images.

Points forts :

- **Application de bureau en un seul fichier** (`OpenGravity.exe`) : fenêtre native aux bords arrondis (Windows 11), icône dans la barre des tâches, démarrage avec l'ordinateur, guide *Get started*. Le routeur est **à l'intérieur** : rien d'autre à installer.
- **Hub des APIs gratuites** : toutes les offres gratuites officielles réunies, les modèles `:free` d'OpenRouter découverts en direct, et un combo **`free`** en un clic qui enchaîne tout ce qui est gratuit.
- **Économiseur de jetons et compaction** automatiques, **quotas et budgets**, **statistiques complètes** (latence, vitesse, cache, applis clientes, projection du mois…).
- **Compatible avec tous les IDE**, même inconnus : détection automatique des clients, chemins Azure, LM Studio, `POST /` avec détection du protocole, images / audio / rerank, et **autocomplétion FIM** sur n'importe quel modèle.
- **105 fournisseurs prêts à l'emploi** (cloud, passerelles, fournisseurs chinois, 17 moteurs locaux) et une **base de 3 500+ modèles** (fenêtre de contexte, sortie max, outils, vision, prix), plus n'importe quel point d'accès compatible OpenAI / Anthropic / Gemini / Responses.
- **Appels d'outils automatiques** : si un modèle ne sait pas appeler d'outils, Open Gravity les **émule** (description dans le prompt, blocs `<tool_call>` reconvertis en vrais appels d'outils pendant le streaming). Claude Code et Codex fonctionnent alors normalement sur ce modèle.
- **Compatibilité auto-réparatrice** : quand un fournisseur refuse une requête (outils, paramètre inconnu, `max_tokens` trop grand, rôle system, images, mode JSON…), la requête est corrigée, relancée immédiatement, et la correction est mémorisée.

---

## 1. Installation

### Application de bureau (recommandé)

1. Téléchargez `OpenGravity-win-x64.exe` (ou l'installateur `Open-Gravity_3.0.0_x64-setup.exe`) depuis les [Releases](https://github.com/limoonsdev/Open-Gravity/releases) ou dans les artefacts du dernier [build GitHub Actions](https://github.com/limoonsdev/Open-Gravity/actions/workflows/build.yml) (artefact `open-gravity-desktop-win-x64`).
2. Double-cliquez dessus : un écran de démarrage s'affiche, le routeur intégré démarre, puis le guide **Get started** s'ouvre dans la fenêtre de l'application.
3. Si Windows SmartScreen affiche un avertissement (application non signée) : *Informations complémentaires → Exécuter quand même*.

Fermer la fenêtre laisse le routeur tourner dans la **zone de notification** (vos outils continuent de fonctionner) ; *Quitter* depuis l'icône l'arrête. *Settings → Desktop app* permet de lancer Open Gravity avec l'ordinateur ou de quitter à la fermeture. L'application utilise Microsoft Edge WebView2, déjà présent sur Windows 10 et 11.

Versions Linux (`OpenGravity-linux-x64`, `.deb`, `.AppImage`) et macOS (`OpenGravity-macos-arm64`, `.dmg`) disponibles aussi.

### Version ligne de commande

`open-gravity-win-x64.exe` (ou `open-gravity-linux-x64`, `open-gravity-macos-arm64`) contient le routeur seul ; le tableau de bord s'ouvre dans votre navigateur. Pratique sur un serveur ou dans Docker.

### Depuis les sources

```bash
git clone https://github.com/limoonsdev/Open-Gravity.git
cd Open-Gravity
npm install
npm start
```

Pour générer vous-même le `.exe` en ligne de commande : `npm run exe:win` (dans `release/`, fonctionne aussi depuis Linux ou macOS). Pour l'application de bureau : `npm run desktop` (Rust requis ; sous Windows, les outils de compilation MSVC).

---

## 1 bis. Premier démarrage : Get started

Le guide s'ouvre au premier lancement (et à tout moment avec **Ctrl+K → Get started guide**) :

1. **Fournisseurs** : les moteurs locaux déjà lancés (Ollama, LM Studio, llama.cpp, vLLM, Jan…) sont **détectés** et ajoutés en un clic ; les offres gratuites (Gemini, Groq, OpenRouter, Cerebras, GitHub Models, Mistral, NVIDIA, Pollinations…) et les API populaires demandent juste une clé.
2. **Route** : choisissez le modèle par défaut : le combo **`free`**, une chaîne de secours sur tous vos fournisseurs, ou un seul modèle.
3. **Outils** : Claude Code, Codex, OpenCode, Gemini CLI, Qwen Code et Aider se configurent en un clic ; les adresses universelles (OpenAI, Anthropic, Gemini, Ollama) sont prêtes à copier pour tout le reste.
4. **Terminé** : envoyez un message de test et ouvrez le tableau de bord.

---

## 2. Ajouter un fournisseur

Dans le panel : **Providers → Add provider**, choisissez le fournisseur et collez votre clé API.

- **Gratuit pour commencer** : voir la page **Free APIs** (section 2 bis).
- **En local, sans clé** : Ollama, LM Studio.
- **Cloud et entreprise** : Azure OpenAI (nom de ressource demandé), Amazon Bedrock (région), Vertex AI, Cloudflare Workers AI (ID de compte), Databricks, Cohere, SambaNova, Together, Fireworks, Nebius, Novita, Scaleway, OVHcloud…
- **Chine** : Qwen/DashScope, Zhipu GLM, Kimi, Doubao (Volcengine), Qianfan, Hunyuan, SiliconFlow, ModelScope…
- **Moteurs locaux** : Ollama, LM Studio, llama.cpp, vLLM, SGLang, TGI, LocalAI, Jan, KoboldCpp, text-generation-webui, Xinference, GPT4All, Lemonade, Docker Model Runner, MLX, llamafile, Msty.
- **Antigravity** : utilise l'application Google Antigravity ouverte et connectée sur votre PC (les appels d'outils sont émulés automatiquement).
- **Personnalisé** : n'importe quel point d'accès compatible OpenAI, Anthropic, Gemini ou Responses. Dans l'onglet *General* du fournisseur, vous pouvez choisir le mode d'authentification (Bearer, `x-api-key`, `api-key`, en-tête personnalisé avec préfixe, aucune) et le mode d'appel d'outils.

Vous pouvez coller **plusieurs clés** (une par ligne) : elles seront utilisées à tour de rôle et mises en pause automatiquement si elles tombent en limite de débit ou en erreur.

La liste des modèles est récupérée automatiquement. Le bouton **Test** envoie un mini-message pour vérifier la clé. Chaque modèle affiche ses capacités connues (contexte, vision, raisonnement, outils émulés).

### Appels d'outils (tool calling)

Onglet *General* d'un fournisseur → **Tool calling** :

- **Auto** (recommandé) : outils natifs ; si la base de modèles indique que le modèle n'en a pas, ou si le fournisseur refuse le champ `tools`, Open Gravity bascule sur l'émulation et s'en souvient.
- **Native only** : jamais d'émulation.
- **Always emulate** : toujours émuler (utile pour des serveurs qui acceptent `tools` mais les ignorent).

Dans tous les cas, les arguments d'outils mal formés (JSON cassé, mauvais types, nom d'outil mal écrit) sont réparés, et les balises `<think>` deviennent de vrais blocs de raisonnement.

### Corrections apprises

L'onglet **Compatibility** de chaque fournisseur (et *Settings → Compatibility & performance*) liste les corrections apprises par modèle (outils émulés, paramètre retiré, sortie plafonnée, rôle system fusionné…). Le bouton *Reset* les oublie.

---

## 2 bis. Les APIs gratuites

La page **Free APIs** réunit ce que chaque fournisseur offre gratuitement, avec un lien vers sa page officielle des limites (elles changent souvent) :

| Type | Fournisseurs |
|---|---|
| Palier gratuit | Google Gemini (AI Studio), Groq, Cerebras, GitHub Models, Mistral (offre *Experiment*), Cloudflare Workers AI, Cohere (clé d'essai), Ollama Cloud, ModelScope |
| Modèles gratuits | modèles `:free` d'OpenRouter (découverts en direct), Z.ai GLM-4.5-Flash, Zhipu GLM-4-Flash, SiliconFlow, Baidu ERNIE Speed/Lite, Tencent Hunyuan-lite, iFlytek Spark Lite, OpenCode Zen |
| Crédits gratuits | NVIDIA NIM, SambaNova, Vercel AI Gateway, Hugging Face, Scaleway |
| Sans clé | Pollinations, LLM7, OVHcloud AI Endpoints (API publiques à débit limité) |
| En local | Ollama, LM Studio, llama.cpp, vLLM, Jan… (gratuit et privé, selon votre machine) |

**Build my free combo** crée le modèle **`free`** : les meilleurs paliers gratuits d'abord, répartis entre fournisseurs pour qu'un quota épuisé ne vous bloque pas, les moteurs locaux en dernier recours. Cochez *Also make it the default route* pour que tous vos outils l'utilisent.

> Open Gravity n'utilise que des offres officielles et des API publiques prévues pour ça. Il ne « datamine » pas les requêtes privées de sites tiers pour en récupérer l'accès : c'est contraire à leurs conditions, cela consomme le quota de quelqu'un d'autre et cesse de fonctionner au bout de quelques jours.

---

## 3. Nommer les modèles

Dans vos outils, le champ `model` peut contenir :

| Forme | Exemple | Effet |
|---|---|---|
| combo | `coding` | essaie chaque cible du combo |
| `fournisseur/modèle` | `openrouter/qwen/qwen3-coder` | va directement chez ce fournisseur |
| modèle seul | `gpt-5` | n'importe quel fournisseur qui propose ce modèle |
| alias | `claude-3-5-haiku` | redirigé selon vos alias (jokers `*` acceptés) |
| inconnu ou vide | `claude-sonnet-4-5` | route par défaut (si l'option est activée) |

L'outil **Route tester** (page *Models & routing*) montre exactement où partira un nom de modèle.

---

## 4. Les combos

Un combo est un **modèle virtuel** : une liste ordonnée de cibles.

Exemple `coding` :

```
anthropic/claude-sonnet-4-5 → openrouter/qwen/qwen3-coder → gemini/gemini-2.5-pro
```

Si Claude est limité (429), en panne (5xx) ou trop lent, la requête bascule sur Qwen, puis sur Gemini, **sans que votre outil ne voie d'erreur**. Même une erreur survenant *au début du flux* déclenche le basculement : le routeur n'envoie la réponse au client qu'une fois le premier jeton reçu.

Stratégies :

- **Fallback** : toujours dans l'ordre (le plus courant).
- **Round-robin** : répartit la charge en changeant de première cible à chaque requête.
- **Random** : ordre aléatoire à chaque requête.
- **Fastest** : la cible la plus rapide d'abord (temps jusqu'au premier jeton mesuré en continu).
- **Cheapest** : la cible la moins chère d'abord (prix de la base de modèles ; les modèles locaux sont gratuits).
- **Race** : interroge les deux premières cibles en même temps, la plus rapide gagne et l'autre est annulée (plus rapide, mais consomme plus de jetons).

Définissez votre combo préféré comme **route par défaut** (page *Models & routing*).

---

## 5. Brancher vos outils

La page **Integrations** (41 intégrations, les outils installés sont **détectés**) configure automatiquement, avec sauvegarde et restauration : Claude Code, Codex CLI, OpenCode, Gemini CLI, Qwen Code et Aider. Pour tous les autres (Continue, Cline, Roo Code, Kilo Code, Zed, Cursor, JetBrains AI, Xcode, Android Studio, Neovim, Emacs, Open WebUI, LobeChat, n8n, LangChain, LlamaIndex, SDK…), elle fournit la configuration prête à copier.

**Outil inconnu ?** Utilisez l'une des adresses universelles : `http://127.0.0.1:18080/v1` (OpenAI), `http://127.0.0.1:18080` (Anthropic, Gemini, Ollama, Azure). Open Gravity accepte aussi `POST /` en détectant le protocole, les chemins Azure (`/openai/deployments/…`), LM Studio (`/api/v0`), Gemini OpenAI (`/v1beta/openai`), et transmet images, audio, embeddings et rerank.

**Autocomplétion (FIM)** : Continue, Twinny, llama.vim et les autres extensions d'autocomplétion fonctionnent via `/v1/completions` (avec `suffix`), `/v1/fim/completions`, `/infill` ou l'API Ollama. Codestral, DeepSeek, Ollama et llama.cpp utilisent leur FIM natif ; tout autre modèle de chat est émulé automatiquement.

Encore plus simple, sans toucher à aucun fichier :

```bash
open-gravity claude     # lance Claude Code relié au routeur
open-gravity codex      # lance Codex relié au routeur
```

### Claude Code à la main (PowerShell)

```powershell
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:18080"
$env:ANTHROPIC_AUTH_TOKEN = "open-gravity"
$env:ANTHROPIC_MODEL = "coding"
$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = "fast"
claude
```

### Codex (`~/.codex/config.toml`)

```toml
model = "coding"
model_provider = "open-gravity"

[model_providers.open-gravity]
name = "Open Gravity"
base_url = "http://127.0.0.1:18080/v1"
wire_api = "responses"
```

### VS Code Copilot, Open WebUI et applications Ollama

Open Gravity répond aussi comme un serveur **Ollama** (`/api/chat`, `/api/tags`, `/api/show`…). Dans VS Code Copilot Chat : *Manage Models → Ollama* avec l'adresse `http://127.0.0.1:18080`. Dans Open WebUI ou Msty : URL Ollama `http://127.0.0.1:18080`. Tous vos modèles cloud apparaissent alors comme des modèles Ollama.

### Cursor

Cursor appelle les points d'accès personnalisés depuis ses propres serveurs : `localhost` n'est donc pas joignable. Exposez le routeur via un tunnel (cloudflared, ngrok…) et créez une clé API dans la page *API keys*.

---

## 6. Suivi et statistiques

- **Overview** : requêtes, taux de succès, jetons, coût estimé et projection du mois, jetons économisés, latence, top modèles, fournisseurs et applications clientes, santé des fournisseurs, requêtes en direct.
- **Analytics** : latence p50/p95, temps jusqu'au premier jeton, vitesse de sortie, part du cache de prompt, secours utilisés, outils émulés, corrections automatiques ; détail par modèle, fournisseur, clé, application cliente (Claude Code, Cursor, Codex… reconnus automatiquement), clé du routeur, point d'accès et combo ; carte jour × heure ; codes d'erreur ; dépenses du jour, du mois et projection ; export CSV. Chaque graphique a une vue tableau.
- **Requests** : journal en direct. Cliquez une ligne pour voir chaque tentative (fournisseur, clé, statut, erreur). Activez *Capture request bodies* dans *Settings* pour inspecter les requêtes et réponses complètes (gardées en mémoire, 50 dernières).
- **Playground** : discutez avec n'importe quel modèle ou combo en passant par le routeur.

Les coûts sont **estimés** à partir des prix publics de la base de modèles ; les offres gratuites et remises ne sont pas prises en compte. Dans *Requests*, les badges indiquent les requêtes aux **outils émulés**, **corrigées automatiquement** (*auto-fixed*) ou servies depuis le **cache**.

### Quotas et budgets

Page **Quotas & limits** :

- **Budgets & limits** : fixez des limites par fournisseur, clé, modèle, clé du routeur, application ou globales, en requêtes, jetons ou dollars, par minute, heure, jour, semaine ou mois. Action *Block* (réponse 429 avant tout appel) ou *Warn* (alerte seulement). Exemples : 5 $ par jour sur Anthropic, 1 000 requêtes par jour sur un palier gratuit, 2 M de jetons par semaine pour Claude Code.
- **Provider rate limits** : les limites annoncées par les fournisseurs dans leurs en-têtes (requêtes et jetons restants, remise à zéro). Une clé épuisée est **sautée avant** de faire échouer une requête.
- **Balances** : solde du compte chez OpenRouter, DeepSeek, Kimi, SiliconFlow et les passerelles one-api.
- **Alerts** : alertes à 80 % et 100 % de chaque limite.

### Économiseur de jetons

Les agents renvoient toute la conversation à chaque tour. La page **Token saver** réduit ce qui part vers le fournisseur :

- **Réduction** : anciennes sorties d'outils trop longues raccourcies (début et fin gardés), doublons supprimés, JSON minifié, espaces compactés, anciennes images et anciens raisonnements retirés.
- **Compaction** : quand la conversation approche de la fenêtre de contexte du modèle, les anciens tours sont remplacés par un résumé (instantané et gratuit, ou écrit par le modèle de votre choix et mis en cache).

Les derniers tours, le prompt système et la tâche ne sont jamais modifiés, et les changements se font par paliers de 8 messages pour que le cache de prompt des fournisseurs continue de fonctionner. Modes : *Off*, *Safe* (par défaut), *Balanced*, *Aggressive* ou *Custom*. Le **simulateur** teste chaque mode sur une vraie requête, et le **calculateur** estime l'économie mensuelle selon votre usage.

*Settings → Compatibility & performance* permet aussi d'activer un **cache de réponses** (requêtes identiques servies instantanément) et de mettre à jour la **base de modèles** (automatique chaque semaine).

---

## 7. Sécurité

- Par défaut, le routeur n'écoute que sur `127.0.0.1` (votre PC).
- Les requêtes venant d'autres machines ou de sites web exigent une **clé API du routeur** (page *API keys*).
- Un **mot de passe** peut protéger le panel ; il est obligatoire pour y accéder depuis une autre machine.
- Les clés des fournisseurs restent dans `%USERPROFILE%\.open-gravity\config.json` et ne sont jamais renvoyées au navigateur.
- Dans l'application de bureau, seule l'adresse locale du routeur peut s'afficher dans la fenêtre ; les autres liens s'ouvrent dans votre navigateur.

---

## 8. Commandes

```
open-gravity                    démarre le routeur et ouvre le panel
open-gravity --port 8080        choisit le port
open-gravity --host 0.0.0.0     accessible sur le réseau local (clé API requise)
open-gravity claude / codex     lance l'outil relié au routeur
open-gravity setup codex        configure un outil depuis le terminal
open-gravity doctor             teste la configuration et chaque fournisseur
open-gravity key create laptop  crée une clé API
```

Dans la console du routeur : `open`, `claude`, `codex`, `models`, `status`, `quit`.

Relancer l'exécutable alors qu'il tourne déjà ouvre simplement le panel de l'instance existante.

---

## 9. Dépannage

| Problème | Solution |
|---|---|
| « No provider is configured yet » | Ajoutez un fournisseur dans le panel |
| « Model … is not routable » | Utilisez `fournisseur/modèle`, un combo, ou définissez une route par défaut |
| Tout échoue en 401 | Clé invalide : bouton *Test* sur la clé, puis *Clear pauses & errors* |
| « All matching provider keys are cooling down » | Toutes les clés sont en pause après des erreurs : patientez ou réinitialisez-les |
| Port déjà utilisé | Open Gravity prend automatiquement le port suivant, ou utilisez `--port` |
| Derrière un proxy d'entreprise | *Settings → Network → Upstream HTTP proxy* |
| « does not support tools » / l'agent n'utilise pas les outils | Laissez *Tool calling* sur *Auto* (ou choisissez *Always emulate*) dans l'onglet *General* du fournisseur |
| Une correction apprise ne convient plus (modèle mis à jour) | Onglet *Compatibility* du fournisseur → *Reset* |
| « Budget reached » (429) | Une limite de *Quotas & limits* est atteinte : augmentez-la, passez-la en *Warn* ou attendez la période suivante |
| L'application de bureau affiche une erreur au démarrage | *Show logs* sur l'écran de démarrage, puis *Try again* ; si un autre programme utilise le port 18080, changez le port dans *Settings → Server* |
| L'application ne s'ouvre pas sous Windows | Installez le runtime Microsoft Edge WebView2 (déjà présent sur Windows 10/11 à jour) ; sinon le tableau de bord s'ouvre dans le navigateur |
| Où est passée la fenêtre ? | Elle est dans la zone de notification (icône Open Gravity) : clic sur l'icône → *Open Open Gravity* |

Les données sont dans `~/.open-gravity/` : `config.json` (configuration, rechargée à chaud si vous l'éditez), `usage/` (historique), `backups/` (anciennes configurations des outils). *Settings → Backup* exporte et importe toute la configuration.
