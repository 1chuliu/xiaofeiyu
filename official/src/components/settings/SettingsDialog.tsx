import clsx from 'clsx'
import { useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconEditOutline16,
  IconFollowsystemOutline16,
  IconLightOutline16,
  IconLinkOutline16,
  IconPanelLeftOutline16,
  IconSettingsOutline16,
  IconThinkOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importHistory,
  mergeImportHistory,
} from '../../services/chat/backup.js'
import { useIsMobile } from '../../app/viewport.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  addCharacter,
  addGroupCharacter,
  removeCharacter,
  removeGroupCharacter,
  setActiveCharacter,
  setCustomPrompt,
  setLocale,
  setMaxTokens,
  setModelId,
  setExtraModels,
  setApiBase,
  setApiProtocol,
  setApiProxy,
  setReasoningEffort,
  setTemperature,
  setThemePreference,
  setTopP,
  setTtsVoice,
  setWritingPreset,
  setWritingProfile,
  setUserName,
  setUserPersona,
  setAutoMemory,
  setMemoryInterval,
  setPromptBlocks,
  setGroupStrategy,
  setGroupContinuous,
  setGroupMultiPerTurn,
  setGroupReplyLength,
  setContextBudget,
  setStreamRetryCount,
  setStreamIdleTimeout,
  setChatBackground,
  setMemoryRecall,
  setMemoryRecallLimit,
  setMemoryRecallMode,
  setPromptTemplates,
  setActivePromptTemplate,
  setModelTemplateBinding,
  setSupportTipCode,
  setSupportTipCodeAlipay,
  setSupportLink,
  addWorldEntry,
  addImportedWorldEntries,
  removeWorldEntry,
  updateWorldEntry,
  updateCharacter,
  useSettings,
  type ThemePreference,
} from '../../services/settings.js'
import { WRITING_PRESETS } from '../../services/writing/presets.js'
import { copyText } from '../../utils/clipboard.js'
import { APP_VERSION, SUPPORT_NOTE } from '../../services/about.js'
import { useLocalConfig } from '../../services/localConfig.js'
import {
  DEFAULT_PROMPT_BLOCKS,
  applyPromptTemplate,
  createPromptTemplate,
  promptBlockLabelKey,
} from '../../services/chat/promptBlocks.js'
import {
  parseCharacterCardJson,
  serializeCharacterCard,
  extractCardJsonFromPng,
} from '../../services/writing/cardV2.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { ApiKeyConfirm, ApiKeyField, useApiKeyEditor } from './ApiKeyField.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言、朗读音色、位置）与「数据管理」（API Key、导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'writing', label: 'settingDialogAsideWritingOptionLabel', icon: <IconEditOutline16 /> },
  { value: 'character', label: 'settingDialogAsideCharacterOptionLabel', icon: <IconLinkOutline16 /> },
  { value: 'prompt', label: 'settingDialogAsidePromptOptionLabel', icon: <IconPanelLeftOutline16 /> },
  { value: 'advanced', label: 'settingDialogAsideAdvancedOptionLabel', icon: <IconThinkOutline16 /> },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  { value: 'about', label: 'settingDialogAsideAboutOptionLabel', icon: <IconFollowsystemOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  const isMobile = useIsMobile()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失正在输入的 API Key 与导入状态
  const apiKeyEditor = useApiKeyEditor()
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {sections.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
              <TtsVoiceSetting />
              <BackgroundSetting />
            </>
          ) : section === 'writing' ? (
            <WritingSettings />
          ) : section === 'character' ? (
            <CharacterSettings />
          ) : section === 'prompt' ? (
            <PromptSettings />
          ) : section === 'advanced' ? (
            <AdvancedSettings />
          ) : section === 'data' ? (
            <>
              <SettingCell
                label={t('platformEntryLabel')}
                description={t('platformEntryDescription')}
                status={null}
                action={
                  <Button
                    variant="outlined"
                    size="m"
                    className={styles.cellButton}
                    onClick={() => {
                      window.open('https://platform.deepseek.com/', '_blank', 'noopener,noreferrer')
                    }}
                  >
                    {t('platformEntryAction')}
                  </Button>
                }
              />
              <ApiKeyField editor={apiKeyEditor} />
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
              {isMobile ? <ApiKeyConfirm editor={apiKeyEditor} /> : null}
            </>
          ) : (
            <AboutSettings />
          )}
        </div>
      </Modal>
      {historyImport.file ? <ImportConfirm historyImport={historyImport} /> : null}
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

