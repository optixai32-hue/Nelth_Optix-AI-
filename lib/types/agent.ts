import type {
  InferAgentUIMessage,
  InferUITools,
  ToolLoopAgent,
  UIMessage,
  UIToolInvocation
} from 'ai'

import type { ConnectorTools } from '../tools/connectors'
import type { documentTool } from '../tools/document'
import type { fetchTool } from '../tools/fetch'
import type { createImageGenerationTool } from '../tools/image-generation'
import type { createQuestionTool } from '../tools/question'
import type { createSearchTool } from '../tools/search'
import type { createTodoTools } from '../tools/todo'

// Define the tools type for researcher agent
export type ResearcherTools = {
  search: ReturnType<typeof createSearchTool>
  fetch: typeof fetchTool
  askQuestion: ReturnType<typeof createQuestionTool>
  document: typeof documentTool
  generateImage: ReturnType<typeof createImageGenerationTool>
  gmail: ConnectorTools['gmail']
  drive: ConnectorTools['drive']
  calendar: ConnectorTools['calendar']
  github: ConnectorTools['github']
  notion: ConnectorTools['notion']
} & ReturnType<typeof createTodoTools>

// Type alias for the researcher agent using ToolLoopAgent
// ToolLoopAgent generic signature is <CALL_OPTIONS, TOOLS, OUTPUT>
export type ResearcherAgent = ToolLoopAgent<never, ResearcherTools, never>

// Infer UI message type for researcher agent
export type ResearcherUIMessage = InferAgentUIMessage<ResearcherAgent>

// Infer UI tools type for researcher agent
export type ResearcherUITools = InferUITools<ResearcherTools>

// Tool invocation types for each tool
export type SearchToolInvocation = UIToolInvocation<ResearcherTools['search']>
export type FetchToolInvocation = UIToolInvocation<ResearcherTools['fetch']>
export type QuestionToolInvocation = UIToolInvocation<
  ResearcherTools['askQuestion']
>
export type TodoWriteToolInvocation = UIToolInvocation<
  ResearcherTools['todoWrite']
>

// Union type for all tool invocations
export type ResearcherToolInvocation =
  | SearchToolInvocation
  | FetchToolInvocation
  | QuestionToolInvocation
  | TodoWriteToolInvocation
  | UIToolInvocation<ResearcherTools['gmail']>
  | UIToolInvocation<ResearcherTools['drive']>
  | UIToolInvocation<ResearcherTools['calendar']>
  | UIToolInvocation<ResearcherTools['github']>
  | UIToolInvocation<ResearcherTools['notion']>

// Helper type to extract tool names
export type ResearcherToolName = keyof ResearcherTools

// Type guard functions
export function isSearchToolInvocation(
  invocation: ResearcherToolInvocation
): invocation is SearchToolInvocation {
  return 'query' in (invocation as any).input
}

export function isFetchToolInvocation(
  invocation: ResearcherToolInvocation
): invocation is FetchToolInvocation {
  return 'url' in (invocation as any).input
}

// Response type for agent.respond()
export type ResearcherResponse = Response

// Options type for agent.respond()
export type ResearcherRespondOptions = {
  messages: UIMessage<never, never, ResearcherUITools>[]
}
