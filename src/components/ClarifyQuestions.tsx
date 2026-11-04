import { useState } from 'react'
import type { ClarifyOption, ClarifyQuestion, DraftEvent } from '../types'
import { Icon } from './Icons'

const COPY = {
  label: '需要确认',
  custom: '其他（自己输入）',
  send: '确认',
  placeholder: '输入你的答案',
}

interface ClarifyQuestionsProps {
  draft: DraftEvent
  onOption: (draft: DraftEvent, question: ClarifyQuestion, option: ClarifyOption) => void
  onCustom: (draft: DraftEvent, question: ClarifyQuestion, text: string) => void
}

export function ClarifyQuestions({ draft, onOption, onCustom }: ClarifyQuestionsProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const questions = draft.questions.filter((question) => !question.answer)

  if (questions.length === 0) return null

  return (
    <div className="clarify">
      <div className="clarify__head">
        <span className="clarify__badge">
          <Icon name="wand" size={11} />
          {COPY.label}
        </span>
        <span className="clarify__hint">选一个，或自己写</span>
      </div>
      {questions.map((question) => {
        const isOpen = openId === question.id
        return (
          <div className="clarify__question" key={question.id}>
            <p>{question.prompt}</p>
            <div className="clarify__options">
              {question.options.map((option) => (
                <button
                  key={option.id}
                  className="clarify-chip"
                  type="button"
                  onClick={() => onOption(draft, question, option)}
                >
                  {option.label}
                </button>
              ))}
              {question.allowCustom && (
                <button
                  className={`clarify-chip clarify-chip--custom ${isOpen ? 'is-open' : ''}`}
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : question.id)}
                >
                  <Icon name="plus" size={11} />
                  {COPY.custom}
                </button>
              )}
            </div>
            {isOpen && (
              <div className="clarify__custom">
                <input
                  value={values[question.id] ?? ''}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [question.id]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && values[question.id]?.trim()) {
                      onCustom(draft, question, values[question.id])
                    }
                  }}
                  placeholder={question.customPlaceholder ?? COPY.placeholder}
                  autoFocus
                />
                <button
                  type="button"
                  disabled={!values[question.id]?.trim()}
                  onClick={() => onCustom(draft, question, values[question.id] ?? '')}
                >
                  {COPY.send}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
