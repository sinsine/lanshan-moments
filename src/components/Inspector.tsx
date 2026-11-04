import { useMemo, useState } from 'react'
import type {
  ClarifyOption,
  ClarifyQuestion,
  DraftEvent,
  ScheduleDocument,
} from '../types'
import {
  dateKey,
  formatDayCN,
  formatTimeRange,
  relativeDayLabel,
  weekdayCN,
} from '../lib/date'
import { missingRequiredFields, openQuestionCount } from '../lib/clarify'
import { Icon } from './Icons'
import { ClarifyQuestions } from './ClarifyQuestions'

type InspectorTab = 'drafts' | 'json'

interface InspectorProps {
  drafts: DraftEvent[]
  document: ScheduleDocument
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  onToggle: (id: string) => void
  onSelectAll: (selected: boolean) => void
  onAnswerOption: (
    draft: DraftEvent,
    question: ClarifyQuestion,
    option: ClarifyOption,
  ) => void
  onAnswerCustom: (draft: DraftEvent, question: ClarifyQuestion, text: string) => void
  onConfirm: () => void
  onCopy: () => void
  onDownload: () => void
  parsing: boolean
  stage: string
  engineLabel: string
  onClose?: () => void
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function highlightJson(json: string): string {
  const pattern =
    /("(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"\s*:?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g
  let result = ''
  let lastIndex = 0
  for (const match of json.matchAll(pattern)) {
    const index = match.index ?? 0
    result += escapeHtml(json.slice(lastIndex, index))
    const token = match[0]
    if (match[1]) {
      const isKey = token.trimEnd().endsWith(':')
      result += `<span class="${isKey ? 'j-key' : 'j-string'}">${escapeHtml(token)}</span>`
    } else if (match[2]) {
      result += `<span class="j-number">${escapeHtml(token)}</span>`
    } else {
      result += `<span class="j-bool">${escapeHtml(token)}</span>`
    }
    lastIndex = index + token.length
  }
  result += escapeHtml(json.slice(lastIndex))
  return result
}

function draftWhen(draft: DraftEvent): string {
  if (draft.start) {
    const date = new Date(draft.start)
    const relative = relativeDayLabel(dateKey(date))
    return `${formatDayCN(date)} ${weekdayCN(date)}${relative ? ` · ${relative}` : ''} · ${formatTimeRange(
      draft.start,
      draft.end,
    )}`
  }
  if (draft.deadline) return `截止 ${draft.deadline} · 具体时间未定`
  return '待安排 · 还没有日期'
}

export function Inspector({
  drafts,
  document,
  tab,
  onTab,
  onToggle,
  onSelectAll,
  onAnswerOption,
  onAnswerCustom,
  onConfirm,
  onCopy,
  onDownload,
  parsing,
  stage,
  engineLabel,
  onClose,
}: InspectorProps) {
  const [copied, setCopied] = useState(false)
  const selectedCount = drafts.filter((draft) => draft.selected).length
  const incompleteCount = drafts.filter(
    (draft) => draft.selected && missingRequiredFields(draft).length > 0,
  ).length
  const allSelected = drafts.length > 0 && selectedCount === drafts.length
  const json = useMemo(() => highlightJson(JSON.stringify(document, null, 2)), [document])

  const handleCopy = () => {
    onCopy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <aside className="inspector" aria-label="整理结果">
      <div className="inspector__head">
        <div className="inspector__tabs" role="tablist" aria-label="整理结果视图">
          <button
            className={`inspector__tab ${tab === 'drafts' ? 'is-active' : ''}`}
            onClick={() => onTab('drafts')}
            role="tab"
            aria-selected={tab === 'drafts'}
            type="button"
          >
            整理稿
            {drafts.length > 0 && <span>{drafts.length}</span>}
          </button>
          <button
            className={`inspector__tab ${tab === 'json' ? 'is-active' : ''}`}
            onClick={() => onTab('json')}
            role="tab"
            aria-selected={tab === 'json'}
            type="button"
          >
            JSON
          </button>
        </div>
        {onClose && (
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <Icon name="x" size={18} />
          </button>
        )}
      </div>

      {tab === 'drafts' ? (
        <>
          <div className="inspector__body">
            {parsing && (
              <div className="parsing-state">
                <div className="parsing-orbit">
                  <span />
                  <span />
                  <span />
                </div>
                <p>{stage}</p>
                <div className="parsing-lines">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}

            {!parsing && drafts.length === 0 && (
              <div className="inspector__empty">
                <p className="eyebrow">空白也是一条线</p>
                <h2>理好的时刻，会先停在这里</h2>
                <p>
                  给左边一段话或一张截图。它会拆出日期、时间、地点和待确认的模糊处，等你过目后再写入时间轴。
                </p>
                <div className="steps">
                  <div>
                    <span>01</span>
                    <p>丢进一段话或截图</p>
                  </div>
                  <div>
                    <span>02</span>
                    <p>逐条核对，不对就取消</p>
                  </div>
                  <div>
                    <span>03</span>
                    <p>写入统一的时间轴</p>
                  </div>
                </div>
                <div className="schema-note">
                  <Icon name="json" size={15} />
                  <code>schedule.json · schema 1.0</code>
                </div>
              </div>
            )}

            {!parsing && drafts.length > 0 && (
              <>
                <div className="draft-summary">
                  <div>
                    <p className="eyebrow">{engineLabel}</p>
                    <h2>
                      读出 <em>{drafts.length}</em> 个时刻
                    </h2>
                  </div>
                  <button
                    className="text-button text-button--muted"
                    onClick={() => onSelectAll(!allSelected)}
                    type="button"
                  >
                    {allSelected ? '全部取消' : '全部选中'}
                  </button>
                </div>

                <div className="draft-list">
                  {drafts.map((draft, index) => {
                    const missing = missingRequiredFields(draft)
                    const openQuestions = openQuestionCount(draft)
                    return (
                    <article
                      key={draft.id}
                      className={`draft-card category-${draft.category} ${
                        draft.selected ? 'is-selected' : ''
                      } ${missing.length > 0 ? 'draft-card--incomplete' : ''}`}
                    >
                      <button
                        className="draft-card__check"
                        onClick={() => onToggle(draft.id)}
                        type="button"
                        aria-label={draft.selected ? `取消 ${draft.title}` : `选择 ${draft.title}`}
                        aria-pressed={draft.selected}
                      >
                        {draft.selected && <Icon name="check" size={12} />}
                      </button>
                      <div className="draft-card__content">
                        <div className="draft-card__top">
                          <span className="draft-card__index">{String(index + 1).padStart(2, '0')}</span>
                          <span className={`category-label category-${draft.category}`}>
                            {draft.category === 'work'
                              ? '工作'
                              : draft.category === 'life'
                                ? '生活'
                                : draft.category === 'health'
                                  ? '健康'
                                  : draft.category === 'focus'
                                    ? '专注'
                                    : '其他'}
                          </span>
                          <span className="draft-card__confidence">
                            把握 {Math.round(draft.confidence * 100)}%
                          </span>
                        </div>
                        <h3>{draft.title}</h3>
                        <p className="draft-card__when">
                          <Icon name="clock" size={12} />
                          {draftWhen(draft)}
                        </p>
                        <p className={`draft-card__where ${draft.location ? '' : 'is-missing'}`}>
                          <Icon name="pin" size={12} />
                          {draft.location || '地点待确认'}
                        </p>
                        {missing.length > 0 && (
                          <p className="draft-card__missing">
                            <Icon name="alert" size={12} />
                            还差：{missing.join('、')}
                          </p>
                        )}
                        {draft.warnings.length > 0 && missing.length === 0 && (
                          <p className="draft-card__warning">
                            <Icon name="alert" size={12} />
                            {draft.warnings[0]}
                          </p>
                        )}
                        {openQuestions > 0 && (
                          <ClarifyQuestions
                            draft={draft}
                            onOption={onAnswerOption}
                            onCustom={onAnswerCustom}
                          />
                        )}
                        {draft.source.excerpt && (
                          <blockquote>{draft.source.excerpt}</blockquote>
                        )}
                      </div>
                    </article>
                    )
                  })}
                </div>
              </>
            )}
          </div>

          {!parsing && drafts.length > 0 && (
            <div className="inspector__foot">
              <p>
                {incompleteCount > 0
                  ? `${incompleteCount} 条还差开始/结束/地点，补齐后才能写入。`
                  : '还没有写入。取消勾选，或直接加入。'}
              </p>
              <button
                className="primary-button"
                onClick={onConfirm}
                disabled={selectedCount === 0}
                type="button"
              >
                写入时间轴
                <span>{selectedCount}</span>
                <Icon name="arrow-right" size={17} />
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="json-toolbar">
            <span>
              <Icon name="json" size={14} />
              schedule.json
            </span>
            <div>
              <button className="icon-button icon-button--small" onClick={handleCopy} aria-label="复制 JSON">
                <Icon name={copied ? 'check' : 'copy'} size={15} />
              </button>
              <button
                className="icon-button icon-button--small"
                onClick={onDownload}
                aria-label="下载 JSON"
              >
                <Icon name="download" size={15} />
              </button>
            </div>
          </div>
          <div className="json-view">
            <pre>
              <code dangerouslySetInnerHTML={{ __html: json }} />
            </pre>
          </div>
          <div className="json-foot">
            <p>
              统一格式，事件级合并。换一个模型、换一个界面，数据仍然是同一份。
            </p>
            <span>schema 1.0</span>
          </div>
        </>
      )}
    </aside>
  )
}