const readImageAsBackground = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('不是有效的图片'))
      image.onload = () => {
        const max = 1920
        const scale = Math.min(1, max / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('画布不可用'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })

/** 聊天背景：上传图片后压缩成 data URL 存本地，仅作用于主对话区 */
const BackgroundSetting = () => {
  const t = useTranslate()
  const background = useSettings((state) => state.chatBackground)
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) {
      return
    }
    setBusy(true)
    try {
      setChatBackground(await readImageAsBackground(file))
      showToast({ key: 'backgroundApplied' })
    } catch (error) {
      showToast({
        key: 'backgroundFailed',
        type: 'error',
        params: { message: error instanceof Error ? error.message : String(error) },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('settingsBackground')}
      description={t('settingsBackgroundDescription')}
      status={null}
      action={
        <div className={styles.cardActions}>
          {background ? (
            <img className={styles.backgroundPreview} src={background} alt="" />
          ) : null}
          <Button
            variant="outlined"
            size="m"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {background ? t('settingsBackgroundChange') : t('settingsBackgroundUpload')}
          </Button>
          {background ? (
            <Button variant="dangerOutlined" size="m" onClick={() => setChatBackground('')}>
              {t('settingsBackgroundRemove')}
            </Button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void pick(file)
            }}
          />
        </div>
      }
    />
  )
}

/** 赞赏码：二维码要清晰，保留 PNG、最长边压到 900 */
const readSupportCodeImage = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('不是有效的图片'))
      image.onload = () => {
        const max = 900
        const scale = Math.min(1, max / Math.max(image.width, image.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) {
          reject(new Error('画布不可用'))
          return
        }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/png'))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })

/** 单个赞赏码设置：没上传时显示内置默认图 */
const SupportQrSetting = ({
  label,
  description,
  value,
  fallback,
  onChange,
}: {
  label: string
  description: string
  value: string
  fallback?: string
  onChange: (value: string) => void
}) => {
  const t = useTranslate()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const pick = async (file: File | undefined) => {
    if (!file) {
      return
    }
    setBusy(true)
    try {
      onChange(await readSupportCodeImage(file))
      showToast({ key: 'supportCodeUpdated' })
    } catch (error) {
      showToast({
        key: 'supportCodeFailed',
        type: 'error',
        params: { message: error instanceof Error ? error.message : String(error) },
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={label}
      description={description}
      status={null}
      action={
        <div className={styles.cardActions}>
          {value || fallback ? (
            <img className={styles.backgroundPreview} src={value || fallback} alt="" />
          ) : (
            <div className={styles.qrPlaceholder}>{t('supportNoImage')}</div>
          )}
          <Button
            variant="outlined"
            size="m"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {value ? t('supportChangeCode') : t('supportUploadCode')}
          </Button>
          {value && fallback ? (
            <Button variant="dangerOutlined" size="m" onClick={() => onChange('')}>
              {t('supportUseDefault')}
            </Button>
          ) : null}
          {value && !fallback ? (
            <Button variant="dangerOutlined" size="m" onClick={() => onChange('')}>
              {t('supportRemoveImage')}
            </Button>
          ) : null}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              void pick(file)
            }}
          />
        </div>
      }
    />
  )
}

/** 关于 / 打赏 / 反馈：全部本地展示，不接支付 */
const AboutSettings = () => {
  const t = useTranslate()
  const supportTipCode = useSettings((state) => state.supportTipCode)
  const supportTipCodeAlipay = useSettings((state) => state.supportTipCodeAlipay)
  const supportLink = useSettings((state) => state.supportLink)
  const local = useLocalConfig((state) => state.config)
  const effectiveSupportLink = (supportLink || local.supportLink || '').trim()
  const feedback = [
    local.qq ? { label: t('feedbackQq'), value: local.qq } : null,
    local.wechat ? { label: t('feedbackWechat'), value: local.wechat } : null,
    local.wechatAlt ? { label: t('feedbackWechatAlt'), value: local.wechatAlt } : null,
    local.email ? { label: t('feedbackEmail'), value: local.email } : null,
  ].filter((item): item is { label: string; value: string } => item !== null)

  const copy = async (text: string) => {
    if (await copyText(text)) {
      showToast({ key: 'copiedToClipboard' })
    } else {
      showToast({ key: 'copyFailed', type: 'error' })
    }
  }

  return (
    <>
      <SettingCell
        label={t('aboutVersionLabel')}
        description={t('aboutLicense')}
        status={null}
        action={<span className={styles.description}>小肥鱼 v{APP_VERSION}</span>}
      />
      <SettingCell
        label={t('aboutThanksLabel')}
        description={t('aboutThanks')}
        status={null}
        action={null}
      />
      <SettingCell
        label={t('supportLabel')}
        description={t('supportDescription')}
        status={null}
        action={null}
      />
      <SupportQrSetting
        label={t('supportWechatLabel')}
        description={t('supportWechatDescription')}
        value={supportTipCode}
        onChange={setSupportTipCode}
      />
      <SupportQrSetting
        label={t('supportAlipayLabel')}
        description={t('supportAlipayDescription')}
        value={supportTipCodeAlipay}
        onChange={setSupportTipCodeAlipay}
      />
      <div className={styles.description} style={{ marginTop: 8 }}>
        {t('supportNameNote')}
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('supportLinkLabel')}</div>
        <input
          className={styles.modelInput}
          value={supportLink}
          placeholder={local.supportLink || t('supportLinkPlaceholder')}
          onChange={(event) => setSupportLink(event.target.value)}
        />
        {effectiveSupportLink ? (
          <div className={styles.description}>
            <a href={effectiveSupportLink} target="_blank" rel="noreferrer">
              {effectiveSupportLink}
            </a>
          </div>
        ) : null}
        {effectiveSupportLink ? (
          <div className={styles.cardActions} style={{ marginTop: 8 }}>
            <Button
              variant="primary"
              size="m"
              onClick={() => window.open(effectiveSupportLink, '_blank', 'noopener,noreferrer')}
            >
              {t('supportOpenLink')}
            </Button>
          </div>
        ) : null}
        <div className={styles.description}>{t('supportLinkHint')}</div>
        <div className={styles.description}>{SUPPORT_NOTE}</div>
      </div>
      <SettingCell
        label={t('feedbackLabel')}
        description={feedback.length ? t('feedbackDescription') : t('feedbackUnconfigured')}
        status={null}
        action={
          feedback.length ? (
            <div className={styles.cardActions}>
              {feedback.map((item) => (
                <Button
                  key={item.label}
                  variant="outlined"
                  size="m"
                  onClick={() => void copy(item.value)}
                >
                  {item.label}：{item.value}
                </Button>
              ))}
            </div>
          ) : null
        }
      />
    </>
  )
}

/** 提示词块：逐块开关与上下移动，对应 SillyTavern Prompt Manager 的简化版 */
const PromptSettings = () => {
  const t = useTranslate()
  const blocks = useSettings((state) => state.promptBlocks)
  const templates = useSettings((state) => state.promptTemplates)
  const activeTemplateId = useSettings((state) => state.activePromptTemplateId)
  const [templateName, setTemplateName] = useState('')
  const activeTemplate = templates.find((template) => template.id === activeTemplateId)
  const modelId = useSettings((state) => state.modelId)
  const bindings = useSettings((state) => state.modelTemplateBindings)
  const boundTemplateId = bindings[modelId] ?? ''
  const boundTemplate = templates.find((template) => template.id === boundTemplateId)

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= blocks.length) {
      return
    }
    const next = [...blocks]
    const temp = next[index]
    next[index] = next[target]
    next[target] = temp
    setPromptBlocks(next)
  }

  const toggle = (index: number) => {
    setPromptBlocks(
      blocks.map((block, position) =>
        position === index ? { ...block, enabled: !block.enabled } : block
      )
    )
  }

  return (
    <>
      <div className={styles.description}>{t('promptBlocksDescription')}</div>
      <SettingCell
        label={t('promptTemplatesLabel')}
        description={t('promptTemplatesDescription')}
        status={null}
        action={
          <div className={styles.cardActions}>
            <Select
              ariaLabel={t('promptTemplatesLabel')}
              value={activeTemplateId}
              options={[
                { value: '', label: t('promptTemplateCurrent') },
                ...templates.map((template) => ({ value: template.id, label: template.name })),
              ]}
              onChange={(value) => {
                setActivePromptTemplate(value)
                const template = templates.find((item) => item.id === value)
                if (template) {
                  setPromptBlocks(applyPromptTemplate(template))
                }
              }}
            />
            <input
              className={styles.templateNameInput}
              value={templateName}
              placeholder={t('promptTemplateNamePlaceholder')}
              onChange={(event) => setTemplateName(event.target.value)}
            />
            <Button
              variant="outlined"
              size="m"
              disabled={!templateName.trim()}
              onClick={() => {
                const template = createPromptTemplate(templateName, blocks)
                setPromptTemplates([...templates, template])
                setActivePromptTemplate(template.id)
                setTemplateName('')
              }}
            >
              {t('promptTemplateSave')}
            </Button>
            <Button
              variant="dangerOutlined"
              size="m"
              disabled={!activeTemplate}
              onClick={() => {
                setPromptTemplates(
                  templates.filter((template) => template.id !== activeTemplateId)
                )
                setActivePromptTemplate('')
              }}
            >
              {t('promptTemplateDelete')}
            </Button>
          </div>
        }
      />
      <SettingCell
        label={t('promptTemplateBindLabel')}
        description={t('promptTemplateBindDescription', { model: modelId })}
        status={null}
        action={
          <div className={styles.cardActions}>
            <span className={styles.description}>
              {boundTemplate
                ? `${t('promptTemplateBound')}：${boundTemplate.name}`
                : t('promptTemplateUnbound')}
            </span>
            <Button
              variant="outlined"
              size="m"
              disabled={!activeTemplate}
              onClick={() => setModelTemplateBinding(modelId, activeTemplateId)}
            >
              {t('promptTemplateBind')}
            </Button>
            {boundTemplate ? (
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => setModelTemplateBinding(modelId, null)}
              >
                {t('promptTemplateUnbind')}
              </Button>
            ) : null}
          </div>
        }
      />
      {blocks.map((block, index) => (
        <div key={block.id} className={styles.promptRow}>
          <label className={styles.checkline}>
            <input type="checkbox" checked={block.enabled} onChange={() => toggle(index)} />
            <span>{t(promptBlockLabelKey(block.id))}</span>
          </label>
          <div className={styles.cardActions}>
            <Button
              variant="outlined"
              size="m"
              disabled={index === 0}
              aria-label={t('promptBlockMoveUp')}
              onClick={() => move(index, -1)}
            >
              ↑
            </Button>
            <Button
              variant="outlined"
              size="m"
              disabled={index === blocks.length - 1}
              aria-label={t('promptBlockMoveDown')}
              onClick={() => move(index, 1)}
            >
              ↓
            </Button>
          </div>
        </div>
      ))}
      <div className={styles.cardActions} style={{ marginTop: 10 }}>
        <Button
          variant="outlined"
          size="m"
          onClick={() => setPromptBlocks(DEFAULT_PROMPT_BLOCKS.map((block) => ({ ...block })))}
        >
          {t('promptBlocksReset')}
        </Button>
      </div>
    </>
  )
}

