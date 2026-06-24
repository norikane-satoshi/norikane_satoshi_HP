import type { ChatbotConversation, ConversationState, JobContext, RoutingDecision } from "@/lib/chatbot/domain"
import {
  lectureTrainingContentChoices,
  lectureTrainingFormatChoices,
  lectureTrainingSoftwareChoices,
} from "@/lib/chatbot/domain"

const lectureTrainingIntentPattern =
  /(?:講演|講習|セミナー|講師(?:依頼)?|研修|ワークショップ|work\s*shop|workshop|training|lecture|instructor)/iu
const lectureTrainingContentPattern =
  /(?:カラー(?:グレーディング|コレクション)?|カラグレ|davinci|resolve|ダビンチ|ダヴィンチ|編集|look|ルック|講習内容|内容)/iu
const venuePattern =
  /(?:開催場所|会場|場所|現地|オフィス|スタジオ|学校|大学|ホール|会議室|東京|大阪|京都|渋谷|新宿|オンライン|リモート)/iu
const acceptedSoftwarePattern =
  /(?:davinci\s*resolve\s*studio|davinci\s*resolve|resolve\s*studio|ダビンチ\s*リゾルブ|ダヴィンチ\s*リゾルブ|ダビンチ|ダヴィンチ)/iu
const unsupportedSoftwarePattern = /(?:premiere|after\s*effects|final\s*cut|avid|edius|プレミア|アフターエフェクト|ファイナルカット)/iu
const resolveVersionPattern =
  /(?:davinci\s*resolve|resolve|バージョン|version|ver\.?)\s*(?:studio\s*)?(?:v(?:er)?\.?\s*)?([0-9]+(?:\.[0-9]+){0,2})/iu
const controlPanelPattern =
  /(?:コントロールパネル|control\s*panel|micro\s*color\s*panel|micro\s*panel|マイクロカラーパネル|パネル)/iu
const noControlPanelPattern =
  /(?:コントロールパネル|control\s*panel|micro\s*color\s*panel|micro\s*panel|マイクロカラーパネル|パネル).{0,12}(?:なし|ない|ありません|未導入|無し)/iu
const audienceDisplayPattern =
  /(?:大画面|スクリーン|プロジェクター|プロジェクタ|参加者.{0,16}(?:見|見る|見られる)|gui.{0,16}(?:見|見る|見られる)|操作画面.{0,16}(?:見|見る|見られる))/iu
const instructorMonitorPattern =
  /(?:デュアルモニター|デュアルモニタ|2\s*枚|二\s*枚|メインモニター|メインモニタ|マスモニ|マスターモニター|master\s*monitor)/iu
const preferredSchedulePattern =
  /(?:希望日時|希望日|候補日|日程|開始|終了|所要|10\s*[:：]?\s*00|18\s*[:：]?\s*00|午前|午後|[0-2]?[0-9]\s*時)/iu
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu

