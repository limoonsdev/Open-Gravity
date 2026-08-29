# 🟢 Guide d'utilisation : Codex CLI & Outils OpenAI avec Gravity Bridge

Ce guide explique comment utiliser **Codex CLI**, **OpenCodeInterpreter**, et n'importe quel script ou agent basé sur le SDK OpenAI officiel avec les modèles de votre Antigravity.

---

## 📋 Configuration rapide

Le point d'accès OpenAI émulé par Gravity Bridge est disponible sur :
- **URL de base OpenAI :** `http://127.0.0.1:8080/v1`
- **Clé d'API :** `gravity-bridge`

---

## 🚀 Utilisation avec les variables d'environnement

### Windows PowerShell

```powershell
$env:OPENAI_BASE_URL = "http://127.0.0.1:8080/v1"
$env:OPENAI_API_KEY = "gravity-bridge"

# Exécuter votre outil compatible OpenAI
codex
```

### Linux / macOS / Bash

```bash
export OPENAI_BASE_URL="http://127.0.0.1:8080/v1"
export OPENAI_API_KEY="gravity-bridge"

codex
```

---

## 🐍 Utilisation en Python (SDK OpenAI)

Vous pouvez utiliser le package officiel `openai` en Python pour appeler directement vos modèles Antigravity :

```python
from openai import OpenAI

# Connexion au Gravity Bridge local
client = OpenAI(
    base_url="http://127.0.0.1:8080/v1",
    api_key="gravity-bridge"
)

# Appel de complétion de chat avec streaming
response = client.chat.completions.create(
    model="gemini-3.7-flash-high",  # ou "gpt-4o", "claude-sonnet-4-6"
    messages=[
        {"role": "system", "content": "Tu es un expert en code."},
        {"role": "user", "content": "Écris une fonction rapide de tri en Rust."}
    ],
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
print()
```

---

## 📦 Liste des alias de modèles supportés

Gravity Bridge mappe automatiquement les noms de modèles OpenAI standard :
- `gpt-4o` ➔ `gemini-3.7-flash-high`
- `gpt-4o-mini` ➔ `gemini-3.7-flash-low`
- `gpt-4` / `gpt-4-turbo` ➔ `gemini-pro-agent`
- `o1` / `o3-mini` ➔ `gemini-3.7-flash-high`
- `gpt-oss` ➔ `gpt-oss-120b-medium`
