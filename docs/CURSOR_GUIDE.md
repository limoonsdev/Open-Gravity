# 💻 Guide d'utilisation : Cursor IDE & Continue.dev avec Gravity Bridge

Ce guide explique comment configurer l'éditeur **Cursor IDE** ou l'extension VS Code **Continue.dev** pour utiliser les modèles de votre session Antigravity.

---

## 🖱️ Configuration dans Cursor IDE

1. Lancez **Gravity Bridge** (`npm start`).
2. Ouvrez **Cursor IDE**.
3. Allez dans les paramètres de Cursor : **Cursor Settings** (icône d'engrenage en haut à droite ou `Ctrl + Shift + J`).
4. Cliquez sur l'onglet **Models**.
5. Déroulez la section **OpenAI API Key** :
   - Cochez **Override OpenAI Base URL** : `http://127.0.0.1:8080/v1`
   - Dans le champ **OpenAI API Key**, entrez : `gravity-bridge`
6. Dans la liste des modèles (**Model Names**), ajoutez :
   - `gemini-3.7-flash-high`
   - `claude-sonnet-4-6`
   - `gemini-pro-agent`
7. Cliquez sur **Save**.

Vous pouvez maintenant sélectionner ces modèles directement dans l'inspecteur de chat Cursor (`Ctrl + L` ou `Ctrl + K`) !

---

## 🧩 Configuration dans Continue.dev (VS Code Extension)

Dans votre fichier `~/.continue/config.json` :

```json
{
  "models": [
    {
      "title": "Antigravity Gemini 3.7 Flash High",
      "provider": "openai",
      "model": "gemini-3.7-flash-high",
      "apiBase": "http://127.0.0.1:8080/v1",
      "apiKey": "gravity-bridge"
    },
    {
      "title": "Antigravity Claude Sonnet",
      "provider": "openai",
      "model": "claude-sonnet-4-6",
      "apiBase": "http://127.0.0.1:8080/v1",
      "apiKey": "gravity-bridge"
    }
  ]
}
```