export function applyLectureTrainingConversationState(input: {
  conversation: ChatbotConversation
  conversationState: ConversationState
  latestUserMessage?: string
}): ConversationState {
  const texts = collectUserTexts(input.conversation, input.latestUserMessage)
  const existingInquiry = input.conversationState.lectureTrainingInquiry ?? {}
  const hasIntent = input.conversationState.requestKind === "lecture-training" || texts.some((text) => lectureTrainingIntentPattern.test(text))
  if (!hasIntent) return input.conversationState

  const inquiry = { ...existingInquiry }
  const contentText = findMatchingText(texts, lectureTrainingContentPattern)
  const venueText = findMatchingText(texts, venuePattern)
  const acceptedSoftwareText = findMatchingText(texts, acceptedSoftwarePattern)
  const unsupportedSoftwareText = findMatchingText(texts, unsupportedSoftwarePattern)
  const resolveVersion = findResolveVersion(texts)
  const controlPanelText = findMatchingText(texts, controlPanelPattern)
  const audienceDisplayText = findMatchingText(texts, audienceDisplayPattern)
  const instructorMonitorText = findMatchingText(texts, instructorMonitorPattern)
  const preferredScheduleText = findMatchingText(texts, preferredSchedulePattern)
  const contactEmail = input.conversationState.contactEmail ?? findContactEmail(texts)

  if (contentText) inquiry.content = compactSnippet(contentText)
  if (venueText) inquiry.venue = compactSnippet(venueText)
  if (acceptedSoftwareText) {
    inquiry.software = /studio/iu.test(acceptedSoftwareText) ? "davinci-resolve-studio" : "davinci-resolve"
  }
  if (!acceptedSoftwareText && unsupportedSoftwareText) inquiry.unsupportedSoftware = compactSnippet(unsupportedSoftwareText)
  if (resolveVersion) inquiry.resolveVersion = resolveVersion
  if (controlPanelText) {
    inquiry.controlPanel = noControlPanelPattern.test(controlPanelText)
      ? "現場になし。Micro Color Panel 持参可否を本人確認"
      : compactSnippet(controlPanelText)
  }
  if (audienceDisplayText) inquiry.audienceGuiDisplay = compactSnippet(audienceDisplayText)
  if (instructorMonitorText) inquiry.instructorMonitorSetup = compactSnippet(instructorMonitorText)
  if (preferredScheduleText) inquiry.preferredSchedule = compactSnippet(preferredScheduleText)

  return {
    ...input.conversationState,
    requestKind: "lecture-training",
    hasLectureTrainingIntent: true,
    hasLectureTrainingContent: Boolean(input.conversationState.hasLectureTrainingContent || inquiry.content),
    hasLectureTrainingVenue: Boolean(input.conversationState.hasLectureTrainingVenue || inquiry.venue),
    hasLectureTrainingSoftware: Boolean(input.conversationState.hasLectureTrainingSoftware || inquiry.software),
    hasResolveVersion: Boolean(input.conversationState.hasResolveVersion || inquiry.resolveVersion),
    hasControlPanel: Boolean(input.conversationState.hasControlPanel || inquiry.controlPanel),
    hasAudienceGuiDisplay: Boolean(input.conversationState.hasAudienceGuiDisplay || inquiry.audienceGuiDisplay),
    hasInstructorMonitorSetup: Boolean(input.conversationState.hasInstructorMonitorSetup || inquiry.instructorMonitorSetup),
    hasPreferredLectureSchedule: Boolean(input.conversationState.hasPreferredLectureSchedule || inquiry.preferredSchedule),
    requiresNorikaneConfirmation: true,
    lectureTrainingInquiry: inquiry,
    ...(contactEmail ? { hasContactEmail: true, contactEmail } : {}),
  }
}

export function isLectureTrainingInquiry(conversationState: Pick<ConversationState, "requestKind" | "hasLectureTrainingIntent">): boolean {
  return conversationState.requestKind === "lecture-training" || conversationState.hasLectureTrainingIntent === true
}

export function decideLectureTrainingRouting(input: {
  jobContext: JobContext
  conversationState: ConversationState
}): RoutingDecision {
  const { conversationState } = input
  const inquiry = conversationState.lectureTrainingInquiry ?? {}

  if (!conversationState.hasLectureTrainingContent) {
    return continueWith("講習・教育で扱いたい内容を選んでください。", lectureTrainingContentChoices)
  }
  if (!conversationState.hasLectureTrainingVenue) {
    return continueWith("開催形式を選んでください。", lectureTrainingFormatChoices)
  }
  if (!conversationState.hasLectureTrainingSoftware) {
    const prefix = inquiry.unsupportedSoftware
      ? "使用ソフトは DaVinci Resolve Studio または DaVinci Resolve のみ対応前提です。"
      : ""
    return continueWith(`${prefix}使用ソフトを選んでください。`, lectureTrainingSoftwareChoices)
  }
  if (!conversationState.hasResolveVersion) {
    return continueWith("DaVinci Resolve のバージョンを教えてください。")
  }
  if (!conversationState.hasControlPanel) {
    return continueWith("コントロールパネルの有無を教えてください。現場にない場合は、則兼本人の Micro Color Panel を持参できる可能性があります。")
  }
  if (!conversationState.hasAudienceGuiDisplay) {
    return continueWith("参加者全員が講師の GUI 操作を大きな画面で十分に見られる環境か教えてください。")
  }
  if (!conversationState.hasInstructorMonitorSetup) {
    return continueWith("講師側のモニター構成を教えてください。GUI 用デュアルモニター 2 枚、メインモニター、可能ならマスモニが望ましいです。")
  }
  if (!conversationState.hasPreferredLectureSchedule) {
    return continueWith("希望日程と、10:00〜18:00 を基本にした開始時刻・終了時刻・所要時間の希望を教えてください。")
  }
  if (!conversationState.hasContactEmail || !conversationState.contactEmail) {
    return continueWith("内容を整理したうえで、則兼本人と相談・確認します。ご連絡先メールを教えてください。")
  }

  return {
    kind: "to-email",
    summary: buildLectureTrainingSummary(input.jobContext, conversationState),
  }
}

