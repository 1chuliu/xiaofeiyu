import { useIsMobile } from '../../app/viewport.js'
import { useTranslate } from '../../i18n/index.js'
import { ChatInput } from '../chatInput/ChatInput.js'
import { MobileHeader } from './MobileHeader.js'
import styles from './Welcome.module.css'

/** 新对话：小肥鱼手绘胖鲸标记 + 问候语 + 输入框。桌面端居中；移动端输入框吸底 */
const WhaleMark = () => (
  <svg className={styles.mark} viewBox="0 0 48 48" aria-hidden="true">
    <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 27c0-6 4.5-10.5 11-11.5 6.5-1 10.5 1.2 13 3.8 1.4 1.5 2.2 3.3 1.8 5.2 0 2.9-2 5.4-5.6 6.9-3.6 1.5-8.8 2-12.4 1-3.4-1-6.6-2.9-7.8-5.4Z" />
      <path d="M18.5 16.2c-1.2-2-2.6-3.3-4-4" />
      <path d="M22 16c0.6-2.2 1.7-4 3.1-5.2" />
      <circle cx="13.6" cy="10.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="24.6" cy="9.2" r="1" fill="currentColor" stroke="none" />
      <circle cx="27.6" cy="11.8" r="1" fill="currentColor" stroke="none" />
      <path d="M34.8 25.2l6.2-0.9 3.4-0.6" />
      <path d="M44.4 23.7l1.6 1.9v1.8l-1.6 1.9" />
      <path d="M44.4 29.3l-3.4-0.5-6.2-0.6" />
      <path d="M23 19c1.5-0.4 2.8-0.3 3.9 0.2" />
      <path d="M13.4 29c1.8 1.7 4 2.1 5.8 1.6" strokeWidth="1.7" />
      <path d="M15.6 32.1c1.7 1 3.5 1.1 5 0.7" strokeWidth="1.5" />
      <circle cx="19" cy="25.8" r="1.1" fill="currentColor" stroke="none" />
    </g>
    <ellipse cx="16.6" cy="29.6" rx="2.6" ry="1.3" fill="#ff8a5b" opacity="0.45" />
    <circle cx="39.6" cy="13.6" r="1.4" stroke="currentColor" strokeWidth="1.3" fill="none" />
    <circle cx="42.4" cy="10" r="0.8" stroke="currentColor" strokeWidth="1.2" fill="none" />
    <path
      d="M8 7.6l0.7 1.7 1.7 0.7-1.7 0.7-0.7 1.7-0.7-1.7-1.7-0.7 1.7-0.7z"
      stroke="#ff8a5b"
      strokeWidth="1.3"
      fill="none"
      strokeLinejoin="round"
    />
  </svg>
)

export const Welcome = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  return (
    <div className={styles.container}>
      {isMobile ? <MobileHeader /> : null}
      <div className={styles.welcome}>
        <WhaleMark />
        <div className={styles.greeting}>{t('welcomeMessageChat250808')}</div>
        <ChatInput sessionId={null} />
        <div className={styles.platformHint}>
          {t('welcomePlatformHint')}{' '}
          <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">
            platform.deepseek.com
          </a>
        </div>
      </div>
    </div>
  )
}