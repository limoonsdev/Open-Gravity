# 🟣 Guide d'utilisation : Claude Code CLI avec Gravity Bridge

Ce guide vous explique étape par étape comment utiliser l'outil officiel **Claude Code CLI (`claude`)** d'Anthropic en redirigeant 100% de ses requêtes vers les modèles de votre session **Google Antigravity** (Gemini 3.7 Flash High, Gemini Pro Agent, Claude Sonnet, etc.).

---

## 📋 Prérequis

1. **Google Antigravity** ouvert en arrière-plan (l'IDE / application de bureau).
2. **Gravity Bridge** lancé sur votre machine :
   ```bash
   npm start
   # ou
   node dist/index.js start
   ```
3. L'outil **Claude Code CLI** installé :
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

---

## 🚀 Configuration & Lancement

### Option 1 : Windows PowerShell (Recommandé)

Ouvrez un terminal PowerShell et exécutez :

```powershell
# Définir l'URL de base d'Anthropic vers votre Gravity Bridge local
$env:ANTHROPIC_BASE_URL = "http://127.0.0.1:8080"

# Définir la clé d'authentification locale du Bridge
$env:ANTHROPIC_API_KEY = "gravity-bridge"

# Lancer Claude Code
claude
```

### Option 2 : Windows CMD (Invite de commandes)

```cmd
set ANTHROPIC_BASE_URL=http://127.0.0.1:8080
set ANTHROPIC_API_KEY=gravity-bridge
claude
```

### Option 3 : Linux / macOS / Git Bash

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8080"
export ANTHROPIC_API_KEY="gravity-bridge"
claude
```

---

## ⚙️ Comment ça fonctionne sous le capot ?

1. Lorsque vous posez une question ou demandez une modification de code à **Claude Code**, il envoie une requête `POST /v1/messages` avec vos fichiers et instructions.
2. **Gravity Bridge** intercepte la requête au format Anthropic Messages API.
3. Il convertit le schéma (tools, instructions système, historique) et le transmet directement au **Language Server de Google Antigravity**.
4. La réponse générée par votre session Antigravity (avec votre quota et vos modèles Pro) est renvoyée en streaming temps réel (SSE) à Claude Code.

---

## 🎯 Alias & Choix des modèles

Gravity Bridge associe automatiquement les modèles demandés par Claude Code aux meilleurs modèles Antigravity :

| Modèle demandé par Claude Code | Modèle Antigravity utilisé | Description |
|---|---|---|
| `claude-3-7-sonnet` / `claude-3-5-sonnet` | `claude-sonnet-4-6` ou `gemini-3.7-flash-high` | Ultra-rapide avec raisonnement |
| `claude-3-opus` | `claude-opus-4-6-thinking` | Raisonnement profond |
| `claude-3-5-haiku` | `gemini-3.7-flash-low` | Réponses instantanées |

---

## 💡 Astuce : Créer un raccourci de lancement

Créez un script `claude-gravity.bat` sur votre bureau :

```bat
@echo off
set ANTHROPIC_BASE_URL=http://127.0.0.1:8080
set ANTHROPIC_API_KEY=gravity-bridge
claude %*
```

Il vous suffit ensuite de taper `claude-gravity` dans n'importe quel dossier pour coder avec Claude Code propulsé par Antigravity !
