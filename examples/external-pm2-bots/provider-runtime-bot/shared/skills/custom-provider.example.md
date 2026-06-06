---
name: custom-provider-example
description: Example custom skill for external providers. Copy and modify for your use case.
---

# Custom Provider Skill (Example)

This is an example custom skill file. Copy this file and modify it for your provider.

## How to use

1. Copy this file to a location outside the bot directory:
   ```bash
   cp skills/custom-provider.example.md /path/to/my-custom-skill.md
   ```

2. Edit the copied file with your custom instructions.

3. Set in your .env:
   ```
   PROVIDER_CUSTOM_SKILL_PATH=/path/to/my-custom-skill.md
   ```

4. The bot will load your custom skill AFTER the base safety rules and type skill.

## What to put here

- Company-specific review standards
- Preferred tools and frameworks
- Output format preferences
- Domain-specific rules not covered by the type skill
- Client-specific requirements

## What NOT to put here

- Instructions to sign transactions
- Instructions to bypass JSON validation
- Private keys, API keys, or secrets
- Instructions that contradict the base safety rules

The base safety rules (erc8183-provider.md) always take precedence.
If this file contains conflicting instructions, the bot ignores them.
