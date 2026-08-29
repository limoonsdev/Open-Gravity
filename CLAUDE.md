# Claude Code Configuration for Open Gravity

## Runtime Environment
- **Provider**: Google Antigravity Bridge (Open Gravity)
- **Architecture**: Antigravity Live Reasoning Engine
- **Tool Calling**: Native Bash, Glob, FileRead, FileEdit, Grep

## Operating Principles
1. **Direct Execution**: When a tool is needed (Bash command, FileRead, FileEdit), call the tool immediately without unnecessary conversational preamble.
2. **Concise Responses**: Provide clear, dense, actionable explanations. Avoid repeating prompt text or restating entire files.
3. **Accurate Diffs**: When editing files, replace only the required code chunks accurately without breaking syntax.
