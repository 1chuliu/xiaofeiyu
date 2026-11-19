import type { Locale } from '../settings.js'
import { formatDate } from '../../utils/format.js'
import { translate } from '../../i18n/index.js'

/**
 * 模型约定的五段信息：`date,weekday,location,platform,language`。
 * 本应用不采集、也不发送位置信息，第三段固定留空；日期与星期使用浏览器本地时区，避免 UTC 跨日。
 */
export const createLatestReminder = (
  { locale }: { locale: Locale },
  now = new Date()
): string => {
  return [
    formatDate(now),
    new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(now),
    '',
    'Web',
    translate('latestReminderLanguage'),
  ].join(',')
}