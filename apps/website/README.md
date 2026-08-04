# Smaran AI Website

Public landing-page prototype for the Smaran Health clinical memory platform.
The product strategy, safety rules, and roadmap live at the repository root.

This website is a marketing prototype. It does not process real patient data and
must not be treated as the production clinical application.

## Requirements

- Node.js 22.13 or later
- npm

## Local development

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`.

## Validation

```bash
npm run lint
npm run build
```

Automated tests are not configured yet.

## Hosting

The `.openai/hosting.json` file configures optional OpenAI Sites bindings.
Runtime secrets and patient information must never be stored in this repository.
