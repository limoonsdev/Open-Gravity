# Open Gravity : guide en français

Open Gravity est un **routeur IA local** : un seul point d'accès (`http://127.0.0.1:18080`) pour tous vos modèles, avec combos de secours, rotation de clés, statistiques et un panel web, le tout dans **un seul exécutable**.

Vos outils (Claude Code, Codex, Gemini CLI, OpenCode, Cursor, Cline, Aider, SDK…) gardent leur protocole habituel ; Open Gravity traduit à la volée entre **OpenAI Chat**, **Anthropic Messages**, **OpenAI Responses** et **Gemini**, y compris le streaming, les appels d'outils, le raisonnement et les images.

---

## 1. Installation

### Exécutable (recommandé)

1. Téléchargez `open-gravity-win-x64.exe` depuis les [Releases](https://github.com/limoonsdev/Open-Gravity/releases) ou dans les artefacts du dernier [build GitHub Actions](https://github.com/limoonsdev/Open-Gravity/actions/workflows/build.yml).
2. Double-cliquez dessus. Une console s'ouvre, le routeur démarre et le panel s'ouvre dans le navigateur.
3. Si Windows SmartScreen affiche un avertissement (application non signée) : *Informations complémentaires → Exécuter quand même*.

Il existe aussi des exécutables pour Linux (`open-gravity-linux-x64`) et macOS (`open-gravity-macos-arm64`).

### Depuis les sources

```bash
git clone https://github.com/limoonsdev/Open-Gravity.git
cd Open-Gravity
npm install
npm start
```

Pour générer vous-même le `.exe` : `npm run exe:win`. Il se trouvera dans `release/` (fonctionne aussi depuis Linux ou macOS).

---

## 2. Ajouter un fournisseur

Dans le panel : **Providers → Add provider**, choisissez le fournisseur et collez votre clé API.

- **Gratuit pour commencer** : Google Gemini (AI Studio), OpenRouter (modèles `:free`), Groq, Cerebras, NVIDIA NIM, GitHub Models.
- **En local, sans clé** : Ollama, LM Studio.
- **Antigravity** : utilise l'application Google Antigravity ouverte et connectée sur votre PC (texte uniquement).
- **Personnalisé** : n'importe quel point d'accès compatible OpenAI, Anthropic ou Gemini.

Vous pouvez coller **plusieurs clés** (une par ligne) : elles seront utilisées à tour de rôle et mises en pause automatiquement si elles tombent en limite de débit ou en erreur.

La liste des modèles est récupérée automatiquement. Le bouton **Test** envoie un mini-message pour vérifier la clé.

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

Définissez votre combo préféré comme **route par défaut** (page *Models & routing*).

---

## 5. Brancher vos outils

La page **Integrations** configure automatiquement (avec sauvegarde et restauration) : Claude Code, Codex CLI, OpenCode, Gemini CLI, Qwen Code et Aider. Elle fournit aussi des extraits prêts à copier pour Cline, Roo Code, Kilo Code, Continue, Cursor, Zed et les SDK.

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

### Cursor

Cursor appelle les points d'accès personnalisés depuis ses propres serveurs : `localhost` n'est donc pas joignable. Exposez le routeur via un tunnel (cloudflared, ngrok…) et créez une clé API dans la page *API keys*.

---

## 6. Suivi et statistiques

- **Overview** : requêtes, taux de succès, jetons (dont cache et raisonnement), coût estimé, latence et temps jusqu'au premier jeton, graphiques par heure ou par jour, top modèles et fournisseurs.
- **Requests** : journal en direct. Cliquez une ligne pour voir chaque tentative (fournisseur, clé, statut, erreur). Activez *Capture request bodies* dans *Settings* pour inspecter les requêtes et réponses complètes (gardées en mémoire, 50 dernières).
- **Playground** : discutez avec n'importe quel modèle ou combo en passant par le routeur.

Les coûts sont **estimés** à partir des prix publics ; les offres gratuites et remises ne sont pas prises en compte.

---

## 7. Sécurité

- Par défaut, le routeur n'écoute que sur `127.0.0.1` (votre PC).
- Les requêtes venant d'autres machines ou de sites web exigent une **clé API du routeur** (page *API keys*).
- Un **mot de passe** peut protéger le panel ; il est obligatoire pour y accéder depuis une autre machine.
- Les clés des fournisseurs restent dans `%USERPROFILE%\.open-gravity\config.json` et ne sont jamais renvoyées au navigateur.

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

Les données sont dans `~/.open-gravity/` : `config.json` (configuration, rechargée à chaud si vous l'éditez), `usage/` (historique), `backups/` (anciennes configurations des outils).
