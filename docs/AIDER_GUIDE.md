# ⚡ Guide d'utilisation : Aider CLI avec Gravity Bridge

**Aider** est l'un des meilleurs outils d'assistance au code en ligne de commande. Grâce à **Gravity Bridge**, vous pouvez utiliser les modèles avancés de votre session Antigravity directement dans Aider sans consommer de crédits API tiers.

---

## 🚀 Lancement avec Aider

### Option 1 : Via l'émulateur OpenAI (Recommandé)

```bash
aider --openai-api-base http://127.0.0.1:8080/v1 \
      --openai-api-key gravity-bridge \
      --model openai/gemini-3.7-flash-high
```

Sous **Windows PowerShell** :
```powershell
aider --openai-api-base http://127.0.0.1:8080/v1 --openai-api-key gravity-bridge --model openai/gemini-3.7-flash-high
```

### Option 2 : Via l'émulateur Anthropic / Claude

```powershell
aider --anthropic-api-base http://127.0.0.1:8080 --anthropic-api-key gravity-bridge --model anthropic/claude-sonnet-4-6
```

---

## 💡 Fichier de configuration permanent `.aider.conf.yml`

Pour ne plus avoir à retaper les arguments à chaque fois, créez un fichier `.aider.conf.yml` à la racine de vos projets :

```yaml
openai-api-base: http://127.0.0.1:8080/v1
openai-api-key: gravity-bridge
model: openai/gemini-3.7-flash-high
stream: true
dark-mode: true
```

Ensuite, lancez simplement :
```bash
aider
```
Aider se connectera immédiatement à votre Gravity Bridge !
