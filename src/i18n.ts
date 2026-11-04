/**
 * Minimal i18n foundation. v0.2 ships zh-CN only; the key space and fallback
 * are here so new modules can be translated without changing layout code.
 *
 * New UI modules should keep their copy in a local COPY object (as WeekOverview
 * and GitHubConnectDialog do) and register those keys here when a second
 * locale is introduced.
 */

export const LOCALE = 'zh-CN' as const
export type Locale = typeof LOCALE

const zhCN = {
  'app.name': '阑珊时刻',
  'nav.timeline': '时间轴',
  'nav.week': '本周',
  'nav.review': '整理稿',
  'nav.settings': '设置',
  'nav.capture': '记录时间',
  'nav.light': '浅色',
  'nav.dark': '深色',
  'sync.local': '仅本地',
  'sync.connected': '已连接',
  'sync.synced': '已同步',
  'review.drafts': '整理稿',
  'review.json': 'JSON',
  'common.today': '今天',
  'common.cancel': '取消',
  'common.save': '保存设置',
} as const

export type MessageKey = keyof typeof zhCN

const dictionaries: Record<Locale, Record<MessageKey, string>> = {
  'zh-CN': zhCN,
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template = dictionaries[LOCALE][key] ?? key
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`))
}
