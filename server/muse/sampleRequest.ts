// Prints a sample AssistantRequest for manual calls to POST /api/assistant. The document is the demo
// document (P = diag(1, 1, 0), u selected), or with "order" as the second argument the demo document with
// the prepared operation-order comparison committed (R then S versus S then R, e1 selected). Usage:
//   npx vite-node server/muse/sampleRequest.ts "Show me what this transformation loses" > req.json
//   npx vite-node server/muse/sampleRequest.ts "Reverse the order on the left" order > req.json
//   curl -s -X POST http://localhost:3010/api/assistant -H 'content-type: application/json' --data @req.json
// Without META_API_KEY the answer is a labelled synthetic fixture (source "synthetic").

import type { AssistantRequest } from '../../src/workspace/actions'
import { demoDocument, docToJson } from '../../src/workspace/document'
import { Workspace } from '../../src/workspace/reducer'
import { orderDemoActions } from '../../src/demo/order'

const base = demoDocument()
const doc = process.argv[3] === 'order' ? new Workspace(base).commit({ baseRevision: 0, actions: orderDemoActions(base) }).doc : base
const body: AssistantRequest = {
  requestId: `req-${Date.now()}`,
  workspaceId: doc.workspaceId,
  baseRevision: doc.revision,
  prompt: process.argv[2] ?? 'Show me what this transformation loses',
  context: { contextVersion: 1, document: docToJson(doc), evidence: [] },
}
process.stdout.write(`${JSON.stringify(body)}\n`)
