import { useEffect, useState } from 'react'

import { currentLocale, t } from '@/i18n'
import { useStore } from '../store'
import { EndpointCard, domainOf } from './EndpointCard'
import { CloseIcon, PlusIcon } from './icons'
import { PRESETS, endpointKey, applyPreset, removeEndpoint, replaceEndpoint } from '@/storage/settings'
import type { Settings } from '@/storage/settings'

/** 预设卡片：名字一行、域名一行，整块可点。左对齐是为了两列之间字头能对齐。 */
const presetCard = [
  'flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-lg',
  'border border-neutral-200 bg-white px-2.5 py-2 text-left',
  'transition-colors duration-150 motion-reduce:transition-none',
  'hover:border-neutral-300 hover:bg-neutral-50',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1',
].join(' ')

export function SettingsPanel() {
  const { settings, setSettings, resetModelTest } = useStore()
  const locale = currentLocale()
  const [picking, setPicking] = useState(false)
  // 刚加进来的那条端点：seq 只是个换 key 的由头，让那张卡重新挂载、于是一进来就是草稿态。
  // 光记 key 不够——同一个预设连点两次时 key 没变，卡片不会重挂，第二次就没反应了。
  const [justAdded, setJustAdded] = useState<{ key: string; seq: number } | null>(null)

  // 每次挂载都清回空白：测试结果是一次即时探针，不是状态。上次那个结论摆在这里会撒谎——
  // 中间可能已经换过 Key、换过模型（见 issues/37-test-model-button.md）。
  useEffect(() => resetModelTest(), [resetModelTest])

  const addBlank = (): void => {
    void setSettings({
      ...settings,
      endpoints: [...settings.endpoints, { baseUrl: '', apiKey: '', models: [] }],
    })
    setPicking(false)
  }

  /**
   * 点预设后那张卡直接展开成草稿态，光标落在 Key 上（见 EndpointCard 里那段 focus）。
   * 预设给的是地址和一个模型名，唯独 Key 给不了——它是这条端点唯一还缺的东西，
   * 却又是不填就一步都走不动的那个。收起来等用户自己找到卡片再点一次铅笔，
   * 等于把「还差一步」藏进了一个看不出还差一步的界面。
   */
  const pickPreset = (preset: (typeof PRESETS)[number]): void => {
    void setSettings(applyPreset(settings, preset))
    setJustAdded({ key: endpointKey(preset.baseUrl), seq: (justAdded?.seq ?? 0) + 1 })
    setPicking(false)
  }

  return (
    <div className="space-y-6">
      {/* 模型配置摆最前：新用户来设置页就是为了它。
          标题已经在 Shell 头部和返回同一行，这里不再写一遍。
          外框去掉：端点卡自己有边，再套一层就是框套框。 */}
      <section className="space-y-3">
        <h3 className="text-base leading-body font-medium">{t('settingsModelTitle')}</h3>


        {settings.endpoints.map((endpoint, index) => {
          const key = endpointKey(endpoint.baseUrl) === '' ? `new-${index}` : endpointKey(endpoint.baseUrl)
          const fresh = justAdded !== null && justAdded.key === key
          return (
            <EndpointCard
              key={fresh ? `${key}#${justAdded.seq}` : key}
              endpoint={endpoint}
              activeModel={
                endpointKey(endpoint.baseUrl) === endpointKey(settings.active.baseUrl)
                  ? settings.active.model
                  : null
              }
              initialEditing={endpoint.baseUrl === '' || fresh}
              onChange={(next) => void setSettings(replaceEndpoint(settings, index, next))}
              onDelete={() => void setSettings(removeEndpoint(settings, index))}
              onPick={(model) => void setSettings({
                ...settings, active: { baseUrl: endpoint.baseUrl, model },
              })}
            />
          )
        })}

        {/* 加端点长成一张卡：它排在端点卡片队尾，是「再来一张」，不是标题栏角落里的一个小按钮。
            虚线边框说明这一格现在还是空的、点了才会填上东西——和实线的已有端点卡分得开。
            展开后原地换成挑选面板，不再跳到列表最下面：出现的位置就是刚点的位置。 */}
        {picking ? (
          <div className="space-y-2 rounded-lg border border-neutral-200 bg-neutral-50/50 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-body text-neutral-600">{t('settingsPresetHint')}</p>
              <button
                type="button"
                aria-label={t('settingsEndpointCancel')}
                title={t('settingsEndpointCancel')}
                className="-mr-1 -mt-1 shrink-0 cursor-pointer rounded-md p-1.5 text-neutral-500 transition-colors duration-150 hover:bg-white hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 motion-reduce:transition-none"
                onClick={() => setPicking(false)}
              >
                <CloseIcon />
              </button>
            </div>
            {/* 两列：预设名短，一列会拉出一条又高又窄的清单；三列在窄侧栏里域名全被截断 */}
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => (
                <button
                  key={preset.baseUrl}
                  type="button"
                  className={presetCard}
                  onClick={() => pickPreset(preset)}
                >
                  <span className="w-full truncate text-base leading-body font-medium text-neutral-800">
                    {preset.label[locale]}
                  </span>
                  {/* 域名同时是给读屏的补充：光一个「智谱」听不出要连到哪台服务器 */}
                  <span className="w-full truncate text-sm leading-caption text-neutral-500">
                    {domainOf(preset.baseUrl)}
                  </span>
                </button>
              ))}
              {/* 自定义排在最后、占满一行：它是「以上都不是」的那条出口，不是并列的第八个供应商 */}
              <button
                type="button"
                className={`${presetCard} col-span-2 border-dashed`}
                onClick={addBlank}
              >
                <span className="inline-flex items-center gap-1.5 text-base leading-body font-medium text-neutral-800">
                  <PlusIcon className="h-3.5 w-3.5" />
                  {t('settingsEndpointCustom')}
                </span>
                <span className="w-full truncate text-sm leading-caption text-neutral-500">
                  {t('settingsEndpointCustomHint')}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 bg-white px-3 py-2.5 text-base leading-body font-medium text-neutral-600 transition-colors duration-150 hover:border-neutral-400 hover:bg-neutral-50 hover:text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-1 motion-reduce:transition-none"
            onClick={() => setPicking(true)}
          >
            <PlusIcon className="h-4 w-4" />
            {t('settingsEndpointAdd')}
          </button>
        )}


        <p className="text-sm leading-relaxed text-neutral-500">
          {t('settingsPrivacyKey')}
          {' '}
          {t('settingsPrivacyPayload')}
        </p>
      </section>

      <section className="space-y-2 border-t border-neutral-200 pt-5">
        <h3 className="text-base leading-body font-medium">{t('settingsLangTitle')}</h3>
        <label className="block text-base leading-body">
          <select
            className="w-full min-h-8 cursor-pointer rounded border border-neutral-200 bg-white px-2.5 text-base leading-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400"
            aria-label={t('settingsLangTitle')}
            value={settings.uiLocale}
            onChange={(e) =>
              void setSettings({ ...settings, uiLocale: e.target.value as Settings['uiLocale'] })
            }
          >
            <option value="auto">{t('settingsLangAuto')}</option>
            {/* 语言名用该语言自己的写法，不跟着界面翻译——
                界面正好是用户看不懂的那种语言时，这是他找回来的唯一线索 */}
            <option value="zh_CN">中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <p className="text-sm leading-relaxed text-neutral-500">{t('settingsLangBody')}</p>
      </section>

      {/* 统一 GitHub 标题改的是书签自己的名字，不是「这一轮怎么整理」，所以不在偏好页 */}
      <section className="border-t border-neutral-200 pt-5">
        <label className="flex items-start gap-2 text-base leading-body">
          <input
            type="checkbox"
            className="mt-1 h-3.5 w-3.5"
            checked={settings.rewriteGithubTitles}
            onChange={(e) => void setSettings({ ...settings, rewriteGithubTitles: e.target.checked })}
          />
          <span>
            {t('settingsGithubTitle')}
            <span className="mt-0.5 block text-sm leading-relaxed text-neutral-500">
              {t('settingsGithubBody')}
            </span>
          </span>
        </label>
      </section>
    </div>
  )
}
