import type { SurveyChoiceSet } from "@/lib/chatbot/domain"
import { logChatbotBoundaryEvent } from "@/lib/chatbot/server/boundary-event-log"
import { redactForChatbotLog } from "@/lib/chatbot/server/log-redaction"

/**
 * Maps a free-text answer to the choice panel currently shown, so a typed answer can skip the
 * model turn just like a clicked one. Returns null whenever the mapping is not confident; the
 * caller then keeps the normal LLM path.
 */
export type ChatbotChoiceInterpreter = (input: {
  requestId?: string
  choiceSet: SurveyChoiceSet
  message: string
}) => Promise<{ choiceIds: string[] } | null>

const typesafeEndpoint = "https://api.typesafe.ai/v1/systemone"
const typesafeModel = "jev-latest"
const requestTimeoutMs = 3_000
const minimumConfidence = 0.8
const minimumOptionProbability = 0.7
const notAnAnswer = "not_an_answer"
const excludedChoiceIds = new Set(["other"])

type JevAnswer = { choice?: unknown; confidence?: unknown; noul?: unknown }

export const interpretChoiceWithJev: ChatbotChoiceInterpreter = async (input) => {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!apiKey) return null
  const options = input.choiceSet.choices.filter((choice) => !excludedChoiceIds.has(choice.id))
  if (options.length === 0) return null

  const multiple = input.choiceSet.selectionMode === "multiple"
  const questions = buildQuestions(input.choiceSet.question, options, multiple)
  const startedAt = Date.now()
  let decision: "adopted" | "abstained" | "failed" = "failed"
  let reason = "unknown"
  try {
    const response = await fetch(typesafeEndpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: typesafeModel,
        state: { question: input.choiceSet.question, customer_answer: redactForChatbotLog(input.message) },
        questions,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs),
    })
    if (!response.ok) {
      reason = `http-${response.status}`
      return null
    }
    const answers = ((await response.json()) as { answers?: Record<string, JevAnswer> }).answers ?? {}
    const choiceIds = multiple ? readMultiple(answers, options) : readSingle(answers, options)
    if (!choiceIds) {
      decision = "abstained"
      reason = "low-confidence-or-not-an-answer"
      return null
    }
    decision = "adopted"
    reason = "confident-choice"
    return { choiceIds }
  } catch (error) {
    reason = error instanceof Error && error.name === "TimeoutError" ? "timeout" : "transport-error"
    return null
  } finally {
    logChatbotBoundaryEvent({
      event: "chatbot_choice_interpreter",
      requestId: input.requestId,
      boundary: "choice-interpreter",
      decision,
      reason,
      fields: { choiceSetId: input.choiceSet.id, latencyMs: Date.now() - startedAt },
    })
  }
}

function buildQuestions(
  question: string,
  options: SurveyChoiceSet["choices"],
  multiple: boolean,
): Record<string, unknown> {
  const answerCriteria = Object.fromEntries([
    ...(multiple ? [["answers", "The customer answers the question by naming one or more of the options."]] : options.map((option) => [option.id, option.label])),
    [notAnAnswer, "The message is not a clear answer to the question: another question, a greeting, a request for advice, or unclear."],
  ])
  const questions: Record<string, unknown> = {
    answer: {
      type: "choice",
      instructions: `A customer was asked "${question}" and replied with customer_answer. Pick what the reply means.`,
      criteria: answerCriteria,
    },
  }
  if (multiple) {
    for (const option of options) {
      questions[`includes_${option.id}`] = {
        type: "noul",
        instructions: `Does customer_answer select "${option.label}" as an answer to "${question}"?`,
      }
    }
  }
  return questions
}

function readSingle(answers: Record<string, JevAnswer>, options: SurveyChoiceSet["choices"]): string[] | null {
  const answer = answers.answer
  if (!answer || typeof answer.choice !== "string" || answer.choice === notAnAnswer) return null
  if (typeof answer.confidence !== "number" || answer.confidence < minimumConfidence) return null
  return options.some((option) => option.id === answer.choice) ? [answer.choice] : null
}

function readMultiple(answers: Record<string, JevAnswer>, options: SurveyChoiceSet["choices"]): string[] | null {
  const answer = answers.answer
  if (!answer || answer.choice !== "answers") return null
  if (typeof answer.confidence !== "number" || answer.confidence < minimumConfidence) return null
  const selected = options
    .filter((option) => {
      const probability = answers[`includes_${option.id}`]?.noul
      return typeof probability === "number" && probability >= minimumOptionProbability
    })
    .map((option) => option.id)
  if (selected.length === 0) return null
  // "none" / "undecided" cannot be combined with concrete options; an ambiguous mix goes to the LLM.
  const exclusive = selected.filter((id) => id === "none" || id === "undecided")
  if (exclusive.length > 0 && selected.length > 1) return null
  return selected
}
