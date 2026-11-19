import clsx from 'clsx'
import { memo, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconDownloadOutline16, IconEditOutline16, IconEllipsisOutline16, IconTrashOutline16 } from '../base/icons.js'
import { renameSession, selectSession, setSessionPinned } from '../../services/chat/store.js'
import { exportSessionText } from '../../services/chat/exportText.js'
import { showToast } from '../base/toastState.js'
import type { SessionSummary } from '../../services/chat/types.js'
import { IconButton } from '../base/IconButton.js'
import { Menu } from '../base/Menu.js'
import { closeMobileSider } from './mobileSiderState.js'
import styles from './SessionItem.module.css'

export const SessionItem = memo(function SessionItem({
  session,
  active,
  onDelete,
}: {
  session: SessionSummary
  active: boolean
  onDelete: () => void
}) {
  const t = useTranslate()
  const [editing, setEditing] = useState(false)
  const displayTitle = session.title || t('untitledChat')

  const pinned = Boolean(session.pinnedAt)

  const pinIcon = (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M9.86 1.4 14.6 6.14l-1.02 1.02-.94-.3-2.9 2.9.3 1.9-1.03 1.03-4.7-4.7 1.03-1.03 1.9.3 2.9-2.9-.3-.94L9.86 1.4Z"
        fill="currentColor"
      />
      <path d="M5.63 10.37 2.1 13.9l-.6-.6 3.53-3.53z" fill="currentColor" />
    </svg>
  )

  const runExport = (format: 'txt' | 'md') => {
    void (async () => {
      const ok = await exportSessionText(session.id, format)
      showToast(ok ? { key: 'sessionExported' } : { key: 'sessionExportFailed', type: 'error' })
    })()
  }

  if (editing) {
    const finish = (title: string) => {
      setEditing(false)
      if (title.trim() && title.trim() !== displayTitle) {
        renameSession(session.id, title.trim())
      }
    }
    return (
      <input
        className={styles.renameInput}
        defaultValue={displayTitle}
        autoFocus
        onFocus={(event) => event.target.select()}
        onBlur={(event) => finish(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            finish(event.currentTarget.value)
          } else if (event.key === 'Escape') {
            setEditing(false)
          }
        }}
      />
    )
  }

  return (
    <div
      className={clsx(styles.item, active && styles.active)}
      onClick={() => {
        selectSession(session.id)
        closeMobileSider()
      }}
    >
      <div className={styles.title}>{displayTitle}</div>
      <div className={styles.action} onClick={(event) => event.stopPropagation()}>
        <Menu
          options={[
            {
              key: 'pin',
              label: t(pinned ? 'sessionItemMenuUnpinOption' : 'sessionItemMenuPinOption'),
              icon: pinIcon,
              onSelect: () => setSessionPinned(session.id, !pinned),
            },
            {
              key: 'rename',
              label: t('sessionItemMenuRenameOption'),
              icon: <IconEditOutline16 />,
              onSelect: () => setEditing(true),
            },
            {
              key: 'export-txt',
              label: t('sessionItemMenuExportTxt'),
              icon: <IconDownloadOutline16 />,
              onSelect: () => runExport('txt'),
            },
            {
              key: 'export-md',
              label: t('sessionItemMenuExportMarkdown'),
              icon: <IconDownloadOutline16 />,
              onSelect: () => runExport('md'),
            },
            {
              key: 'delete',
              label: t('delete'),
              icon: <IconTrashOutline16 />,
              danger: true,
              onSelect: onDelete,
            },
          ]}
        >
          {({ toggle }) => (
            <IconButton icon={<IconEllipsisOutline16 />} aria-label={t('more')} onClick={toggle} />
          )}
        </Menu>
      </div>
    </div>
  )
})
