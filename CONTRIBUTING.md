# Contributing to the Mathaverse

Start with the [README](README.md) and [extension guide](docs/EXTENDING.md). A useful first contribution is a focused improvement to one existing experiment, a reusable recipe, or a clearer explanation of a supported mathematical fact.

For a new domain, define its exact data and operations before its visual presentation. Keep scene layout separate from mathematical meaning. Add supported actions through the validated transaction system, and provide Muse with computed facts and the actions it may request.

Preserve the distinction between computed results, AI explanations and Lean-checked claims. A new formal claim needs a supported checker template and a receipt for the exact inputs. Synthetic replies must remain labelled synthetic.

Run the relevant tests, `npm run typecheck` and `npm run build` before proposing a change. Explain the user-visible behavior and how it was checked. Include screenshots for visual changes when useful, with no API keys or private recordings.

This is an early source release with seven authored experiments. The extension interfaces may change. Open an issue to discuss a large new domain or architectural change before building it.
