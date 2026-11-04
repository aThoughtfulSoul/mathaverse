// Ask Meta Muse AI inspector content (UI-REFINEMENT-SPEC section 7; docs/INTERFACES.md "UI refinement").
// Entry points loaded by the coordinator: the desktop content (inside the shell's DOM inspector frame) and the
// spatial content (inside the shell's XR inspector frame). Both render from AssistantPanelInput through the
// same pure view (view.ts) and emit only UiCommands. Docs: docs/UI-ASSISTANT.md.

export { createAssistantDomContent } from './dom'
export { createAssistantSpatialContent } from './spatial'
export { assistantView, phaseOf, type AssistantView, type AssistantPhase, QUESTION_FIELD_NAME, QUESTION_PLACEHOLDER, MIC_RECORD_NAME } from './view'
export { suggestionsFor, phrasingMode, availableRewrite, type Suggestion } from './suggestions'
export { sourceStatus, responseProvenance, speechStatus, SOURCE_LABEL, SYNTHETIC_ANSWER_LABEL, LIVE_ANSWER_LABEL } from './source'
export { answerFacts, factsForScope, type AnswerFactsView, FACTS_LABEL } from './answerFacts'