/** 角色与记忆：多套角色卡（人设 / 口吻 / 开场白 / 自定义示例对话 / 长期记忆），只存本机 */
const CharacterSettings = () => {
  const t = useTranslate()
  const cards = useSettings((state) => state.characterCards)
  const activeId = useSettings((state) => state.activeCharacterId)
  const userName = useSettings((state) => state.userName)
  const userPersona = useSettings((state) => state.userPersona)
  const worldEntries = useSettings((state) => state.worldEntries)
  const autoMemoryOn = useSettings((state) => state.autoMemory)
  const memoryInterval = useSettings((state) => state.memoryInterval)
  const memoryRecallOn = useSettings((state) => state.memoryRecall)
  const recallLimit = useSettings((state) => state.memoryRecallLimit)
  const recallMode = useSettings((state) => state.memoryRecallMode)
  const groupStrategy = useSettings((state) => state.groupStrategy)
  const groupContinuousOn = useSettings((state) => state.groupContinuous)
  const groupMultiOn = useSettings((state) => state.groupMultiPerTurn)
  const groupReplyLength = useSettings((state) => state.groupReplyLength)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const cardFileRef = useRef<HTMLInputElement>(null)
  const card = cards.find((item) => item.id === activeId) ?? cards[0]
  const update = (patch: Parameters<typeof updateCharacter>[1]) => {
    if (card) {
      updateCharacter(card.id, patch)
    }
  }
  const groupIds = useSettings((state) => state.groupCharacterIds)
  const groupCharacters = groupIds
    .map((id) => cards.find((item) => item.id === id))
    .filter((item): item is (typeof cards)[number] => item !== undefined && item.id !== card?.id)
  const availableGroup = cards
    .filter((item) => item.id !== card?.id && !groupIds.includes(item.id))
    .slice(0, Math.max(0, 2 - groupCharacters.length))

  /** 从 SillyTavern 角色卡 JSON（V1/V2）导入为新角色卡 */
  const handleCardFile = async (file: File | undefined) => {
    if (!file) {
      return
    }
    try {
      let raw: string
      if (/\.png$/i.test(file.name) || file.type === 'image/png') {
        const json = extractCardJsonFromPng(new Uint8Array(await file.arrayBuffer()))
        if (!json) {
          throw new Error('PNG 里没有找到角色卡数据（chara）')
        }
        raw = json
      } else {
        raw = await file.text()
      }
      const parsed = parseCharacterCardJson(raw)
      const { worldEntries: importedWorld, ...cardFields } = parsed
      const id = addCharacter()
      updateCharacter(id, cardFields)
      if (importedWorld.length) {
        addImportedWorldEntries(importedWorld)
      }
      showToast({ key: 'cardImported', params: { name: parsed.name } })
    } catch (error) {
      showToast({
        key: 'cardImportFailed',
        type: 'error',
        params: { message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  /** 导出当前角色卡为 Character Card V2 JSON */
  const handleExportCard = () => {
    if (!card) {
      return
    }
    const blob = new Blob([serializeCharacterCard(card)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(card.name || 'character').replace(/[\\/:*?"<>|]/g, '_')}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }

  return (
    <>
      <div className={styles.description}>{t('characterSectionDescription')}</div>
      <SettingCell
        label={t('userNameLabel')}
        description={t('userNameDescription')}
        status={null}
        action={
          <input
            className={styles.modelInput}
            value={userName}
            placeholder={t('userNamePlaceholder')}
            onChange={(event) => setUserName(event.target.value)}
          />
        }
      />
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('userPersonaLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={3}
          value={userPersona}
          placeholder={t('userPersonaPlaceholder')}
          onChange={(event) => setUserPersona(event.target.value)}
        />
        <div className={styles.description}>{t('userPersonaDescription')}</div>
      </div>
      <SettingCell
        label={t('characterCardLabel')}
        description={t('characterCardDescription')}
        status={null}
        action={
          <div className={styles.cardActions}>
            <Select
              ariaLabel={t('characterCardLabel')}
              value={card?.id ?? ''}
              options={cards.map((item) => ({
                value: item.id,
                label: item.name || t('characterUntitled'),
              }))}
              onChange={(value) => setActiveCharacter(value)}
            />
            <Button variant="outlined" size="m" onClick={() => addCharacter()}>
              {t('characterAdd')}
            </Button>
            <Button
              variant="dangerOutlined"
              size="m"
              onClick={() => {
                if (card) {
                  removeCharacter(card.id)
                }
              }}
            >
              {t('characterDelete')}
            </Button>
          </div>
        }
      />
      <SettingCell
        label={t('cardFileLabel')}
        description={t('cardFileDescription')}
        status={null}
        action={
          <div className={styles.cardActions}>
            <Button variant="outlined" size="m" onClick={() => cardFileRef.current?.click()}>
              {t('cardImport')}
            </Button>
            <Button variant="outlined" size="m" disabled={!card} onClick={handleExportCard}>
              {t('cardExport')}
            </Button>
            <input
              ref={cardFileRef}
              type="file"
              accept=".json,.png,application/json,image/png"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                void handleCardFile(file)
              }}
            />
          </div>
        }
      />
      <SettingCell
        label={t('characterGroupLabel')}
        description={t('characterGroupDescription')}
        status={null}
        action={
          <div className={styles.cardActions}>
            <Select
              ariaLabel={t('groupStrategyLabel')}
              value={groupStrategy}
              options={[
                { value: 'auto', label: t('groupStrategyAuto') },
                { value: 'roundRobin', label: t('groupStrategyRoundRobin') },
                { value: 'random', label: t('groupStrategyRandom') },
              ]}
              onChange={(value) =>
                setGroupStrategy(
                  value === 'roundRobin' ? 'roundRobin' : value === 'random' ? 'random' : 'auto'
                )
              }
            />
            <label className={styles.checkline}>
              <input
                type="checkbox"
                checked={groupContinuousOn}
                onChange={(event) => setGroupContinuous(event.target.checked)}
              />
              <span>{t('groupContinuousLabel')}</span>
            </label>
            <label className={styles.checkline}>
              <input
                type="checkbox"
                checked={groupMultiOn}
                onChange={(event) => setGroupMultiPerTurn(event.target.checked)}
              />
              <span>{t('groupMultiLabel')}</span>
            </label>
            <Select
              ariaLabel={t('groupLengthLabel')}
              value={String(groupReplyLength)}
              options={[0, 40, 60, 80, 120].map((count) => ({
                value: String(count),
                label:
                  count === 0 ? t('groupLengthUnlimited') : t('groupLengthValue', { count }),
              }))}
              onChange={(value) => setGroupReplyLength(Number(value))}
            />
            {groupCharacters.map((item) => (
              <span key={item.id} className={styles.cardChip}>
                {item.name || t('characterUntitled')}
                <button
                  type="button"
                  className={styles.cardChipRemove}
                  aria-label={t('characterGroupRemove')}
                  onClick={() => removeGroupCharacter(item.id)}
                >
                  ×
                </button>
              </span>
            ))}
            {availableGroup.length ? (
              <Select
                ariaLabel={t('characterGroupAdd')}
                value=""
                placeholder={t('characterGroupAdd')}
                options={availableGroup.map((item) => ({
                  value: item.id,
                  label: item.name || t('characterUntitled'),
                }))}
                onChange={(value) => {
                  if (value) {
                    addGroupCharacter(value)
                  }
                }}
              />
            ) : null}
          </div>
        }
      />
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterNameLabel')}</div>
        <input
          className={styles.textInput}
          value={card?.name ?? ''}
          placeholder={t('characterNamePlaceholder')}
          onChange={(event) => update({ name: event.target.value })}
        />
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterPersonaLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={3}
          value={card?.persona ?? ''}
          placeholder={t('characterPersonaPlaceholder')}
          onChange={(event) => update({ persona: event.target.value })}
        />
        <div className={styles.description}>{t('characterPersonaDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterVoiceLabel')}</div>
        <input
          className={styles.textInput}
          value={card?.voice ?? ''}
          placeholder={t('characterVoicePlaceholder')}
          onChange={(event) => update({ voice: event.target.value })}
        />
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterGreetingLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={2}
          value={card?.greeting ?? ''}
          placeholder={t('characterGreetingPlaceholder')}
          onChange={(event) => update({ greeting: event.target.value })}
        />
      </div>
      <SettingCell
        label={t('characterAdvancedLabel')}
        description={t('characterAdvancedDescription')}
        status={null}
        action={
          <Button
            variant="outlined"
            size="m"
            onClick={() => setShowAdvanced((value) => !value)}
          >
            {showAdvanced ? t('collapseAdvanced') : t('expandAdvanced')}
          </Button>
        }
      />
      {showAdvanced ? (
        <>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterAlternatesLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={3}
          value={(card?.alternates ?? []).join('\n')}
          placeholder={t('characterAlternatesPlaceholder')}
          onChange={(event) =>
            update({
              alternates: event.target.value
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean),
            })
          }
        />
        <div className={styles.description}>{t('characterAlternatesDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterScenarioLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={2}
          value={card?.scenario ?? ''}
          placeholder={t('characterScenarioPlaceholder')}
          onChange={(event) => update({ scenario: event.target.value })}
        />
        <div className={styles.description}>{t('characterScenarioDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterExamplesLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={5}
          value={card?.examples ?? ''}
          placeholder={t('characterExamplesPlaceholder')}
          onChange={(event) => update({ examples: event.target.value })}
        />
        <div className={styles.description}>{t('characterExamplesDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterMemoryLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={4}
          value={card?.memory ?? ''}
          placeholder={t('characterMemoryPlaceholder')}
          onChange={(event) => update({ memory: event.target.value })}
        />
        <div className={styles.description}>{t('characterMemoryDescription')}</div>
      </div>
      <SettingCell
        label={t('autoMemoryToggleLabel')}
        description={t('autoMemoryToggleDescription')}
        status={null}
        action={
          <div className={styles.cardActions}>
            <label className={styles.checkline}>
              <input
                type="checkbox"
                checked={autoMemoryOn}
                onChange={(event) => setAutoMemory(event.target.checked)}
              />
              <span>{t('worldEnabled')}</span>
            </label>
            <Select
              ariaLabel={t('autoMemoryIntervalLabel')}
              value={String(memoryInterval)}
              options={[2, 4, 6, 8].map((count) => ({
                value: String(count),
                label: t('autoMemoryEvery', { count }),
              }))}
              onChange={(value) => setMemoryInterval(Number(value))}
            />
          </div>
        }
      />
      <SettingCell
        label={t('memoryRecallLabel')}
        description={t('memoryRecallDescription')}
        status={null}
        action={
          <div className={styles.cardActions}>
            <label className={styles.checkline}>
              <input
                type="checkbox"
                checked={memoryRecallOn}
                onChange={(event) => setMemoryRecall(event.target.checked)}
              />
              <span>{t('worldEnabled')}</span>
            </label>
            <Select
              ariaLabel={t('memoryRecallLimitLabel')}
              value={String(recallLimit)}
              options={[2, 3, 4, 6, 8].map((count) => ({
                value: String(count),
                label: t('memoryRecallLines', { count }),
              }))}
              onChange={(value) => setMemoryRecallLimit(Number(value))}
            />
            <Select
              ariaLabel={t('memoryRecallModeLabel')}
              value={recallMode}
              options={[
                { value: 'vector', label: t('memoryRecallModeVector') },
                { value: 'lexical', label: t('memoryRecallModeLexical') },
              ]}
              onChange={(value) =>
                setMemoryRecallMode(value === 'lexical' ? 'lexical' : 'vector')
              }
            />
          </div>
        }
      />
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('autoMemoryLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={4}
          value={card?.autoMemory ?? ''}
          placeholder={t('autoMemoryPlaceholder')}
          onChange={(event) => update({ autoMemory: event.target.value })}
        />
        <div className={styles.description}>{t('autoMemoryDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('characterExtraPromptLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={3}
          value={card?.extraPrompt ?? ''}
          placeholder={t('characterExtraPromptPlaceholder')}
          onChange={(event) => update({ extraPrompt: event.target.value })}
        />
        <div className={styles.description}>{t('characterExtraPromptDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('worldBookLabel')}</div>
        <div className={styles.description}>{t('worldBookDescription')}</div>
        {worldEntries.map((entry) => (
          <div key={entry.id} className={styles.worldEntry}>
            <div className={styles.cardActions}>
              <input
                className={styles.textInput}
                value={entry.keys.join(', ')}
                placeholder={t('worldKeysPlaceholder')}
                onChange={(event) =>
                  updateWorldEntry(entry.id, {
                    keys: event.target.value
                      .split(/[,，、]/)
                      .map((key) => key.trim())
                      .filter(Boolean),
                  })
                }
              />
              <label className={styles.checkline}>
                <input
                  type="checkbox"
                  checked={entry.enabled}
                  onChange={(event) => updateWorldEntry(entry.id, { enabled: event.target.checked })}
                />
                <span>{t('worldEnabled')}</span>
              </label>
              <Button
                variant="dangerOutlined"
                size="m"
                onClick={() => removeWorldEntry(entry.id)}
              >
                {t('worldRemove')}
              </Button>
              <label className={styles.checkline}>
                <input
                  type="checkbox"
                  checked={entry.regex === true}
                  onChange={(event) => updateWorldEntry(entry.id, { regex: event.target.checked })}
                />
                <span>{t('worldRegex')}</span>
              </label>
              <label className={styles.checkline}>
                <input
                  type="checkbox"
                  checked={entry.recursive === true}
                  onChange={(event) =>
                    updateWorldEntry(entry.id, { recursive: event.target.checked })
                  }
                />
                <span>{t('worldRecursive')}</span>
              </label>
            </div>
            <textarea
              className={styles.textarea}
              rows={2}
              value={entry.content}
              placeholder={t('worldContentPlaceholder')}
              onChange={(event) => updateWorldEntry(entry.id, { content: event.target.value })}
            />
            <div className={styles.cardActions}>
              <input
                className={styles.worldNumber}
                type="number"
                min={0}
                value={entry.minRound ?? 0}
                aria-label={t('worldMinRound')}
                onChange={(event) =>
                  updateWorldEntry(entry.id, {
                    minRound: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
              <Select
                ariaLabel={t('worldPosition')}
                value={entry.position ?? 'tail'}
                options={[
                  { value: 'head', label: t('worldPositionHead') },
                  { value: 'tail', label: t('worldPositionTail') },
                ]}
                onChange={(value) =>
                  updateWorldEntry(entry.id, {
                    position: value === 'head' ? 'head' : 'tail',
                  })
                }
              />
              <input
                className={styles.worldField}
                value={entry.onlyIf ?? ''}
                placeholder={t('worldOnlyIfPlaceholder')}
                aria-label={t('worldOnlyIfPlaceholder')}
                onChange={(event) => updateWorldEntry(entry.id, { onlyIf: event.target.value })}
              />
              <input
                className={styles.worldField}
                value={entry.notIf ?? ''}
                placeholder={t('worldNotIfPlaceholder')}
                aria-label={t('worldNotIfPlaceholder')}
                onChange={(event) => updateWorldEntry(entry.id, { notIf: event.target.value })}
              />
            </div>
          </div>
        ))}
        <div className={styles.cardActions}>
          <Button variant="outlined" size="m" onClick={() => addWorldEntry()}>
            {t('worldAdd')}
          </Button>
        </div>
      </div>
        </>
      ) : null}
    </>
  )
}

/** 数字参数输入框：清空即恢复「服务端默认」 */
const NumberField = ({
  value,
  onChange,
  placeholder,
  min,
  max,
  step,
  ariaLabel,
}: {
  value: number | null
  onChange: (value: number | null) => void
  placeholder?: string
  min?: number
  max?: number
  step?: number
  ariaLabel: string
}) => (
  <input
    type="number"
    className={styles.numberInput}
    aria-label={ariaLabel}
    value={value ?? ''}
    placeholder={placeholder}
    min={min}
    max={max}
    step={step}
    onChange={(event) => {
      const raw = event.target.value.trim()
      onChange(raw === '' ? null : Number(raw))
    }}
  />
)

/** 模型参数：思考强度、输出上限、温度、Top-P；并说明哪些会被服务端覆盖 */
const AdvancedSettings = () => {
  const t = useTranslate()
  const reasoningEffort = useSettings((state) => state.reasoningEffort)
  const maxTokens = useSettings((state) => state.maxTokens)
  const temperature = useSettings((state) => state.temperature)
  const topP = useSettings((state) => state.topP)
  const modelId = useSettings((state) => state.modelId)
  const extraModels = useSettings((state) => state.extraModels)
  const apiBase = useSettings((state) => state.apiBase)
  const apiProtocol = useSettings((state) => state.apiProtocol)
  const apiProxy = useSettings((state) => state.apiProxy)
  const contextBudget = useSettings((state) => state.contextBudget)
  const streamRetryCount = useSettings((state) => state.streamRetryCount)
  const streamIdleTimeout = useSettings((state) => state.streamIdleTimeout)
  const serverDefault = t('advancedServerDefault')

  return (
    <>
      <SettingCell
        label={t('modelIdLabel')}
        description={t('modelIdDescription')}
        status={null}
        action={
          <input
            className={styles.modelInput}
            value={modelId}
            placeholder={t('modelIdPlaceholder')}
            onChange={(event) => setModelId(event.target.value)}
          />
        }
      />
      <SettingCell
        label={t('contextBudgetLabel')}
        description={t('contextBudgetDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('contextBudgetLabel')}
            value={String(contextBudget)}
            options={[8000, 16000, 32000, 64000, 128000].map((tokens) => ({
              value: String(tokens),
              label: `${tokens / 1000}k`,
            }))}
            onChange={(value) => setContextBudget(Number(value))}
          />
        }
      />
      <SettingCell
        label={t('streamRetryLabel')}
        description={t('streamRetryDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('streamRetryLabel')}
            value={String(streamRetryCount)}
            options={[0, 2, 5, 10].map((count) => ({
              value: String(count),
              label: count === 0 ? t('streamRetryOff') : t('streamRetryValue', { count }),
            }))}
            onChange={(value) => setStreamRetryCount(Number(value))}
          />
        }
      />
      <SettingCell
        label={t('streamIdleLabel')}
        description={t('streamIdleDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('streamIdleLabel')}
            value={String(streamIdleTimeout)}
            options={[60, 120, 300, 600].map((seconds) => ({
              value: String(seconds),
              label: t('streamIdleValue', { seconds }),
            }))}
            onChange={(value) => setStreamIdleTimeout(Number(value))}
          />
        }
      />
      <SettingCell
        label={t('modelExtraLabel')}
        description={t('modelExtraDescription')}
        status={null}
        action={
          <input
            className={styles.modelInput}
            value={extraModels}
            placeholder={t('modelExtraPlaceholder')}
            onChange={(event) => setExtraModels(event.target.value)}
          />
        }
      />
      <SettingCell
        label={t('apiBaseLabel')}
        description={t('apiBaseDescription')}
        status={null}
        action={
          <input
            className={styles.modelInput}
            value={apiBase}
            placeholder={t('apiBasePlaceholder')}
            onChange={(event) => setApiBase(event.target.value)}
          />
        }
      />
      <SettingCell
        label={t('apiProtocolLabel')}
        description={t('apiProtocolDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('apiProtocolLabel')}
            value={apiProtocol}
            options={[
              { value: 'anthropic', label: t('apiProtocolAnthropic') },
              { value: 'openai', label: t('apiProtocolOpenAI') },
            ]}
            onChange={(value) => setApiProtocol(value === 'openai' ? 'openai' : 'anthropic')}
          />
        }
      />
      <SettingCell
        label={t('apiProxyLabel')}
        description={t('apiProxyDescription')}
        status={null}
        action={
          <input
            type="checkbox"
            checked={apiProxy}
            aria-label={t('apiProxyLabel')}
            onChange={(event) => setApiProxy(event.target.checked)}
          />
        }
      />
      <SettingCell
        label={t('advancedEffortLabel')}
        description={t('advancedEffortDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('advancedEffortLabel')}
            value={reasoningEffort}
            options={[
              { value: 'low', label: t('advancedEffortLow') },
              { value: 'high', label: t('advancedEffortHigh') },
              { value: 'max', label: t('advancedEffortMax') },
            ]}
            onChange={(value) => setReasoningEffort(value as 'low' | 'high' | 'max')}
          />
        }
      />
      <SettingCell
        label={t('advancedMaxTokensLabel')}
        description={t('advancedMaxTokensDescription')}
        status={null}
        action={
          <NumberField
            ariaLabel={t('advancedMaxTokensLabel')}
            value={maxTokens}
            min={1}
            step={256}
            placeholder={serverDefault}
            onChange={setMaxTokens}
          />
        }
      />
      <SettingCell
        label={t('advancedTemperatureLabel')}
        description={t('advancedTemperatureDescription')}
        status={null}
        action={
          <NumberField
            ariaLabel={t('advancedTemperatureLabel')}
            value={temperature}
            min={0}
            max={2}
            step={0.1}
            placeholder={serverDefault}
            onChange={setTemperature}
          />
        }
      />
      <SettingCell
        label={t('advancedTopPLabel')}
        description={t('advancedTopPDescription')}
        status={null}
        action={
          <NumberField
            ariaLabel={t('advancedTopPLabel')}
            value={topP}
            min={0}
            max={1}
            step={0.05}
            placeholder={serverDefault}
            onChange={setTopP}
          />
        }
      />
      <div className={styles.description}>{t('advancedNote')}</div>
    </>
  )
}

/** 写作设置：预设下拉 + 可编辑提示词；编辑即切换为「自定义」 */
const WritingSettings = () => {
  const t = useTranslate()
  const writingPreset = useSettings((state) => state.writingPreset)
  const customPrompt = useSettings((state) => state.customPrompt)
  const writingProfile = useSettings((state) => state.writingProfile)
  const preset = WRITING_PRESETS.find((item) => item.id === writingPreset)
  const prompt = writingPreset === 'custom' ? customPrompt : (preset?.prompt ?? '')

  return (
    <>
      <SettingCell
        label={t('writingPresetLabel')}
        description={t('writingPresetDescription')}
        status={null}
        action={
          <Select
            ariaLabel={t('writingPresetLabel')}
            value={writingPreset}
            options={WRITING_PRESETS.map((item) => ({ value: item.id, label: t(item.labelKey) }))}
            onChange={(value) => setWritingPreset(value)}
          />
        }
      />
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('writingProfileLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={5}
          value={writingProfile}
          placeholder={t('writingProfilePlaceholder')}
          onChange={(event) => setWritingProfile(event.target.value)}
        />
        <div className={styles.description}>{t('writingProfileDescription')}</div>
      </div>
      <div className={styles.promptBlock}>
        <div className={styles.label}>{t('writingPromptLabel')}</div>
        <textarea
          className={styles.textarea}
          rows={6}
          value={prompt}
          placeholder={t('writingPromptPlaceholder')}
          onChange={(event) => {
            setWritingPreset('custom')
            setCustomPrompt(event.target.value)
          }}
        />
        <div className={styles.description}>{t('writingPromptDescription')}</div>
      </div>
    </>
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const locale = useSettings((state) => state.locale)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={locale}
          options={[
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={setLocale}
        />
      }
    />
  )
}

/** 朗读音色：stella（海星，女声）/ tide（暗潮，男声） */
const TtsVoiceSetting = () => {
  const t = useTranslate()
  const ttsVoice = useSettings((state) => state.ttsVoice)
  return (
    <SettingCell
      label={t('settingsTtsVoice')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsTtsVoice')}
          value={ttsVoice}
          options={[
            { value: 'stella', label: t('settingsTtsVoiceStella') },
            { value: 'tide', label: t('settingsTtsVoiceTide') },
          ]}
          onChange={setTtsVoice}
        />
      }
    />
  )
}

/** 覆盖导入的二次确认，叠在设置弹窗上 */
const ImportConfirm = ({
  historyImport,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('historyImportConfirmTitle')}
      className={styles.importConfirm}
      onClose={historyImport.cancel}
      footer={
        <>
          <Button variant="outlined" size="m" autoFocus onClick={historyImport.cancel}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={historyImport.busy}
            onClick={() => {
              void historyImport.confirm('merge')
            }}
          >
            {t('historyImportMerge')}
          </Button>
          <Button
            variant="dangerOutlined"
            size="m"
            disabled={historyImport.busy}
            onClick={() => {
              void historyImport.confirm('overwrite')
            }}
          >
            {t('historyImportConfirm')}
          </Button>
        </>
      }
    >
      <div className={styles.importConfirmText}>{t('historyImportConfirmDescription')}</div>
    </Modal>
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后先提示覆盖；确认后才检查文件并执行导入，任何错误都提示导入失败。 */
const useHistoryImport = () => {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const confirm = async (mode: 'overwrite' | 'merge' = 'overwrite') => {
    if (!file || importing.current) {
      return
    }
    importing.current = true
    setFile(null)
    setBusy(true)
    setStatus(null)
    try {
      const count = mode === 'merge' ? await mergeImportHistory(file) : await importHistory(file)
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch (error) {
      // 保留真实原因，便于排查（配额不足 vs 文件格式问题）
      // eslint-disable-next-line no-console
      console.error('[import history]', error)
      const message = error instanceof Error ? error.message : String(error)
      const quota =
        (error instanceof DOMException &&
          (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) ||
        /quota/i.test(message)
      setStatus(
        quota
          ? { key: 'historyImportQuota', error: true }
          : { key: 'historyImportFailedDetail', params: { message }, error: true }
      )
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { file, busy, status, select: setFile, cancel: () => setFile(null), confirm }
}

/** 导入 = 覆盖：用选中文件替换本地全部会话与附件。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,application/zip,application/x-zip-compressed"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}