export function buildLectureTrainingOpenQuestions(conversationState: Partial<ConversationState>): string[] {
  return [
    conversationState.hasLectureTrainingContent ? undefined : "講演・講習内容未確認",
    conversationState.hasLectureTrainingVenue ? undefined : "開催場所未確認",
    conversationState.hasLectureTrainingSoftware ? undefined : "使用ソフト未確認（DaVinci Resolve / Studio のみ）",
    conversationState.hasResolveVersion ? undefined : "DaVinci Resolve バージョン未確認",
    conversationState.hasControlPanel ? undefined : "コントロールパネル有無未確認",
    conversationState.hasAudienceGuiDisplay ? undefined : "参加者が GUI 操作を大画面で見られる環境未確認",
    conversationState.hasInstructorMonitorSetup ? undefined : "講師側モニター構成未確認",
    conversationState.hasPreferredLectureSchedule ? undefined : "10:00〜18:00 基本の希望日時・所要時間未確認",
    conversationState.hasContactEmail && conversationState.contactEmail ? undefined : "連絡先メール未確認",
    "実施可否・最終内容・日程確定は則兼本人確認が必要",
  ].filter((item): item is string => Boolean(item))
}

function buildLectureTrainingSummary(jobContext: JobContext, conversationState: ConversationState) {
  const inquiry = conversationState.lectureTrainingInquiry ?? {}
  const detailSegments = [
    "依頼種別: 講演・講習・講師依頼",
    "基本対応時間: 10:00〜18:00",
    "確定方針: 内容整理後に則兼本人が実施可否・最終内容・日程を確認",
    inquiry.content ? `内容: ${inquiry.content}` : undefined,
    inquiry.venue ? `開催場所: ${inquiry.venue}` : undefined,
    inquiry.software ? `使用ソフト: ${labelSoftware(inquiry.software)}` : undefined,
    inquiry.resolveVersion ? `Resolve バージョン: ${inquiry.resolveVersion}` : undefined,
    inquiry.controlPanel ? `コントロールパネル: ${inquiry.controlPanel}` : undefined,
    inquiry.audienceGuiDisplay ? `参加者表示環境: ${inquiry.audienceGuiDisplay}` : undefined,
    inquiry.instructorMonitorSetup ? `講師側モニター: ${inquiry.instructorMonitorSetup}` : undefined,
    inquiry.preferredSchedule ? `希望日時: ${inquiry.preferredSchedule}` : undefined,
  ].filter((item): item is string => Boolean(item))

  return {
    subject: "講演・講習・講師依頼",
    customerEmail: conversationState.contactEmail ?? "",
    ...(conversationState.customerName ? { customerName: conversationState.customerName } : {}),
    ...(conversationState.companyName ? { companyName: conversationState.companyName } : {}),
    jobContext: {
      ...jobContext,
      finalMedium: jobContext.finalMedium ?? "other",
      workSite: jobContext.workSite ?? "on-site",
      documentaryAttachment: jobContext.documentaryAttachment ?? { kind: "none" },
    },
    summaryText: detailSegments.join(" / "),
    openQuestions: buildLectureTrainingOpenQuestions(conversationState),
  }
}

function continueWith(
  nextQuestion: string,
  presentChoices?: Extract<RoutingDecision, { kind: "continue" }>["presentChoices"],
): RoutingDecision {
  return { kind: "continue", nextQuestion, ...(presentChoices ? { presentChoices } : {}) }
}

function collectUserTexts(conversation: ChatbotConversation, latestUserMessage?: string): string[] {
  return [
    latestUserMessage,
    ...conversation.messages
      .filter((message) => message.role === "user")
      .reverse()
      .map((message) => message.content),
  ].filter((text): text is string => Boolean(text?.trim()))
}

function findMatchingText(texts: readonly string[], pattern: RegExp): string | undefined {
  return texts.find((text) => pattern.test(text))
}

function findResolveVersion(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const match = resolveVersionPattern.exec(text.normalize("NFKC"))
    if (match?.[1]) return match[1]
  }
  return undefined
}

function findContactEmail(texts: readonly string[]): string | undefined {
  for (const text of texts) {
    const match = emailPattern.exec(text)
    if (match?.[0]) return match[0]
  }
  return undefined
}

function compactSnippet(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, 160)
}

function labelSoftware(value: NonNullable<ConversationState["lectureTrainingInquiry"]>["software"]): string {
  return value === "davinci-resolve-studio" ? "DaVinci Resolve Studio" : "DaVinci Resolve"
}
